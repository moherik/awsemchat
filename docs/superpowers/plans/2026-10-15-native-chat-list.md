# Native production chat list implementation plan

> Inline implementation using test-driven development. Preserve the shared staged and unstaged work; do not stage or commit.

**Goal:** Replace seeded conversations in the native Chats tab with accepted friends, active Circles, real encrypted-history previews, and durable local chat preferences.

**Architecture:** Build a pure projection from accepted friend/Circle summaries and the authenticated history store. Persist pin, mute and archive choices in a separate account/device-scoped SQLCipher app-data store. Keep the existing browser demo unchanged and expose archived conversations only from Settings.

**Tech Stack:** Expo SDK57, React Native 0.86, Expo Router, existing authenticated runtime/controllers, SQLCipher `openEncryptedHistory`, Node behavior tests and Expo Jest UI tests.

## Global constraints

- Use `FlatList` for the unbounded searchable data, with `@expo/ui` consulted first; its grouped `List` is not virtualized.
- Preserve the approved BBM-inspired palette, spacing, rounded-square avatars, long-press row menu, and All/Private/Circles pills.
- Private rows use the accepted friend PIN until an authenticated private profile exists; Circle rows use the latest accepted encrypted Circle profile.
- Preview only ordinary Chat content from the current accepted private friendship audience or Circle conversation; do not show Moment control events or fabricate unread/read state.
- Pin, mute and archive are local account/device preferences; no preference endpoint or cross-device sync is specified.
- Archive hides a conversation from Chats and exposes it in Settings, where it can be opened or unarchived.
- Preserve the web demo and its seeded content.
- Do not stage or commit because the shared checkout contains unrelated staged work.

## Review focus

- A friend who was re-added has a different accepted request ID; old friendship messages must not leak into the current private row.
- Stale account loads and preference writes must not affect another signed-in account.
- Archiving and unarchiving must be idempotent and preserve pin/mute state.
- Malformed preference data must fail closed to safe defaults without blocking the real chat list.
- Missing encrypted Circle profile should show a clear generic Circle label, not a fake name or raw internal identifier.

### Task 1: Conversation list projection

**Files:** Create `apps/mobile/src/features/messages/conversation-list.ts`; create `apps/mobile/tests/conversation-list.test.mjs`.

**Interface:** `projectConversations({ friends, circles, history, preferences, query, filter }): ConversationRow[]`. Rows carry kind, route identity, honest title/subtitle, latest ordinary message preview/time, and local preference flags.

- [x] Write tests for current friendship-audience filtering, Circle latest profile naming, Circle message previews, chronological ordering, search, filter pills, pinned-first ordering, archived exclusion, membership-epoch filtering, and omitting Moment/control events.
- [x] Run the focused test and observe the expected missing-module failure.
- [x] Implement the pure projection using existing `conversationMessages` and `selectCircleProfile` selectors, with an archive-only projection mode for Settings.
- [x] Run the focused test and require all projection cases to pass.

### Task 2: Durable local preference controller

**Files:** Create `apps/mobile/src/features/messages/conversation-preferences.ts`; create native storage adapter; modify authentication runtime; create `apps/mobile/tests/conversation-preferences.test.mjs`.

**Interface:** An observable controller loads validated `{ pinned, muted, archived }` values, toggles one field, scopes storage to account/device/generation, and rejects stale writes after identity replacement. The native adapter stores the record in a separate encrypted SQLite app-data namespace.

- [x] Add failing tests for loading defaults, toggle persistence, preserving sibling flags, stale binding rejection, malformed stored data defaults, and account isolation.
- [x] Observe the expected missing-controller/storage behavior.
- [x] Implement the controller and account-scoped native SQLCipher adapter using existing storage APIs; include preference snapshots in encrypted local/Drive archive create/restore.
- [x] Run controller, encrypted preference archive and TypeScript checks; require them to pass.

### Task 3: Native Chats tab and archived chats

**Files:** Create `apps/mobile/src/features/messages/native-chat-list.tsx`; create `apps/mobile/tests/native-chat-list.ui.test.tsx`; modify `apps/mobile/src/features/chat-app.tsx` and `apps/mobile/src/features/flows.tsx`.

- [x] Add rendered tests for real friend and Circle rows, search/filter, refresh, long-press pin/mute/archive, and the Settings-only archived list with unarchive behavior.
- [x] Observe failing UI tests before implementation.
- [x] Connect runtime friends, Circle summaries, encrypted history, preference controller and existing chat routes. Use the shared palette and spacing and keep web on the demo path.
- [x] Run focused UI tests and require all tested interactions and accessible labels to pass.

### Task 4: Regression, evidence, and status

- [x] Run complete mobile behavior/UI tests, TypeScript, Expo lint, and `git diff --check HEAD`. Verification: 549 behavior tests, 13 UI tests, TypeScript, lint and diff check pass. Local-only Jest fetch setup removes a late Expo test warning.
- [x] Update current project status and the relevant UI/backend handoff with what is now live and what still lacks native/device acceptance.
- [x] Review the relevant changes and leave all work unstaged/uncommitted; preserve the shared checkout's existing staged work.
