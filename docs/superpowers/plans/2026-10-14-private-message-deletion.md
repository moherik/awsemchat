# Private and Circle message deletion implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. The user chose inline implementation with test-driven development. Do not use subagent-driven development.

**Goal:** Allow people to delete selected messages they sent in private chats and Circles from every original participant’s AwsemChat history, including after reconnect and old-backup restore.

**Architecture:** PostgreSQL keeps a minimal redaction ledger visible only to the author and fixed original recipient accounts, and atomically removes relay ciphertext and delivery ciphertext. The native sealed store links committed server event IDs to messages, persists pending deletes and a redaction cursor, and applies redactions to live and archived records atomically. Mobile sync applies redactions before exposing refreshed history; backup restore fetches all redactions before importing. Encrypted control notices are best-effort and must never expand a Circle’s original recipient set.

**Tech Stack:** Go 1.25, PostgreSQL/pgx, Expo/TypeScript, Rust native durable store, SQLCipher personal-sticker storage, existing archive codec and Node/Jest tests.

**Spec:** [docs/superpowers/specs/2026-10-14-private-message-deletion.md](../specs/2026-10-14-private-message-deletion.md)

## Global Constraints

- Only the authenticated author account can redact its own supported private-chat or Circle Chat event; another author’s event and non-message transport controls are rejected.
- Redaction removes relay ciphertext and is visible only to the author and accounts in the event’s original fixed recipient set; later Circle members cannot enumerate old redactions.
- A recipient may keep an offline copy until reconnect; restored history stays hidden until the online redaction check completes.
- Legacy archive matching uses conversation, exact friendship/Circle audience, operation ID, and both sender public identities; ambiguous matches fail closed.
- Native redaction page application and cursor advancement commit atomically with native encrypted message-history mutation.
- Pending deletes retry the exact target and operation; local content is permanently purged only after authoritative server confirmation.
- No read receipt is created; redaction does not change Circle delivery, leave/rejoin, or fixed-original-recipient semantics.
- Preserve the existing staged and unstaged work. Do not commit or push: the shared index already contains unrelated project work.
- Do not run emulator interaction tests; the user asked to skip emulator testing. Supabase is unconfigured and is not part of this server-ledger change.

## Review Focus

- **Late redaction commits and pagination:** an account cursor must not skip a redaction that commits late; test concurrent writes for a shared account.
- **Delete versus send/receive races:** after redaction commit, inbox or an already-fetched delivery must not restore the message; test server filtering and native replay handling.
- **Legacy backup ambiguity:** fallback identity must remove only one exact old record and reject multiple matches; test both outcomes.
- **Restore/network/account-switch failure:** redaction lookup failure or session replacement must leave the active native history unchanged; test both.
- **Lost deletion response and notice retry:** exact retries must not create another redaction or encrypted notice; test process-restart recovery.

---

### Task 1: Redaction ledger and relay enforcement

**Files:**
- Create: `services/api/migrations/016_message_redactions.sql`
- Modify: `services/api/migrations/migrate.go`, `services/api/migrations/migrate_test.go`
- Create: `services/api/internal/messages/redactions.go`, `services/api/internal/messages/redactions_test.go`
- Modify: `services/api/internal/messages/http.go`, `services/api/internal/messages/http_test.go`
- Modify: `services/api/internal/messages/inbox.go`, `services/api/internal/messages/receipts.go`
- Modify: `services/api/internal/media/service.go`, `services/api/internal/media/service_test.go`

