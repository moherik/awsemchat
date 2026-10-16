# Operation-bound media cleanup implementation plan

> **For agentic workers:** Implement inline in the existing worktree with the approved test-driven-development method. Preserve the current index, worktree edits, and untracked files; do not commit or push.

**Goal:** Ensure every Circle ciphertext object can be safely deleted after a relay operation is cancelled, while preserving every object whose event committed.

**Architecture:** Add a shared account-generation-operation lock and durable cancellation tombstone checked by relay send and media upload. Bind uploaded Circle objects to an operation, enqueue exact object deletion transactionally, and run idempotent local-storage cleanup with restart-safe retries. Persist operation cancellation in the mobile upload intent and only clear protected state on a definitive cancelled result; reconcile committed events and preserve state on uncertainty.

**Tech Stack:** Go 1.25, PostgreSQL/pgx, `net/http`, local private filesystem storage, Expo/TypeScript, protected native upload vault, Node test runner.

**Spec:** [docs/superpowers/specs/2026-10-14-operation-bound-media-cleanup.md](../specs/2026-10-14-operation-bound-media-cleanup.md)

## Global Constraints

- Never delete media if its relay event exists for the same account, generation, and operation.
- Relay send, upload, and cancellation use the exact same account-generation-operation lock.
- Acquire the authenticated session lock first and the shared operation lock second; media authorization/row locks follow. Cancellation commits its tombstone before releasing the operation lock, then deletes outside the transaction.
- Cancellation tombstones are permanent for the account generation and prevent delayed sends and uploads.
- Only opaque ciphertext and server-derived object IDs reach storage; keys, plaintext, captions, and recipient lists stay out of the media API.
- Preserve exact Circle, epoch, object ID, ciphertext, original recipients, and envelope on retries.
- Circle media reads become denied as soon as cancellation commits, even before provider deletion completes.
- Cleanup is durable, idempotent, bounded, and retried after service restart.
- Legacy database media claims without a provable operation remain readable under current grants and are not guessed into the cleanup queue.
- Leave all existing staged and unstaged changes intact; do not commit or push.

## Review Focus

- Send/cancel race: assert cancellation and message commit cannot both win, with one forced ordering in each direction.
- Upload/cancel race: assert a put either completes before cancellation and is queued for deletion or is rejected after the tombstone.
- Lost cancellation response: assert retries return the same terminal state and never resurrect or delete committed media.
- Collection snapshot fan-out: assert multiple media objects map to their publishing part operation and cancellation removes only that operation's objects.
- Legacy and replacement-generation state: assert migration-era media and prior-generation operations cannot be accidentally deleted or reused.

---

### Task 1: Shared operation arbitration and relay cancellation fence

**Files:**
- Create: `services/api/internal/operations/lock.go`
- Create: `services/api/internal/operations/lock_test.go`
- Create: `services/api/migrations/014_operation_media_cleanup.sql`
- Modify: `services/api/internal/messages/profile_cancel.go`
- Modify: `services/api/internal/messages/send.go`
- Modify: `services/api/internal/messages/profile_cancel_test.go`
- Modify: `services/api/internal/messages/send_test.go`
- Modify: `services/api/migrations/migrate.go`
- Modify: `services/api/migrations/migrate_test.go`

**Interfaces:**
- Produce `operations.Lock(ctx context.Context, tx pgx.Tx, accountID string, generation int64, operationID string) error`, deriving the current `awsemchat.message-operation` advisory key once.
- Migration 014 creates `message_operation_cancellations(sender_id,sender_generation,operation_id,created_at)` with a composite primary key and `circle_media_cleanup(object_id,circle_id,owner_id,owner_generation,operation_id,state,created_at,completed_at)` with exact object ownership and retry state. Add nullable generation/operation fields to existing media claims for legacy compatibility.
- `messages.operationState` uses the shared lock and checks committed events before cancellation tombstones. Tombstoned operations return `ErrCancelled` before relay writes.

- [x] **Step 1: Add failing relay tests** for a pre-existing cancellation tombstone rejecting send, exact committed retry still returning its original event, and owner/generation isolation.
- [x] **Step 2: Run** `cd services/api && go test ./internal/messages -run 'TestSend.*(Cancelled|Generation|Committed)' -count=1`; verify the new behavior fails because relay does not read the generic tombstone.
- [x] **Step 3: Implement** migration 014, `operations.Lock`, and relay lookup under that lock; preserve existing profile/collection cancellation digest behavior while making generic tombstones an additional cancellation fence.
- [x] **Step 4: Run** `cd services/api && go test ./internal/operations ./internal/messages ./migrations -count=1`; require all tests pass.

