# Private chat Moments Implementation Plan

> **For agentic workers:** Implement inline with Superpowers test-driven development. Do not use subagents. Every production change requires a failing-first test.

**Goal:** Add a complete two-person encrypted Moments timeline to accepted private conversations, including encrypted private Chat photo messages, text and photo Moments, reactions, replies, author deletion, text/photo promotion, and safe exact retry.

**Architecture:** Private Moment events reuse the normal account-bound message sender and immutable `friend:<request-id>` audience. A separate private-media route/database authorization path grants opaque ciphertext only to the two current participants in that accepted friendship; Circle media routes stay unchanged. Client codecs/projections/controllers own Moment semantics while the existing photo editor and history UI provide the user flow.

**Tech Stack:** Go API, PostgreSQL migrations, Expo React Native/TypeScript, existing SQLCipher and native end-to-end message encryption, local private ciphertext filesystem.

**Spec:** `docs/technical/private-moments.md`

## Global Constraints

- Keep all Moment bodies, captions, media descriptors and media keys inside end-to-end encrypted messages.
- Bind private events and media to the active `friend:<request-id>` audience and original immutable recipient set.
- Do not mix private Moments with Circle conversation IDs, epochs, recipients, or collection state.
- Keep photo plaintext local and within the existing 2 MiB media bound.
- Cancellation deletes media only after the API confirms no message event committed; cleanup must survive restart.
- Preserve Circle Moment behavior and legacy encrypted history formats.
- Keep Supabase and emulator interaction outside this implementation; neither is configured/authorized for verification.

## Review Focus

- A friendship ends after upload but before Moment send; cancellation/read authorization must not expose the ciphertext to a later friendship audience.
- A send commits while the client loses the response; retry/cancel must return that committed event and preserve media.
- An incoming private control body is copied into another conversation/audience; its projection must remain isolated.
- Same Moment ID or operation has conflicting authors/content; selector must fail closed rather than choose one.
- A photo upload succeeds but message send is uncertain and the process restarts; retry must reuse identical protected bytes, operation, and caption.

## File Map

- `services/api/internal/media` and a new migration implement private ciphertext ownership, audience grants, operation cancellation, and durable cleanup.
- `apps/mobile/src/features/media` adds typed private media transport bound to the accepted friendship conversation/audience.
- `apps/mobile/src/features/messages/private-moments*.ts` contains strict bodies, history selectors, publisher/editor, reaction aggregation and deletion projection.
- `apps/mobile/src/features/messages/conversation-view.ts` filters private controls and renders typed Moment replies.
- `apps/mobile/src/features/auth/runtime.ts` creates account-bound private Moment/media controllers.
- `apps/mobile/src/features/messages/screen.tsx` adds private-only Chat/Moments tabs and the complete timeline/composer flow.
- `apps/mobile/tests`, `services/api/internal/media/*_test.go`, and technical docs capture behavior and evidence.

## Tasks

### Task 1: Private media API and storage authorization

**Files:** new PostgreSQL migration; modify `services/api/internal/media/{service,http}.go`; modify media cleanup worker; add media service/HTTP/PostgreSQL tests.

- [x] Write failing PostgreSQL tests for accepted-friend upload/download grants, current-audience enforcement, denied nonfriend/blocked/other-audience access, changed-operation ciphertext conflicts, cancellation fencing, send/cancel lock arbitration, and cleanup retry across worker restart.
- [x] Run the new tests against a task-owned PostgreSQL schema and observe the authorization route fail before implementation.
- [x] Add `private_media_objects` and durable cleanup records with ownership foreign keys and bounded ciphertext metadata.
- [x] Add `PutPrivate` and `GetPrivate` operations that lock authenticated session and operation; require the same currently accepted request/audience; bind opaque bytes to exact owner generation/operation/conversation; authorize only sender and peer.
- [x] Add private operation cancellation under the shared operation lock. A committed event is returned only for the same conversation/audience; otherwise persist the cancellation fence and queue only that operation's private media.
- [x] Extend the bounded cleanup worker to lease/delete private objects idempotently without weakening Circle cleanup.
- [x] Run focused media tests, full PostgreSQL Go race suite and `go vet ./...`.

