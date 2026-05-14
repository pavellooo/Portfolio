# KDC Service (Next.js API-Only)

Production-ready trusted Key Distribution Center (KDC) API for a messaging app.

This service:
- Stores user long-term symmetric keys encrypted for the KDC (RSA-OAEP-SHA256 ciphertext).
- Issues per-conversation random session keys.
- Returns session keys encrypted separately for each participant with AES-256-GCM envelopes.
- Never returns plaintext user keys.

No UI pages are included. Only API routes and supporting modules.

## Setup Guide

For a complete first-time setup and local usage walkthrough (including auth signing key generation, env wiring, local run, and app-server token verification), use:

- [SETUP_AND_USAGE_GUIDE.md](SETUP_AND_USAGE_GUIDE.md)

## Stack

- Next.js (Pages API routes, Node runtime)
- TypeScript
- Node `crypto` only
- In-memory storage with clear interface for MongoDB/KMS swap later

## Protocol And Crypto (Strict)

### Protocol version

All requests and responses include:
- `protocolVersion: "kdc-proto-v1"` (or the value set by `KDC_PROTOCOL_VERSION`)

Unknown protocol versions are rejected with `400`.

### Transport

- HTTPS is assumed and required in deployment (Vercel)
- No custom transport encryption layer is added

### Registration encryption (client -> KDC)

- RSA-OAEP with SHA-256
- KDC keypair: RSA 3072-bit
- Public key format exposed: PEM SPKI
- Private key format secret: PEM PKCS8
- Registered ciphertext is expected to decode to 384 bytes (RSA-3072 ciphertext length)

### Symmetric envelope (KDC -> clients)

- AES-256-GCM
- Key length: 32 bytes
- IV length: 12 bytes
- Auth tag length: 16 bytes
- Encoding for all binary data: standard base64 (not base64url)
- UTF-8 text encoding before encryption (when text is encrypted)

Envelope schema (AES-256-GCM):

```json
{
  "alg": "AES-256-GCM",
  "ivB64": "<base64 12-byte iv>",
  "ciphertextB64": "<base64 bytes>",
  "tagB64": "<base64 16-byte tag>"
}
```

### Session key format

- Raw: 32 random bytes
- Server storage for now: base64 (`sessionKeyPlain_b64`) with TODO to move to HSM/KMS
- Returned encrypted per user: AES-GCM envelope above

## Environment Variables

Copy `.env.example` and set values:

- `KDC_PRIVATE_KEY_PEM` (required)
- `KDC_PUBLIC_KEY_PEM` (required)
- `KDC_AUTH_SIGNING_PRIVATE_KEY_PEM` (required for `/api/auth/verify` JWT signing)
- `KDC_AUTH_SIGNING_PUBLIC_KEY_PEM` (required for `/api/auth/public-key`)
- `KDC_AUTH_SIGNING_KID` default: `kdc-sig-current`
- `KDC_ENCRYPTION_KEY_KID` default: `kdc-register-key-rsa3072`
- `KDC_PROTOCOL_VERSION` default: `kdc-proto-v1`
- `KDC_AUTH_PROTOCOL_VERSION` default: `kdc-auth-v2`
- `KDC_ALLOWED_ORIGINS` comma-separated allowlist (ex: `http://localhost:5001`)
- `KDC_DEFAULT_TTL_SECONDS` default: `86400`
- `KDC_AUTH_PBKDF2_ITERATIONS` default: `150000`
- `KDC_AUTH_CHALLENGE_TTL_SECONDS` default: `300`
- `KDC_AUTH_TIMESTAMP_SKEW_SECONDS` default: `60`
- `KDC_AUTH_TOKEN_TTL_SECONDS` default: `300`
- `KDC_AUTH_TOKEN_ISSUER` default: `kdc`
- `KDC_AUTH_TOKEN_AUDIENCE` default: `messaging-app-server`
- `UPSTASH_REDIS_REST_URL` optional (required to enable Redis-backed persistence)
- `UPSTASH_REDIS_REST_TOKEN` optional (required to enable Redis-backed persistence)
- `KDC_STORAGE_PREFIX` optional default: `kdc`
- `NODE_ENV`

If Upstash env vars are not set, the service falls back to in-memory storage in local/test environments.
In production, Redis is required by default and the API will fail fast if Redis env vars are missing.
Set `KDC_ALLOW_IN_MEMORY_FALLBACK_IN_PRODUCTION=true` only for emergency troubleshooting.

## Generate RSA Keypair

```bash
npm run gen:keys
```

The script prints both:
- Raw multiline PEM values
- Escaped single-line `.env` assignments

## Run Locally

```bash
npm install
npm run dev
```

API base URL: `http://localhost:4000/api`

## API Endpoints

## Challenge-Response Auth (kdc-auth-v2)

The key distribution endpoints remain unchanged. Auth endpoints:
- `POST /api/auth/challenge` - Issue challenge with RS256 signature
- `POST /api/auth/verify` - Verify proof and issue JWT + session key
- `POST /api/auth/bootstrap-verify` - Token-scoped replay protection
- `GET /api/auth/public-key` - Get RS256 public key metadata

