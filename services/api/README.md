# AwsemChat API

Go 1.25 with pgx 5.7.6. The current executable serves development authentication only. Messaging, social features, encrypted media and mobile integration are still being implemented. No real SMS provider is configured.

## Run locally

Set these variables in your local shell or process environment:

- `DATABASE_URL`: your development PostgreSQL URL.
- `AWSEM_AUTH_MODE=development-mock`: required explicitly; production mode currently refuses startup.
- `AWSEM_AUTH_PEPPER_HEX`: 64 hex characters representing 32 nonzero random bytes. Keep it stable and private; changing it breaks phone lookup and outstanding OTP verification.
- `AWSEM_BIND=127.0.0.1:8088`: optional; only literal loopback IPs are allowed while using mock SMS.

From this directory:

```sh
go run ./cmd/migrate
go run ./cmd/api
```

Migration is explicit and transactional. Starting the API never creates tables. `GET /health/ready` returns 503 when the migration checksum or required identity tables are missing.

## Authentication endpoints

- `POST /v1/auth/challenges`: `{ "phone": "+6281234567890", "deviceId": "device-id", "operationId": "unique-operation-id" }`.
- `POST /dev/otp`: `{ "phone": "+6281234567890" }`. Development mock only, loopback caller only, returns the in-memory code. Codes expire after five minutes and disappear on restart. Nothing is sent to real users.
- `POST /v1/auth/verify`: `{ "challengeId": "challenge-id", "code": "six-digits", "deviceId": "device-id" }`.
- `GET /v1/session`: `Authorization: Bearer <accessToken>`.
- `POST /v1/auth/logout`: same authorization header; revokes that token.

Replacement-phone verification keeps the account and original PIN, increments the active device generation and revokes previous phone sessions. It does not recover encrypted history. Codes, phone numbers and access tokens are never logged or stored raw in PostgreSQL.

## Tests

Use an isolated development database; tests create random schemas and remove only their own schemas. PostgreSQL integration tests skip when `AWSEM_TEST_DATABASE_URL` is absent.

```sh
AWSEM_TEST_DATABASE_URL="$DATABASE_URL" go test -race ./... -count=1
go vet ./...
```

Current verified fixture: PostgreSQL 17, local Docker container `awsemchat-mvp-postgres17`, loopback port 55432. Integration tests cover challenge expiry, replay, attempts, send limits, replacement-session revocation, logout, safe HTTP responses, explicit mock access, concurrent migrations, schema readiness and server shutdown.

## Social endpoints

Every route requires the current bearer token; actor identity comes from that session, never JSON input.

- `GET /v1/friends?kind=accepted&limit=25&cursor=<accountId>`: kind is accepted, incoming, outgoing or blocked. Items contain opaque account ID, fixed PIN, relationship status and request ID when applicable. Empty results use `items: []`; `nextCursor` is omitted on the final page.
- `POST /v1/friends/requests`: `{ "pin": "ABCDEFGH" }`.
- `POST /v1/friends/requests/<requestId>/response`: `{ "accept": true }` or false for decline.
- `PUT /v1/friends/blocks/<accountId>`: `{ "blocked": true }` or false for unblock.

Requests and responses use no-store caching and safe error codes. Unknown fields, trailing JSON, missing booleans and duplicate/unknown query parameters are rejected. Profile names, statuses and avatars are encrypted client data; the social relay does not supply plaintext profile fields. Circle endpoints and mobile social synchronization are still being implemented.