### Task 2: Private media client and protected upload lifecycle

**Files:** add private-media API/storage adapters and controller under `apps/mobile/src/features/media`; reuse account-bound upload vault only through an explicit private-purpose namespace; add tests.

- [x] Write failing API/controller tests for exact recipient audience binding, local encryption before PUT, descriptor validation, saved exact retry after uncertain send, cancellation-only discard, committed-event preservation, and revocation rejection.
- [x] Observe RED, then implement typed private media GET/PUT/cancel endpoints and bounded request/error handling.
- [x] Persist private photo intent with peer, private conversation, friendship audience, operation, caption, ciphertext and descriptor in a device-protected vault; verify session binding after awaits.
- [x] Make retries upload/send the same media object and immutable message operation; clear local state only after committed-send confirmation or server-confirmed cancellation. The private Chat photo controller uses a purpose-separated vault from private Moment photo drafts.
- [x] Run focused tests, TypeScript, lint and whitespace checks.

### Task 3: Strict private Moment codecs and projections

**Files:** add `private-moments.ts`, `private-moment-reactions.ts`, `private-moment-deletion.ts`, `private-moment-reply.ts`; modify `conversation-view.ts`; add mobile tests.

- [x] Write strict-schema cases for post/reaction/reply/delete encoders, Unicode and byte bounds, unknown fields, ID/operation equality, malformed media, and cross-conversation/audience isolation.
- [x] Write selector tests for incoming/outgoing deduplication, stable ordering, conflicting same-operation payloads, reactions, and author-only same-audience deletion.
- [x] Implement the codecs/projections with `friend:<request-id>` audience validation and optional validated private media descriptor.
- [x] Filter private Moment control bodies out of Chat rows and project typed private Moment replies with previews.
- [x] Run focused tests, full mobile suite, TypeScript, lint and whitespace checks.

### Task 4: Account-bound publisher, reply and promotion

**Files:** add `private-moment-publisher.ts` and runtime factory; modify authenticated runtime and message screen controllers; add tests.

- [x] Write tests for accepted-peer context, text/photo post, exact queued retry, stale friendship audience rejection, Moment interactions, author-only deletion, text promotion and private photo promotion. Private Chat photos use the same fixed friendship audience and encrypted private-media route; photo-source promotion retains the original descriptor.
- [x] Observe RED, then implement serialized session-bound publishing through the existing sender with fixed peer and immutable `friend:<request-id>` audience.
- [x] Require source Moments in accepted local history and exact current private conversation/audience before interactions; require the sender's own committed private Chat text or valid photo message before promotion.
- [x] Preserve operation and exact plaintext on retry; never rebase uncertain operations to a new audience. Private Chat photo messages persist encrypted bytes and retry state in a separate purpose-bound vault.
- [x] Run focused tests, full mobile suite, TypeScript, lint and whitespace checks.

### Task 5: Private Chat/Moments production UI

**Files:** modify `apps/mobile/src/features/messages/screen.tsx`; add any focused Moment card/photo presentation component; add controller/UI projection tests.

- [x] Add automated rendering/interaction tests for private Chat/Moments tabs, text/photo posting, pre-send photo preview, exact saved-photo retry/discard controls, reactions, author deletion, embedded reply navigation and control exclusion from Chat bubbles (`apps/mobile/tests/private-chat-moments.ui.test.tsx`, six passing tests).
- [x] Add accessible loading, empty, failed-read, stale-audience and send-error states with the shared snackbar; retain private photo retry state on failure.
- [x] Reuse the approved spacing, existing photo editor/full-screen viewer and existing controls.
- [ ] Verify narrow-device layout, theme colors, tap targets and screen-reader behavior on device. Emulator interaction was explicitly skipped by the user.
- [x] Run the 499-test mobile suite, six Expo Jest UI tests, TypeScript, Expo lint, PostgreSQL Go race tests, `go vet ./...`, and whitespace checks. The mobile API suite requires permission to bind local loopback servers in this sandbox.
- [x] Update the technical contract and project status with behavior and verification limits.

