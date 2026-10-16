# Public key registration

Implemented 2026-10-12: the Go registration service persists account-bound public batches in PostgreSQL and is mounted as an authenticated HTTP endpoint. Mobile account preparation now uploads the native registration and confirms publication only after acknowledgement.

Migration004 adds generation-bound public identities, publication digests and signed prekey bundles. No private keys, phone numbers or session tokens are stored in these tables.

`Publish` verifies the native batch and account-publication signatures against the supplied authenticated principal. Within one transaction it holds the existing authentication account/session locks, then serializes writes on the generation's encryption identity. A revoked or replaced session cannot register keys. The identity and device are fixed for that account generation.

The publication identifier is the native saved operation identifier. The service hashes the typed registration, including its proof and ordered bundles. A committed byte-equivalent registration receives an acknowledgement even after expiry. Changed payloads under that identifier conflict. A new expired batch is rejected. Key identifiers and prekeys cannot be registered twice within a generation; any conflict rolls back the whole transaction.

Evidence: tests first failed on missing persistence, then passed against isolated real PostgreSQL schemas. The complete backend suite passed with the race detector, followed by go vet. Tests cover stored row counts, exact expired retries, changed retries, expired new batches and revoked sessions.

## HTTP contract

`POST /v1/keys/publications` requires exactly one bearer Authorization header. Its JSON body is `{ "bundles": [signedPublicBundle], "proof": "nativeAccountPublicationSignature" }`; account, device and generation are derived from the authenticated session. The body limit is32768 bytes. Unknown fields, null bodies, trailing JSON and query parameters reject. Success returns204 with no body, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

Errors return only a fixed code:401 `SESSION_REVOKED`,409 `PUBLICATION_CONFLICT`,400 `BUNDLE_EXPIRED` or `INVALID_INPUT`,503 `UNAVAILABLE`. Signature failures never expose raw keys or validation details. Actual HTTP-to-PostgreSQL tests cover authentication, persistence acknowledgement, malformed inputs and revoked sessions; the server composition test confirms the route is mounted.

## Mobile acknowledgement

The mobile client accepts only an empty204 success response. It rejects redirects and unsafe origins, bounds requests with a15-second timeout, sanitizes backend failures and discards responses if the account/device/generation/token changes while waiting. No automatic HTTP retry changes the operation.

Account preparation reads the native pending publication identifier and reuses it after an ambiguous upload failure. Otherwise it creates an operation identifier, prepares and signs the batch, uploads it, then confirms it natively after server acknowledgement. Account-session guards surround each operation. A full twenty-key acknowledged pool performs no extra publication on login restore. Login remains in its existing retryable preparation step when upload fails. The native stored batch remains the retry source; JavaScript does not regenerate keys to recover a lost reply.

Evidence: the complete71-test mobile suite, TypeScript and lint pass. Local HTTP tests exercise exact upload bodies, strict acknowledgements and response suppression after session replacement. Native-boundary tests exercise pending-operation reuse, upload failure without confirmation, confirmation ordering and full-pool restoration. These tests do not prove a device-to-live-server publication; that walkthrough remains required.

Connected device evidence: the Android harness now publishes native proofs through the real mobile client to Go/PostgreSQL, confirms the acknowledged batch and establishes a native session from a server allocation. See [device key-service validation](../../validation/e2e/android/key-service.md). Migrations004 and005 were explicitly applied to the local synthetic database only.

Remaining: independent concurrency/replacement tests for publication, expired pending-batch retirement, directory lifecycle/capacity and encrypted message transport. Deployment migrations remain explicit steps.
