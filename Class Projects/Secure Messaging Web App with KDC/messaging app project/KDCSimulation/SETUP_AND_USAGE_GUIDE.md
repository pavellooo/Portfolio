# KDC Setup And Usage Guide

This guide covers:
- Key generation
- Environment setup
- Local development run
- Local production-mode run
- Basic endpoint smoke tests

The full API contract details remain in [README.md](README.md).

## 1) Prerequisites

- Node.js 20+
- npm
- OpenSSL
- PowerShell

## 2) Install Dependencies

From project root:

npm install

## 3) Generate KDC Encryption Keys (RSA-3072)

If you do not already have KDC encryption keys, run:

npm run gen:keys

This generates values for:
- KDC_PRIVATE_KEY_PEM
- KDC_PUBLIC_KEY_PEM

These are used for:
- POST /api/register-key
- GET /api/keys/public-key

## 4) Generate Auth Signing Keys (RSA-2048)

Create a separate key pair for JWT signing (do not reuse encryption keys):

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out kdc-auth-signing-private.pem
openssl rsa -pubout -in kdc-auth-signing-private.pem -out kdc-auth-signing-public.pem

These are used for:
- POST /api/auth/challenge
- POST /api/auth/verify
- POST /api/auth/bootstrap-verify
- GET /api/auth/public-key

## 5) Convert PEM Files To Env-Safe Values (PowerShell)

$encPriv = (Get-Content -Raw .\kdc-private.pem).Replace("`r","").Replace("`n","\n")
$encPub = (Get-Content -Raw .\kdc-public.pem).Replace("`r","").Replace("`n","\n")
$authPriv = (Get-Content -Raw .\kdc-auth-signing-private.pem).Replace("`r","").Replace("`n","\n")
$authPub = (Get-Content -Raw .\kdc-auth-signing-public.pem).Replace("`r","").Replace("`n","\n")

If you only have raw values from npm run gen:keys for encryption keys, use those directly and only convert auth keys.

## 6) Configure Environment Files

Skip this step if you have set all required env vars in your system environment.

### Option A: Local development mode

Use .env (or .env.local) with at least:

KDC_PRIVATE_KEY_PEM="..."
KDC_PUBLIC_KEY_PEM="..."
KDC_AUTH_SIGNING_PRIVATE_KEY_PEM="..."
KDC_AUTH_SIGNING_PUBLIC_KEY_PEM="..."
KDC_AUTH_SIGNING_KID="kdc-sig-current"
KDC_ENCRYPTION_KEY_KID="kdc-register-key-rsa3072-v1"
KDC_PROTOCOL_VERSION="kdc-proto-v1"
KDC_AUTH_PROTOCOL_VERSION="kdc-auth-v2"
KDC_ALLOWED_ORIGINS="http://localhost:5001"
KDC_DEFAULT_TTL_SECONDS="86400"
KDC_AUTH_PBKDF2_ITERATIONS="150000"
KDC_AUTH_CHALLENGE_TTL_SECONDS="300"
KDC_AUTH_TIMESTAMP_SKEW_SECONDS="60"
KDC_AUTH_TOKEN_TTL_SECONDS="300"
KDC_AUTH_TOKEN_ISSUER="kdc"
KDC_AUTH_TOKEN_AUDIENCE="messaging-app-server"
NODE_ENV="development"

### Option B: Local production-mode test

Use .env.production.local with:

KDC_PRIVATE_KEY_PEM="..."
KDC_PUBLIC_KEY_PEM="..."
KDC_AUTH_SIGNING_PRIVATE_KEY_PEM="..."
KDC_AUTH_SIGNING_PUBLIC_KEY_PEM="..."
KDC_AUTH_SIGNING_KID="kdc-sig-current"
KDC_ENCRYPTION_KEY_KID="kdc-register-key-rsa3072-v1"
KDC_PROTOCOL_VERSION="kdc-proto-v1"
KDC_AUTH_PROTOCOL_VERSION="kdc-auth-v2"
KDC_ALLOWED_ORIGINS="http://localhost:5001,http://localhost:3000"
KDC_DEFAULT_TTL_SECONDS="86400"
KDC_AUTH_PBKDF2_ITERATIONS="150000"
KDC_AUTH_CHALLENGE_TTL_SECONDS="300"
KDC_AUTH_TIMESTAMP_SKEW_SECONDS="60"
KDC_AUTH_TOKEN_TTL_SECONDS="300"
KDC_AUTH_TOKEN_ISSUER="kdc"
KDC_AUTH_TOKEN_AUDIENCE="messaging-app-server"
KDC_STORAGE_PREFIX="kdc"
KDC_ALLOW_IN_MEMORY_FALLBACK_IN_PRODUCTION="true"
NODE_ENV="production"

Why the fallback flag matters:
- In production mode, Redis is required unless KDC_ALLOW_IN_MEMORY_FALLBACK_IN_PRODUCTION is true.
- For local production testing without Redis, keep it true.

## 7) Run The Service

### Development mode

npm run dev

### Production-mode local test

npm run build
npm run start

Default API base URL:
- http://localhost:4000/api

## 8) Smoke Tests

### Auth public key

curl -s http://localhost:4000/api/auth/public-key

Expected fields:
- algorithm
- kid
- publicKeyPem

### KDC encryption public key

curl -s http://localhost:4000/api/keys/public-key

Expected fields:
- success
- protocolVersion
- algorithm = RSA-OAEP-256
- use = enc
- kid
- publicKeyPem

## 9) Quick Auth Flow Commands

Challenge request:

curl -s -X POST http://localhost:4000/api/auth/challenge -H "Content-Type: application/json" -d '{"protocolVersion":"kdc-auth-v2","idc":"demo-user-1","ts1":1775100001000,"n1":"AAAAAAAAAAAAAAAAAAAAAA=="}'

Verify request shape:

curl -s -X POST http://localhost:4000/api/auth/verify -H "Content-Type: application/json" -d '{"protocolVersion":"kdc-auth-v2","idc":"demo-user-1","challengeId":"<challenge-id>","ts3":1775100002000,"n2":"AAAAAAAAAAAAAAAAAAAAAA==","verifier":"<base64-32-bytes>","proof":"<base64-32-bytes>"}'

Notes:
- proof is a base64 string.
- On success, response contains token.value and encClientServerKey.

## 10) Troubleshooting

Startup fails in production mode with Redis error:
- Set KDC_ALLOW_IN_MEMORY_FALLBACK_IN_PRODUCTION="true" for local testing.
- Or provide UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.

Origin blocked:
- Make sure KDC_ALLOWED_ORIGINS exactly matches client origin, including scheme and port, no trailing slash.

Challenge/verify 401 or 409:
- Ensure challengeId is fresh and unused.
- Ensure ts values are within skew window.
- Ensure n1 and n2 are 16-byte base64 values.

Register-key ciphertext length error:
- Use /api/keys/public-key for RSA-OAEP encryption input to register-key.
- Ciphertext must decode to exactly 384 bytes for RSA-3072.

## 11) Security Notes

- Keep encryption and signing key pairs separate.
- Never commit real secrets or private keys.
- Use HTTPS outside local development.