### Auth Protocol Flow

1. **Challenge**: Client sends opaque identity code (`idc`) + timestamp + 16-byte nonce
   - Server responds with signed challenge + echo of client nonce
2. **Verify**: Client computes HMAC proof and sends idc + challenge ID + timestamp + nonce + proof
   - Server validates proof, issues JWT + encrypted session key
3. **Bootstrap**: Client uses JWT to request credential bootstrap with token-scoped nonce
   - Server validates proof, confirms replay protection

### Auth Challenge: POST /api/auth/challenge

Request:

```json
{
  "protocolVersion": "kdc-auth-v2",
  "idc": "<opaque-identity-code>",
  "ts1": 1712059735000,
  "n1": "<base64 16 bytes>"
}
```

Response `200`:

```json
{
  "success": true,
  "challengeId": "<uuid-v4>",
  "saltB64": "<base64>",
  "iterations": 150000,
  "challengeB64": "<base64>",
  "ts2": 1712059735123,
  "n1": "<base64 16 bytes>",
  "sig": {
    "alg": "RS256",
    "kid": "kdc-sig-current",
    "valueB64": "<base64-encoded-signature>"
  },
  "isNewUser": true
}
```

### Auth Verify: POST /api/auth/verify

Request:

```json
{
  "protocolVersion": "kdc-auth-v2",
  "idc": "<opaque-identity-code>",
  "challengeId": "<uuid-v4>",
  "ts3": 1712059736000,
  "n2": "<base64 16 bytes>",
  "verifier": "<base64>",
  "proof": "<base64 32-byte HMAC>"
}
```

Response `200`:

```json
{
  "success": true,
  "userId": "u_0f9aa298b9f4e2d1",
  "displayAlias": "amber-falcon-1042",
  "isNewUser": false,
  "token": {
    "type": "JWS",
    "alg": "RS256",
    "kid": "kdc-sig-current",
    "value": "<jwt-bearer-token>"
  },
  "encClientServerKey": {
    "alg": "AES-256-GCM",
    "ivB64": "<base64 12 bytes>",
    "ciphertextB64": "<base64>",
    "tagB64": "<base64 16 bytes>"
  },
  "expiresAt": "2026-04-02T16:13:55.000Z"
}
```

### Auth Bootstrap Verify: POST /api/auth/bootstrap-verify

Request (requires Bearer token):

```json
{
  "protocolVersion": "kdc-auth-v2",
  "ts5": 1712059738000,
  "n3": "<base64 16 bytes>",
  "proof": {
    "alg": "HMAC-SHA-256",
    "valueB64": "<base64>"
  }
}
```

Response `200`:

```json
{
  "success": true,
  "userId": "u_0f9aa298b9f4e2d1"
}
```

### Auth Public Key: GET /api/auth/public-key

Response `200`:

