# Local Setup Guide

This guide is the quickest way to run the app and KDC together locally.

## 1. Copy environment templates

From the project root:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.local.example client/.env.local
```

## 2. Configure server env

Open server/.env and keep these local defaults:

- USE_MONGODB=false
- PORT=5001
- NODE_ENV=development
- ADMIN_USERNAME=admin
- ADMIN_PASSWORD=admin123
- ALLOW_RESET=true
- AUDIT_LOG_TTL_DAYS=90

Notes:
- With USE_MONGODB=false, local runs do not depend on MongoDB.
- MONGODB_URI can stay blank for local tests.
- `SESSION_SECRET` is still required for Express cookie signing. It is not replaced by KDC user/session keys.
- Set `KDC_AUTH_JWT_PUBLIC_KEY_PEM` to the KDC signing public key PEM (escaped with `\n`).
- Optionally set `KDC_AUTH_JWT_ISSUER` and `KDC_AUTH_JWT_AUDIENCE` if your KDC includes those claims.
- `AUDIT_LOG_TTL_DAYS` controls how long logs are kept in MongoDB. Note: If you change this value after the database is initialized, you must manually drop the `createdAt_1` index in MongoDB for the new TTL to take effect.

## 3. Configure client env for local KDC

Open client/.env.local and set:

- REACT_APP_KDC_AUTH_ENABLED=true
- REACT_APP_KDC_URL_DEV=http://localhost:4000
- REACT_APP_KDC_API_PREFIX=/api
- REACT_APP_KDC_USE_PROXY=true
- REACT_APP_KDC_PUBLIC_KEY_PEM_DEV=<KDC public key PEM in one line with \n escapes>

How to get REACT_APP_KDC_PUBLIC_KEY_PEM_DEV:

1. Query KDC auth signing key endpoint:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/auth/public-key | Select-Object -ExpandProperty Content
```

2. Copy publicKeyPem from the JSON response.
3. Replace real newlines with literal \n and paste into REACT_APP_KDC_PUBLIC_KEY_PEM_DEV.
4. Also copy the same value into server `KDC_AUTH_JWT_PUBLIC_KEY_PEM`.

KDC register-key endpoint note:
- Register-key encryption public key is fetched at runtime from `GET /api/keys/public-key`.
- No static `REACT_APP_KDC_KEY_PUBLIC_KEY_PEM_*` variable is required.

KDC v2 endpoint note:
- Backend now expects KDC to implement `POST /api/auth/bootstrap-verify`.
- This endpoint verifies `{ ts5, n3, proof }` using the authenticated token context and returns `{ success: true, userId }`.

## 4. Start services

Start your KDC project first (in the KDC repo).

Then start this app from project root:

```powershell
npm run dev
```

Expected local ports:
- Frontend: http://localhost:3000
- Backend: http://localhost:5001
- KDC: http://localhost:4000

## 5. Quick preflight checks

KDC checks:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/auth/public-key | Select-Object StatusCode
Invoke-WebRequest -UseBasicParsing -Method POST -Uri http://localhost:4000/api/auth/challenge -ContentType 'application/json' -Body '{"protocolVersion":"kdc-auth-v2","idc":"smoke_test","ts1":1775100001000,"n1":"AAAAAAAAAAAAAAAAAAAAAA=="}' | Select-Object StatusCode
```

Backend check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:5001/api/session | Select-Object StatusCode,Content
```

## 6. Common issues

1. npm run dev exits with MongoDB error:
- Ensure server/.env has USE_MONGODB=false.

2. KDC calls fail with 404:
- Ensure REACT_APP_KDC_API_PREFIX=/api.

3. KDC calls fail with URL errors:
- Ensure REACT_APP_KDC_URL_DEV=http://localhost:4000.

4. Browser shows CORS blocked for localhost:4000:
- Ensure REACT_APP_KDC_USE_PROXY=true so frontend calls backend `/api/kdc/*` proxy instead of direct KDC fetch.

5. Key registration fails:
- Ensure `GET /api/keys/public-key` is implemented and returns `algorithm=RSA-OAEP-256`, `use=enc`, and `publicKeyPem`.
- Ensure REACT_APP_KDC_PUBLIC_KEY_PEM_DEV is populated from /api/auth/public-key for challenge signature verification.

6. Login fails at /api/login/kdc with bootstrap verify errors:
- Ensure KDC implements `/api/auth/bootstrap-verify` and returns `success: true`.
- Ensure KDC token is signed by the key configured in `KDC_AUTH_JWT_PUBLIC_KEY_PEM`.

7. Frontend env changes not picked up:
- Stop and restart npm run dev after changing client/.env.local.

## 7. Optional production fields

You can leave these blank for local testing:

- REACT_APP_KDC_URL_PROD
- REACT_APP_KDC_PUBLIC_KEY_PEM_PROD
- REACT_APP_KDC_URL
- REACT_APP_KDC_PUBLIC_KEY_PEM

## 8. Local Production-Mode Run (Recommended for Final Verification)

Use this mode to simulate deployed behavior with a local KDC.

1. Prepare env files:
- server/.env: set NODE_ENV=production, USE_MONGODB=false, KDC_PROXY_URL=http://localhost:4000, KDC_PROXY_API_PREFIX=/api, KDC_AUTH_JWT_PUBLIC_KEY_PEM=<escaped PEM>
- client/.env.production.local:
	- REACT_APP_KDC_AUTH_ENABLED=true
	- REACT_APP_KDC_URL_PROD=http://localhost:4000
	- REACT_APP_KDC_API_PREFIX=/api
	- REACT_APP_KDC_PUBLIC_KEY_PEM_PROD=<escaped PEM>

2. Build frontend with production env:

```powershell
npm run build
```

3. Start backend in production mode (serves built client):

```powershell
npm start
```

4. Open app at http://localhost:5001 and verify login + messaging flow.

5. Production-mode debug checks:
- If login fails with 401 from /api/login/kdc:
	- verify backend KDC URL: server KDC_PROXY_URL and KDC_PROXY_API_PREFIX
	- verify token signature key: server KDC_AUTH_JWT_PUBLIC_KEY_PEM
	- verify KDC implements POST /api/auth/bootstrap-verify
- If browser shows KDC CORS errors:
	- allow origin http://localhost:5001 in KDC CORS policy
- If create-session fails:
	- confirm KDC returns ticketA and ticketB (not legacy fields)