**Interfaces:**
- `Redaction` returns `eventId`, `conversation`, `audience`, `operation`, `sender` public keys, and the account-scoped pagination cursor; it contains no content.
- `RedactionPage` returns `items`, `cursor`, and `more`.
- `RedactionTarget` is exactly one of `{ EventID string }` or `{ Legacy *LegacyMessageIdentity }`; `LegacyMessageIdentity` contains `Conversation`, `Audience`, `Operation`, and sender `PeerKeys`.
- `(*Service).Redact(ctx context.Context, actor auth.Principal, target RedactionTarget) (Redaction, error)` is idempotent for an event authored by the actor’s account. Descriptor lookup must resolve exactly one event.
- `(*Service).Redactions(ctx context.Context, actor auth.Principal, cursor string, limit int) (RedactionPage, error)` returns only records where the actor is the author or an account in the event’s immutable original delivery set.
- Add authenticated `POST /v1/messages/redactions` with exactly one of `{ "eventId": "…" }` or `{ "legacy": { "conversation": "…", "audience": "…", "operation": "…", "peerKeys": { … } } }`, and `GET /v1/messages/redactions?cursor=…&limit=…`; reject unknown/repeated fields and malformed input.
- New redactions carry a legacy descriptor (conversation, audience, operation, sender identity and signing identity) copied before ciphertext is cleared. Retain the operation digest and immutable original-recipient account IDs for idempotency, feed authorization and replay protection. Create one account-feed record for the author and each original recipient; do not create records for current members who were not recipients. Because the existing event and delivery ciphertext columns are non-null, replace them transactionally with valid empty JSON objects and mark the event redacted; preserve delivery sequence rows so inbox cursors remain valid.

- [x] **Step 1: Write handler-driven PostgreSQL tests** for private and Circle sender success by event ID and by legacy descriptor, idempotent retry, rejection of another sender, non-message control, outsider, later Circle member, missing event, malformed/ambiguous descriptor; redaction clears the original event envelope and every fixed delivery ciphertext, suppresses inbox/status content, prevents exact send retry from resurrecting ciphertext, denies private and Circle event-bound media reads, and leaves unrelated events intact. Include a former Circle member from the original delivery set and prove it can reconcile the redaction while a later joiner cannot. Initially call the current handler and assert the new route returns the expected success, so it fails with `404` rather than a compile error. RED evidence is recorded in the SDD ledger.
- [x] **Step 2: Run** `cd services/api && go test ./internal/messages -run 'Test(Redact|Redactions|Inbox.*Redact|Status.*Redact)' -count=1`; confirm the new endpoint test fails with the expected `404`. The route-level RED check is recorded in the ledger; latest focused PostgreSQL integration run passed.
- [x] **Step 3: Add the additive migration and implement** the event redaction plus per-account feed entries, preserving only the minimal target descriptor, digest and original account audience while clearing ciphertext in the same transaction. Derive Circle recipients from the original `message_deliveries`, never current membership. Lock all affected account redaction queues in stable account-ID order so paginated cursors cannot skip late commits.
- [x] **Step 4: Add redaction-feed pagination and migration tests** for sender/original-recipient account scoping, later Circle joiner exclusion, replacement generations, cursor validation, and competing commits touching overlapping Circle audiences.
- [x] **Step 5: Run** `cd services/api && go test ./internal/messages ./migrations -count=1`; require all named service and migration tests to pass. Current focused packages passed under the race detector; the complete Go race suite also passed.
- [x] **Step 6: Add HTTP tests** for auth, body/query strictness, no-store headers, actor/recipient visibility, and safe errors; run `cd services/api && go test ./internal/messages -run 'Test.*HTTP.*Redact' -count=1` and observe failure before handlers. The existing handler RED check and latest focused run are recorded in the ledger.
- [x] **Step 7: Implement HTTP handlers and filter redacted messages** from inbox, sender status, exact send retry, and private/Circle event-bound media reads; run `cd services/api && go test ./internal/messages ./internal/media -count=1` and require pass. Sender status reports a terminal `redacted` state; a send retry returns a typed redacted conflict and never recreates relay ciphertext or delivery rows. Existing delivery sequence rows remain as cursor/receipt metadata but cannot expose payloads.

### Task 2: Native event identity and durable redaction application

