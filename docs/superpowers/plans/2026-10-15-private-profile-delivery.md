# Private Profile Delivery Implementation Plan

> **For agentic workers:** Use the user's selected test-driven-development workflow. Each task is a failing-test-first vertical slice.

**Goal:** Deliver the owner's current display name and text status through end-to-end encrypted, accepted-friend-only profile events, and render the latest trusted profile without adding profile controls to Chat.

**Architecture:** Reuse the authenticated private message context and durable encrypted outbox. Add a strict `private-profile` control type that the relay permits only for one accepted friendship audience; clients project it separately from chat messages. The relay receives only the encrypted envelope.

**Tech Stack:** Go/PostgreSQL relay, Expo/React Native and TypeScript mobile client, existing Rust/Android durable encryption module.

**Spec:** `docs/technical/private-profiles.md`

## Global Constraints

- The server never receives profile fields or media keys in plaintext.
- Private profiles are scoped to one accepted friendship audience at send time.
- New profile updates never reach blocked, unaccepted, or ended friendships.
- Circle-member status delivery remains separate and Now Playing stays out of Circle bubbles.
- Avatar media and Now Playing provider integration remain separately gated follow-ups.

## Review Focus

- Cross-audience replay: reject old or foreign friendship audiences at the relay and native projection.
- Profile event rendered as chat text: filter it from both live and restored Chat views.
- Malformed profile: reject strict schema/Unicode/length violations before showing profile data.
- Lost send response: retry the same durable operation and never duplicate or retarget the event.
- Account replacement during fetch/send: suppress late writes into the replacement session.

### Task 1: Strict profile codec and history projection

**Files:** Create `apps/mobile/src/features/social/private-profile.ts`; create `apps/mobile/tests/private-profile.test.mjs`; modify `apps/mobile/src/features/messages/conversation-view.ts` and its tests.

**Interfaces:** `decodePrivateProfile(plaintext)` returns a validated version-1 `{name, status}` or `undefined`; `encodePrivateProfile({name,status})` validates and serializes; `selectPrivateProfile(history, conversation, audience)` returns empty/ready/invalid/conflict based only on accepted incoming profiles in the exact audience. Profile records never become Chat bubbles.

- [ ] Add failing tests for schema boundaries, audience isolation, latest accepted delivery selection, conflicting sequence values, and Chat filtering.
- [ ] Run the focused tests and observe the expected missing-module/behavior failures.
- [ ] Implement the codec and projection with 80-scalar name and 280-scalar status bounds, matching existing profile UI limits.
- [ ] Run focused tests and confirm pass.

### Task 2: Private profile relay authorization

**Files:** Modify `services/api/internal/messages/envelope.go`, `send.go`, relevant Go handler/service tests, and add an additive migration only if the current schema requires a persistent profile-specific constraint.

**Interfaces:** The envelope accepts `private-profile` without plaintext metadata; the Send transaction permits it only when its context is a currently accepted private friendship with exactly one original recipient. It rejects Circle, nonfriend, blocked, and stale-audience sends.

- [ ] Add PostgreSQL tests for accepted-friend success, Circle/nonfriend/blocked/stale-audience rejection, exact retry, and fixed recipient rows.
- [ ] Run the new tests and observe failure before changing production code.
- [ ] Implement the smallest relay authorization change without storing profile text separately.
- [ ] Run focused Go tests with race detection.

### Task 3: Durable mobile delivery and authenticated projection

**Files:** Update `apps/mobile/src/security/durable-encryption.ts`, Rust durable type validation/tests, `apps/mobile/src/features/messages/api.ts`, send/sync/runtime and `private-profile.ts` tests.

- [ ] Add failing native/client tests for event type propagation, exact retry, incoming acceptance, restored-history projection, and operation filtering.
- [ ] Run tests to observe failure.
- [ ] Implement end-to-end profile event transport using existing current friendship context and stable operation IDs.
- [ ] Run Rust, mobile behavior, TypeScript, and lint checks.

### Task 4: Native profile editing and friend surfaces

**Files:** Add account-bound profile state/editor; connect the native profile/settings route; connect accepted friends, New conversation, Chats, and private-chat header to authenticated latest profile data; update UI tests and backend handoff.

- [ ] Add rendered tests for loading/empty/error/retry, editing/saving, accepted-friend profile display, and hidden profile control events.
- [ ] Observe the failing UI tests before implementation.
- [ ] Implement the profile editor and list/header projections without changing the approved visual hierarchy.
- [ ] Run UI tests, all mobile behavior tests, TypeScript, Expo lint, Go race suite/vet, Rust tests, Android debug build, and whitespace checks. Record device/provider work still open.

