# Native conversation history pagination implementation plan

> **For agentic workers:** implement each task test-first with the repository's TDD workflow. Preserve the user's explicit choice not to use subagent-driven development.

**Goal:** Let Android load older encrypted conversation events from the relay for its current account generation.

**Architecture:** Add a read-only paged relay query over retained recipient delivery rows, reusing the existing session, friendship, Circle-interval, and redaction rules. Wire pages through the existing native `receiveDelivery` path and expose a compact chat-level load-older action backed by the same SQLCipher history store.

**Tech Stack:** Go 1.x, PostgreSQL via pgx, Expo/React Native TypeScript, existing Rust/Olm durable receive module, SQLCipher history.

**Spec:** [native history pagination](../specs/2026-10-16-native-history-pagination.md)

## Global Constraints

- Return ciphertext only; never decrypt or expose message content in Go.
- Scope every query and cursor to the authenticated account, active generation, conversation, and audience.
- Enforce the current accepted friendship for private messages and the exact current Circle membership interval for Circle messages.
- Exclude redacted records and synchronize the redaction feed around native page receipt.
- Keep the page size in the inclusive range 1–25.
- Preserve the existing one-active-phone and encrypted-backup recovery contract.
- Do not change the web demo path or Circle custom emoji scope.

## Review Focus

- A cursor from another user, generation, conversation, or audience must fail without disclosing history.
- A member who leaves and rejoins must not load records from the former interval.
- A redaction committed during pagination must not reappear in local history after reconnect.
- Duplicate page retrieval must be idempotent and must not change delivery acknowledgements.
- Empty pages containing only inaccessible events must still advance or terminate safely without a cursor loop.

---

### Task 1: Relay history page

**Files:**
- Create: `services/api/internal/messages/history.go`
- Modify: `services/api/internal/messages/http.go`
- Test: `services/api/internal/messages/history_test.go`

**Interfaces:**
- Consumes: `Delivery`, `InboxPage`, `deliveryAllowed`, `auth.Principal`, existing message redaction and Circle membership services.
- Produces: `(*Service).History(ctx context.Context, actor auth.Principal, conversation, audience, cursor string, limit int) (InboxPage, error)` and `GET /v1/messages/history`.

- [x] Write PostgreSQL regressions for newest-first paging (returned chronological order), stable older cursors, cursor scope, redaction omission, private authorization, Circle leave/rejoin boundaries, and unchanged delivery receipt state.
- [x] Run the focused Go tests and observe the expected failures before adding the service or route.
- [x] Implement the bounded query and route using parameterized SQL and existing authorization helpers.
- [x] Run the focused tests and `go test ./...`; database assertions skip without `AWSEM_TEST_DATABASE_URL`. Vet/whitespace checks are recorded with final verification.

### Task 2: Strict mobile history API and receive worker

**Files:**
- Modify: `apps/mobile/src/features/messages/api.ts`
- Modify: `apps/mobile/src/features/messages/inbox-sync.ts`
- Modify: `apps/mobile/src/features/auth/runtime.ts`
- Test: `apps/mobile/tests/message-api.test.mjs`
- Test: `apps/mobile/tests/inbox-sync.test.mjs`

**Interfaces:**
- Consumes: the relay history page and existing `receiveDelivery`, account binding, and redaction synchronization contracts.
- Produces: a strict `messages.history({ conversation, audience, cursor?, limit? })` client method and an account-bound worker to fetch one page, receive each event without issuing another acknowledgement, synchronize redactions, refresh local history, and return `{ cursor?, more }`.

- [x] Test URL/query validation, bounded page size, durable receive without a second acknowledgement, redaction synchronization, and retry safety before implementation.
- [x] Run focused mobile tests and observe expected failures.
- [x] Implement strict DTO parsing and the history-page worker using `receiveDelivery`.
- [x] Run focused tests, the full mobile behavior suite, TypeScript, and Expo lint.

### Task 3: Android chat load-older action

**Files:**
- Modify: `apps/mobile/src/features/messages/screen.tsx`
- Test: `apps/mobile/tests/private-chat-moments.ui.test.tsx`

**Interfaces:**
- Consumes: `runtime.historyPager(conversation, audience)`, current `ConversationContext`, and `runtime.history` subscriptions.
- Produces: initial page discovery and a reachable load-older action with loading, retry, and end-of-history states.

- [x] Add a UI regression proving page discovery, failed-page retry, and the end-of-history state before UI changes. Existing native receive/store tests cover message display after refresh.
- [x] Run focused UI tests and observe expected failures.
- [x] Wire the chat action using existing palette, spacing, snackbar, and 44px touch-target patterns.
- [x] Run focused UI tests and all native UI suites; TypeScript and remaining delivery checks are recorded at completion.

### Task 4: Record verified project status

**Files:**
- Modify: `docs/technical/project-status.md`
- Modify: `docs/technical/ui-backend-handoff.md`

- [x] Record the endpoint contract, Android control wiring, test results, and unverified PostgreSQL/device acceptance. No device acceptance is claimed.