**Files:**
- Modify: `apps/mobile/modules/awsemchat-crypto/rust/src/durable.rs`
- Modify: `apps/mobile/modules/awsemchat-crypto/rust/tests/durable.rs`
- Modify: `apps/mobile/modules/awsemchat-crypto/src/AwsemchatCryptoModule.ts`
- Modify: `apps/mobile/src/security/durable-encryption.ts`
- Modify: `apps/mobile/src/features/messages/receive.ts`, `send.ts`
- Modify: `apps/mobile/src/features/messages/outbox-sync.ts`
- Modify: `apps/mobile/src/features/backup/history-backup.ts`
- Modify: `apps/mobile/tests/history-backup.test.mjs`

**Interfaces:**
- Add `serverEventId?: string` to durable and outgoing history. Incoming receive takes the server event ID and commits it with the encrypted plaintext; committed-receive proof binds it to the exact delivery. `confirmSend` persists the sender’s server event ID as part of outgoing history/archive export. A terminal redacted sender status retires the old retryable operation without restoring its plaintext row.
- Use `RedactionTarget = { eventId: string } | { legacy: LegacyMessageIdentity }`. Add `beginRedaction(target, operation)`, `pendingRedactions()`, `confirmRedaction(target, redaction)`, `applyRedactions(input: { previousCursor: string | null; cursor: string; items: readonly Redaction[] })`, and `completeRedaction(eventId)` to the native facade. Confirming a sender’s redaction removes the target from history and the retryable outbox and marks its notice pending but does not advance the feed cursor; applying a feed page removes exact matches and advances the cursor in one sealed-state commit. Pending notice state stores one stable notice operation so retries reuse the exact encrypted control event; it clears only after that event commits or the route is definitively unavailable.
- Redaction matching prefers `serverEventId`; old archives use the spec’s full legacy descriptor. More than one match for a single descriptor returns a conflict without changing state.

- [x] **Step 1: Add Rust tests** by issuing the new operations through the durable request JSON, proving received event IDs survive reopening/export/import, sender confirmation associates the ID, direct and legacy redactions remove exactly one record across live/outgoing/archive state, redacted outgoing operations no longer appear in retry reconciliation, ambiguity rejects atomically, pending requests survive reopen with the same notice operation, and page cursor does not advance when validation fails.
- [x] **Step 2: Run** the planned RED check. Ruling: the plan’s `--lib durable::tests::redaction` selector did not match the repository’s integration-test layout, so the equivalent new `tests/durable.rs` tests were run instead and failed before native support existed.
- [x] **Step 3: Implement the native data model and operations** with optional serde fields for old-state compatibility; preserve the current 768-record cap and all existing crypto proof rules.
- [x] **Step 4: Run** `cd apps/mobile/modules/awsemchat-crypto/rust && cargo test`; require the complete Rust suite to pass.
- [x] **Step 5: Add mobile facade, receive/send, and archive propagation tests** showing event ID reaches receive/proof and `confirmSend`, and is preserved through encrypted archive creation/restoration, without acknowledging before the native commit; `node --experimental-strip-types --test tests/message-receive.test.mjs tests/message-send.test.mjs tests/history-backup.test.mjs` passed (41 tests).

### Task 3: Account API, deletion coordinator, and ordered synchronization

**Files:**
- Modify: `apps/mobile/src/features/messages/api.ts`, `account-inbox.ts`, `inbox-sync.ts`, `sync-scheduler.ts`
- Create: `apps/mobile/src/features/messages/redaction-sync.ts`
- Create: `apps/mobile/src/features/messages/private-message-deletion.ts`
- Modify: `apps/mobile/src/features/auth/runtime.ts`
- Create: `apps/mobile/tests/message-redaction.test.mjs`
- Modify: `apps/mobile/tests/message-api.test.mjs`, `apps/mobile/tests/inbox-sync.test.mjs`
- Modify: `apps/mobile/tests/outbox-sync.test.mjs`