### Task 2: Operation-bound media claims, cancellation API, and exact deletion

**Files:**
- Modify: `services/api/internal/media/service.go`
- Modify: `services/api/internal/media/http.go`
- Modify: `services/api/internal/media/http_test.go`
- Modify: `services/api/internal/media/service_test.go`
- Modify: `services/api/internal/media/local.go`
- Modify: `services/api/internal/media/local_test.go`
- Modify: media test storage fakes implementing `media.Storage`

**Interfaces:**
- Extend `media.Storage` with `Delete(context.Context, string) error`; absent objects count as successfully deleted.
- Change `PutCircle` to accept `operationID string` and store exact owner generation and operation binding; use `operations.Lock` before inspecting tombstones or publishing bytes.
- Add `CancelOperation(ctx context.Context, actor auth.Principal, circleID, operationID string) (OperationCancellation, error)`, returning `state` `cancelled` or `committed` and an event identity for committed operations.
- Add strict `PUT .../objects/{objectID}?epoch={epoch}&operation={operation}` and authenticated `POST /v1/media/circles/{circleID}/operations/{operationID}/cancel`; continue accepting GET unchanged.

- [x] **Step 1: Add failing PostgreSQL/filesystem tests** for operation-bound exact retry, tombstoned PUT rejection, committed-event preservation, cancellation tombstone plus per-object queue creation, owner/generation isolation, `Delete` idempotency/traversal rejection, and barrier-controlled send/cancel races in both lock-acquisition orders.
- [x] **Step 2: Run** `cd services/api && go test ./internal/media ./internal/messages -run 'Test(Put|Cancel|Delete|Send).*Operation' -count=1`; confirm expected failures.
- [x] **Step 3: Implement** strict operation validation, transactionally bind claims and create tombstone/cleanup rows only when no event exists, and add safe idempotent filesystem deletion.
- [x] **Step 4: Add failing HTTP tests** for duplicate/missing/unknown operation query fields, auth, cancellation response semantics, strict body/path handling, and no-store headers; run `go test ./internal/media -run 'TestHTTP.*(Operation|Cancel)' -count=1` and confirm failure.
- [x] **Step 5: Implement** HTTP handlers and bounded public error mapping; run `cd services/api && go test ./internal/media -count=1` and require pass.

### Task 3: Durable cleanup worker and service wiring

**Files:**
- Create: `services/api/internal/media/cleanup.go`
- Create: `services/api/internal/media/cleanup_test.go`
- Modify: `services/api/internal/server/server.go`
- Modify: `services/api/internal/server/server_test.go`

**Interfaces:**
- Add `(*Service).DrainCleanup(ctx context.Context, batchSize int) (int, error)` to atomically claim bounded work, delete exact object IDs idempotently, and mark completed only after storage confirms deletion.
- Add a context-bound worker in the media service: immediate bounded drain after cancellation plus startup and periodic bounded drain with backoff. Failure retains queue entries and never removes tombstones/read fences.
- Wire worker lifecycle to the API server context and media-enabled configuration; no worker/storage route when media is disabled.

- [x] **Step 1: Add failing tests** for retry after injected storage failure, absent object success, bounded batch progression, cancellation-read fence before physical deletion, and restart recovery from persisted queue rows.
- [x] **Step 2: Run** `cd services/api && go test ./internal/media -run 'TestCleanup' -count=1`; verify the cleanup worker is absent.
- [x] **Step 3: Implement** bounded drain and service lifecycle; ensure worker shutdown respects context cancellation and does not hold database transactions during storage I/O.
- [x] **Step 4: Run** `cd services/api && go test ./internal/media ./internal/server -count=1`; require pass.

### Task 4: Bind every mobile Circle media publication to its relay operation

**Files:**
- Modify: `apps/mobile/src/features/media/encrypted-media.ts`
- Modify: `apps/mobile/src/features/media/api.ts`
- Modify: `apps/mobile/src/features/media/upload.ts`
- Modify: `apps/mobile/src/features/media/upload-vault.ts`
- Modify: `apps/mobile/src/features/social/circle-avatar-editor.ts`
- Modify: `apps/mobile/src/features/social/circle-profile.ts`
- Modify: `apps/mobile/src/features/social/circle-collection-refresh.ts`
- Modify: `apps/mobile/src/features/social/collection-snapshot-publisher.ts`
- Modify: `apps/mobile/src/features/messages/circle-moment-editor.ts`
- Modify: `apps/mobile/src/features/messages/circle-sticker-sender.ts`
- Modify: chat image media sender located by `rg -n 'chatImageIntent|createCircleMediaUpload' apps/mobile/src/features`
- Modify: corresponding media API, upload, vault, avatar, collection, snapshot, moment, sticker, and photo tests under `apps/mobile/tests/`

