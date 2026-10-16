# Single-use public key allocation

Implemented2026-10-12 at the Go service layer, authenticated HTTP endpoint and mobile API client. Native session establishment and chat flows are not yet connected. Migration005 adds an allocation ledger and an allocated flag; previously applied migration004 remains unchanged.

Requests bind an operation identifier to the caller's account generation, target account, target generation and optional Circle/epoch. The authentication locks, communication authorization and key assignment share one PostgreSQL transaction.

Private requests require the currently accepted, unblocked friendship through the existing friend-pair transaction lock. Circle requests require both accounts to be current members of the supplied current epoch. The Circle service holds a shared Circle-row lock until allocation commits, preventing membership changes from racing that authorization. Private blocking does not revoke shared Circle membership.

The target account generation is held with a shared lock, so replacement cannot change the live target generation during assignment. An advisory operation lock serializes identical retries. The service selects an unexpired, unallocated prekey with `FOR UPDATE SKIP LOCKED`, marks it allocated and records its owner operation atomically. A rollback leaves the key available. Different peers cannot receive the same prekey.

Retries must still pass current authorization and return the recorded bundle. They cannot change target, generation or Circle context. A changed binding conflicts instead of silently assigning another key. An exhausted pool fails explicitly. A committed allocation may return its original now-expired bundle; native signature/lifetime validation remains required before session establishment.

Evidence: private and Circle tests were observed failing before implementation. Real PostgreSQL tests then proved consent, exact retry, exhaustion, blocked retry, current Circle membership/epoch and removed-member rejection. Three concurrent accepted peers competed for one key: exactly one succeeded and two reported exhaustion. The complete backend race suite and go vet passed.

## HTTP and mobile contract

`POST /v1/keys/allocations` accepts `{ "operationId": "saved-operation", "targetId": "account" }` for private friendship access. Circle requests also include `circleId` and the current integer `epoch`. The bearer session supplies the caller identity; caller identity fields in JSON reject. Bodies are limited to4096 bytes, must contain one object with no unknown fields or trailing JSON, and cannot have query parameters.

Success returns200 with `{ "generation": targetGeneration, "bundle": signedPublicBundle }`. All responses disable caching. Safe errors include401 `SESSION_REVOKED`,403 `DENIED`,409 `KEYS_EXHAUSTED` or `PUBLICATION_CONFLICT`,400 `INVALID_INPUT`,503 `UNAVAILABLE`. The existing conflict code also covers changed allocation bindings; callers must not silently substitute a fresh operation on conflict.

The mobile key API exposes allocation through the authentication runtime. It preserves the supplied operation/context, checks origin/session/timeout/redirect rules shared with publication, validates safe integer generation and signed bundle structure, and returns only recognized bundle fields. Shape checks do not verify cryptographic signatures; the native adapter must still validate signature, identity pin and lifetime before creating a session.

HTTP-to-PostgreSQL tests prove consent denial, a correct one-bundle response, exhaustion, actor-injection rejection and revoked access. Mobile HTTP tests prove routing bodies and rejection of invalid versions, key/signature shapes, lifetimes and generations. The complete73-test mobile suite, typecheck and lint pass; the complete backend race suite and vet pass.

Connected device evidence: [Android key-service validation](../../validation/e2e/android/key-service.md) proves real publication, allocation, native session establishment and synthetic decryption, including removed/blocked access denial.

Remaining: explicit target-replacement and authorization-race tests, product chat/session integration, key refill/retirement/capacity and two-device encrypted messaging. These tests do not prove message relay/audience enforcement or prevent a malicious client from sharing a public bundle outside its intended context.