**Interfaces:**
- `createMessageAPI` exposes `redact(target: RedactionTarget)` and `redactions(cursor?: string, limit?: number): Promise<RedactionPage>` with strict parsers and account/session checks.
- `createRedactionSynchronizer(native, api).run()` applies pages from the persisted native cursor and returns `{ more: boolean }`. Integrate it into the worker created by `createAccountInbox` so every scheduler/manual sync runs redactions before inbox; apply a second bounded redaction pass before publishing refreshed history to close races with in-flight inbox pages.
- `createPrivateMessageDeletion({ account, native, api, sender, route, operation }).delete(target: RedactionTarget)` persists one stable pending operation, calls idempotent server redaction, removes local content and retryable outbox data only after confirmation, and schedules an encrypted control message only when the exact original participants remain addressable. For a Circle it must never use an expanded current audience. Its operation ID is durably allocated with the pending deletion and reused for every retry. `retry()` resumes the exact pending target and notice.
- Versioned deletion control payload encodes the target event ID and legacy descriptor; strict decode rejects wrong audience, unknown fields, malformed identity, and oversized bodies. Control events never appear as chat rows.

- [x] **Step 1: Add mobile API and coordinator tests** for strict response parsing, sender confirmation, retry after lost response, account replacement during requests, offline pending state, and no duplicate control event; the new API/coordinator tests were observed failing before implementation.
- [x] **Step 2: Implement API methods and the deletion payload codec**; `node --experimental-strip-types --test tests/message-api.test.mjs` (18 tests) and `tests/message-redaction.test.mjs` passed.
- [x] **Step 3: Add redaction-sync tests** for pagination, replay after crash, page order, failed native commit retaining cursor, and session switch suppressing writes; the missing-module RED check failed before implementation.
- [x] **Step 4: Implement the synchronizer and runtime ordering** so redactions run before inbox ingestion and before history refresh. The redaction-sync and inbox-sync suites passed.
- [x] **Step 5: Add deletion coordinator and outbox tests** proving pending/rejection states, account replacement fencing, confirmed deletion and retry cleanup, idempotent control notice retry, fixed Circle recipient routing, hidden control records, and no resend of redacted operations. The focused mobile behavior suite passed (56 tests); the Rust durable integration suite passed (46 tests).

### Task 4: Backup reconciliation before import

**Files:**
- Modify: `apps/mobile/src/features/backup/history-backup.ts`, `apps/mobile/src/features/backup/screen.tsx`
- Modify: `apps/mobile/tests/history-backup.test.mjs`, `apps/mobile/tests/local-backup.test.mjs`, `apps/mobile/tests/drive-backup.test.mjs`

**Interfaces:**
- Extend `createHistoryBackup` ports with an account-bound redaction reader and a native pending-delete reader. Restore fetches the full ledger from an empty cursor, validates every descriptor, filters matching history records, then imports messages and stickers. New archive creation excludes history covered by pending deletes while retaining its separate exact retry state.
- A network error, malformed ledger, ambiguous legacy match, or account change aborts before either message or sticker import. The encrypted source backup is not modified. Message and sticker stores commit independently; if the sticker merge fails after message import, repeating restore safely converges both stores.

- [x] **Step 1: Add backup tests** for modern event-ID filtering, legacy descriptor filtering, malformed/ambiguous redactions, offline API failure, account replacement between lookup and import, and retry after history import succeeds but sticker merge fails; assert neither library is imported for pre-import failures and retry converges the stores.
- [x] **Step 2: Run** `cd apps/mobile && node --experimental-strip-types --test tests/history-backup.test.mjs tests/local-backup.test.mjs tests/drive-backup.test.mjs`; new restore regressions initially failed because restore did not consult redactions.
- [x] **Step 3: Implement full-ledger reconciliation before native import** and ensure the backup screen explains that restore needs a connection when reconciliation is unavailable.
- [x] **Step 4: Run** the same focused backup suite and require pass, including existing sticker chunk and archive-authentication cases (47 tests passed). New archive creation also omits messages whose native deletion is pending server confirmation, matching by event ID or exact legacy descriptor.