```json
{
  "algorithm": "RS256",
  "kid": "kdc-sig-current",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

### Register-Key Public Key: GET /api/keys/public-key

Clients must use this endpoint to encrypt `encryptedUserKey` before calling `POST /api/register-key`.

Response `200`:

```json
{
  "success": true,
  "protocolVersion": "kdc-proto-v1",
  "algorithm": "RSA-OAEP-256",
  "use": "enc",
  "kid": "kdc-register-key-rsa3072-v1",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

Expected ciphertext length for `encryptedUserKey`:
- 384 bytes after base64 decode

Example curl:

```bash
curl -s http://localhost:4000/api/keys/public-key
```

Example fetch:

```ts
const keyResponse = await fetch("http://localhost:4000/api/keys/public-key").then((response) => response.json());
```

JWT token claims issued by `/api/auth/verify`:
- `iss`: `kdc` (default, configurable via env)
- `aud`: `messaging-app-server` (default, configurable via env)
- `sub`: auth `userId`
- `jti`: unique token ID (for session lookup)
- `idc`: opaque identity code
- `displayAlias`: user display name
- `exp`: expiration timestamp

### 1) GET /api/kdc/public-key

Response `200`:

```json
{
  "protocolVersion": "kdc-proto-v1",
  "kdcKeyAlg": "rsa-oaep-sha256",
  "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n..."
}
```

### 2) POST /api/register-key (Bearer Token Required)

Request:

```json
{
  "protocolVersion": "kdc-proto-v1",
  "userId": "u_0f9aa298b9f4e2d1",
  "encryptedUserKey": "<base64 384-byte rsa-oaep ciphertext>"
}
```

Behavior:
- Requires valid Bearer token in Authorization header
- Validates token `sub` matches `userId`
- Validates ciphertext decodes to exactly 384 bytes
- Upserts user key record

Response `200`:

```json
{
  "success": true,
  "userId": "u_0f9aa298b9f4e2d1"
}
```
}
```

Response `404` if user key missing.

### 4) POST /api/create-session (Bearer Token Required)

Request:

```json
{
  "protocolVersion": "kdc-session-v2",
  "tokenA": "<bearer-jwt-token-for-user-a>",
  "userIdA": "u_alice_id",
  "userIdB": "u_bob_id",
  "conversationId": "conv-123",
  "requesterUserId": "u_alice_id",
  "ts1": 1712059735000,
  "n1": "<base64 16 bytes>"
}
```

Behavior:
- Requires Bearer token with valid JWT
- Validates session exists for both users via JWT jti claim
- Derives session decryption keys (KCS) for both users
- Generates random conversation key (kConv)
- Creates plaintext tickets with peer IDs and shared kConv
- Encrypts each ticket separately with respective user's KCS
- Returns encrypted tickets (ticketA, ticketB)

Response `200`:

```json
{
  "success": true,
  "ticketA": {
    "alg": "AES-256-GCM",
    "ivB64": "<base64 12 bytes>",
    "ciphertextB64": "<base64>",
    "tagB64": "<base64 16 bytes>"
  },
  "ticketB": {
    "alg": "AES-256-GCM",
    "ivB64": "<base64 12 bytes>",
    "ciphertextB64": "<base64>",
    "tagB64": "<base64 16 bytes>"
  }
}
```

Plaintext ticket schema (decrypted):

```json
{
  "idPeer": "<user-id-of-peer>",
  "kConvB64": "<base64 32-byte conversation key>"
}
```

## Error Contract

Consistent error body:

```json
{
  "error": "bad_request",
  "code": "bad_request"
}
```

Or with error details:

```json
{
  "error": "Rate limit exceeded",
  "code": "too_many_requests"
}
```

Used status codes:
- `400` validation/protocol/origin/malformed input
- `401` unauthorized (missing/invalid bearer token)
- `404` missing user/session resources
- `409` replay detection / session conflicts
- `429` rate limiting
- `500` internal errors

Security behavior:
- plaintext key material is never logged
- proof/token/private-key-like fields are redacted in logs
- request IDs are emitted via `X-Request-Id` header and logs
- rate limiting enabled for auth routes (challenge, verify, bootstrap)
- rate limiting enabled for protected routes (register-key, create-session)
- CORS origin allowlist enforced via `KDC_ALLOWED_ORIGINS`
- 16-byte nonce validation enforced on all auth routes
- Constant-time comparison for proof/token validation

## Storage Model

### UserAuthRecord

```json
{
  "userId": "alice",
  "protocolVersion": "kdc-proto-v1",
  "encryptedUserKeyForKdc": "<base64>",
  "createdAt": "<iso>",
  "updatedAt": "<iso>"
}
```

### SessionRecord

```json
{
  "sessionId": "<uuid>",
  "conversationId": "conv-123",
  "userIdA": "alice",
  "userIdB": "bob",
  "protocolVersion": "kdc-proto-v1",
  "sessionKeyPlain_b64": "<base64>",
  "encryptedForA": { "v": "kdc-aesgcm-v1", "alg": "aes-256-gcm", "iv": "...", "ciphertext": "...", "authTag": "..." },
  "encryptedForB": { "v": "kdc-aesgcm-v1", "alg": "aes-256-gcm", "iv": "...", "ciphertext": "...", "authTag": "..." },
  "createdAt": "<iso>",
  "expiresAt": "<iso>"
}
```

TODO (production hardening): move `sessionKeyPlain_b64` from process memory/storage into HSM/KMS-backed encryption workflow.

## Curl Examples

Get KDC public key:

```bash
curl -s http://localhost:4000/api/kdc/public-key
```

Register encrypted user key:

```bash
curl -s -X POST http://localhost:4000/api/register-key \
  -H "Content-Type: application/json" \
  -d '{
    "protocolVersion": "kdc-proto-v1",
    "userId": "alice",
    "encryptedUserKey": "<base64 rsa-oaep ciphertext>"
  }'
```

Create session:

```bash
curl -s -X POST http://localhost:4000/api/create-session \
  -H "Content-Type: application/json" \
  -d '{
    "protocolVersion": "kdc-proto-v1",
    "conversationId": "conv-123",
    "requesterUserId": "alice",
    "userIdA": "alice",
    "userIdB": "bob",
    "ttlSeconds": 86400
  }'
```

Fetch latest unexpired by conversation:

```bash
curl -s -X POST http://localhost:4000/api/session/by-conversation \
  -H "Content-Type: application/json" \
  -d '{
    "protocolVersion": "kdc-proto-v1",
    "conversationId": "conv-123",
    "requesterUserId": "alice"
  }'
```

## Deploy To Vercel

1. Push this repo to GitHub.
2. Import project in Vercel.
3. Set all required environment variables in Vercel Project Settings.
4. Deploy.

Vercel config is included in `vercel.json` with API function max duration.

## Testing

```bash
npm run typecheck
npm test
```

Tests include:
- AES-GCM envelope format and decrypt compatibility
- endpoint contract compatibility for registration/session creation/fallback/by-conversation