**Interfaces:**
- Extend `CiphertextStorage.put(id: string, ciphertext: string, operationID: string): Promise<void>` and implement `cancel(operationID: string): Promise<{ state: 'cancelled' } | { state: 'committed'; eventId: string }>` in the authenticated Circle API adapter; expose the cancellation result through `createEncryptedMedia`.
- Add protected `profileIntent: {operation: string; revision: number}` to avatar uploads; allocate the operation before prepare/upload and pass it unchanged to `circle-profile` relay publication.
- Preserve the existing operation fields for chat photos, Moments, stickers, and collection additions; map each snapshot object's upload operation to the exact snapshot part that references it, allocating part operations before refresh upload.
- Persist `uploadAttempted: boolean` in the protected job before the first PUT. Make `upload.cancel()` preserve the pending vault record on network/unknown errors, reconcile committed results without deleting, and clear it only after definitive `cancelled`; permit local-only release only when `uploadAttempted` is false.
- Update upload-vault persisted shape validation and round-trip tests without changing encryption descriptors/ciphertext.

- [x] **Step 1: Add failing client tests** that assert PUT includes the intent operation, cancel sends the same operation, uncertain responses retain protected state, cancelled responses clear it, and committed responses preserve/reconcile it.
- [x] **Step 2: Run** `cd apps/mobile && node --experimental-strip-types --test tests/media-api.test.mjs tests/media-upload.test.mjs tests/media-upload-vault.test.mjs`; confirm expected operation-binding failures.
- [x] **Step 3: Implement** typed API and protected cancellation coordinator with account/session guards.
- [x] **Step 4: Add failing publisher tests** for profile avatar operation reuse and snapshot per-part mapping across restart; run the affected avatar, collection refresh, snapshot, message image, moment, and sticker tests and observe failure.
- [x] **Step 5: Implement** operation persistence and exact relay reuse across each publication path; ensure new media cannot be prepared while a different pending operation exists.
- [x] **Step 6: Run** `cd apps/mobile && node --experimental-strip-types --test tests/*.test.mjs && npx tsc --noEmit && npm run lint`; require all checks pass.

### Task 5: Full race, migration, and local integration verification; update project status

**Files:**
- Modify: `docs/technical/encrypted-media.md`
- Modify: `docs/technical/project-status.md`
- Modify: `docs/superpowers/plans/2026-10-12-circle-completion.md`

**Interfaces:** Consume the final shared operation-lock, cancellation HTTP contract, cleanup worker, and mobile retry semantics from Tasks 1–4.

- [x] **Step 1: Run** the race and recovery tests added first in Tasks 1–3 against a task-owned isolated PostgreSQL schema and private temporary media root; verify both arbitration outcomes and queue recovery.
- [x] **Step 2: Run** `cd services/api && go test -race -count=1 ./... && go vet ./...` and all mobile tests/typecheck/lint; do not alter or restart the existing 8088 service/schema.
- [x] **Step 3: Run** migration checks and `git diff --check`; inspect `git status --short` and confirm prior staged/unstaged content remains present.
- [x] **Step 4: Update** encrypted media contract, project status, and Circle completion checklist with verified behavior, exact test results, and remaining Supabase/emulator/provider limitations; leave any unverified production-provider claims open.

## Coverage self-review

Tasks 1–3 implement the operation lock, permanent send/upload fence, media binding, safe delete, durable retry, storage/read privacy, and HTTP contract. Task 4 covers all publication paths, protected restart behavior, unknown-result handling, and fixed recipient/envelope invariants. Task 5 covers both arbitration orderings, migrations, actual PostgreSQL/filesystem behavior, full verification, and truthful status. Legacy rows are explicitly excluded by the spec and tested for non-mutation; old-generation tokens are rejected by existing session validation plus new owner-generation scoping.

## Completion checkpoint (2026-10-14)

All implementation and verification steps above are complete. Final regression verification also corrected the successful first-upload transition so its uploaded vault record retains `uploadAttempted=true`; the focused media-upload suite passes 14/14. Full mobile 481/481, TypeScript, Expo lint, Go PostgreSQL race tests, vet, and `git diff --check` pass. Supabase/private-provider deletion, Android/SecureStore and emulator acceptance remain unverified; the existing 8088 process was not migrated or restarted.