### Task 5: Private Chat and Circle selection and delete interaction

**Files:**
- Modify: `apps/mobile/src/features/messages/conversation-view.ts`, `screen.tsx`
- Modify: `apps/mobile/tests/private-chat-moments.ui.test.tsx`, `conversation-view.test.mjs`

**Interfaces:**
- Conversation rows expose `eventId` when known and preserve `conversation`, `audience`, `operation`, and sender keys for legacy targeting. Pending own-message redactions are hidden from the visible projection but retain a pending state for retry.
- Long-press on an own private-chat or Circle Chat row offers **Delete for everyone**; other-authored messages do not. Multi-selection may include only the current account’s authored messages in the active conversation. Circle admins have no extra deletion rights over another author’s message. Confirmation invokes the runtime coordinator; success, pending, and failure use the shared snackbar feedback.
- Standalone Moment controls remain in the Moments tab. Moment replies rendered as Chat rows can be selected and deleted like other own Chat messages.

- [x] **Step 1: Add projection and rendered UI tests** for own versus other messages in private chat and Circle, author-only deletion, multi-select boundaries, Circle admin versus member rights, Moment replies, confirmation, pending/success feedback, and ensuring deletion controls do not become chat bubbles; projection regressions were observed failing before implementation.
- [x] **Step 2: Implement event identity and selection behavior** using the existing shared long-press popup and snackbar components; keep existing reply/reaction interactions intact. Pending deletion retries are connected to account message sync.
- [x] **Step 3: Run** `cd apps/mobile && npm run test:ui -- --runTestsByPath tests/private-chat-moments.ui.test.tsx` and `node --experimental-strip-types --test tests/conversation-view.test.mjs`; require pass. The UI suite passed 10 tests and projection tests passed 19; TypeScript and lint passed.

### Task 6: End-to-end regression, living documentation, and project status

**Files:**
- Modify: `docs/technical/message-relay.md`, `docs/technical/history-backup.md`, `docs/technical/private-moments.md`, `docs/technical/project-status.md`
- Modify only if verification finds a defect: the affected source/test files from Tasks 1–5.

- [x] **Step 1: Run complete mobile behavior and UI suites:** `cd apps/mobile && npm run test:demo && npm run test:ui`; 531 behavior tests and 10 UI tests passed.
- [x] **Step 2: Run mobile static checks:** `cd apps/mobile && npx tsc --noEmit && npm run lint`; both completed without errors.
- [x] **Step 3: Run native and backend verification:** `cd apps/mobile/modules/awsemchat-crypto/rust && cargo test`; `cd services/api && go test -race ./... && go vet ./...`; Rust (62 tests), Go race tests and vet passed against PostgreSQL17.
- [x] **Step 4: Review the full diff against the spec**, inspect `git diff --check HEAD`, and update living contracts/status with actual results, migration016, the online restore requirement and unverified device/provider acceptance. Emulator acceptance is not claimed.

## Delivery

Circle deletion verification refresh (2026-10-15): the approved implementation was already present in the shared checkout. Focused PostgreSQL redaction integration, full Go race tests and vet, 558 mobile behavior tests, 18 UI tests, 63 Rust tests, TypeScript, Expo lint and whitespace checks pass. A fresh read-only review found no Critical or Important issues; it notes the integration coverage exercises an original recipient leaving and a later joiner exclusion. Emulator acceptance remains skipped by user direction. No files were staged or committed because the shared index contains unrelated work.

Do not commit or push. The checkout already contains unrelated staged work, and no commit or publication was requested. Report the completed implementation, exact verification results, remaining device/Supabase gates, and current project status when the full task is complete.
