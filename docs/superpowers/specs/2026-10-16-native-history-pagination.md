# Native conversation history pagination

## Goal

Let an authenticated Android user recover and load older encrypted messages for the conversation currently open, using events still retained by the relay for the active account generation.

## Behavior

- Add an authenticated, read-only, cursor-paginated history request scoped to one conversation and one audience.
- Return only ciphertext already addressed to the requesting account and active generation. The server does not receive or return plaintext.
- Keep ordering stable by the recipient delivery sequence. A missing cursor starts at the newest retained page; a cursor selects strictly older records.
- Bind a cursor to the same actor, generation, conversation, and audience. Reject cursors from another scope.
- Exclude server-redacted events. The client synchronizes redactions before and after each history page, then receives events through the existing durable E2E receive path without acknowledging them again, and refreshes local SQLCipher history.
- Reuse current authorization rules: private history requires the currently accepted friendship and matching request audience; Circle history requires the actor's current membership interval to match the event's original delivery interval. A later Circle join cannot load earlier-epoch history.
- The Android chat shows a compact “Load earlier messages” action only while an older page exists. It offers loading and retry feedback and hides when no more history remains.
- History retrieval supplements the active device's encrypted local history. It does not recover ciphertext addressed to an older device generation; replacement-device recovery remains through encrypted backup.

## Limits

- Page size is 1–25 events.
- The endpoint is scoped to a single `conversation` and `audience`; query keys are `conversation`, `audience`, `cursor`, and `limit` only.
- Cursor is a server event ID already present in the caller's delivery history for that exact scope.
- History pages never acknowledge or change delivery state. Existing receipt state remains authoritative.

## Acceptance

- Private and Circle pages return only authorized active-generation ciphertext, in stable page order, without modifying delivery acknowledgements.
- Redacted events, blocked/unaccepted private relationships, foreign cursors, old Circle intervals, malformed query values, and out-of-range page sizes are rejected or omitted as appropriate.
- Android can fetch a page, receive it idempotently through the existing native crypto path, refresh its local history, and request the next older page without duplicate messages.
- Focused Go and mobile regressions fail before implementation and pass after it. PostgreSQL-backed tests are reported as skipped if `AWSEM_TEST_DATABASE_URL` is unavailable; emulator acceptance remains separate.
