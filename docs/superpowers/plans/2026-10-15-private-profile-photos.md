# Private Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let Android users set a profile photo that is encrypted and delivered to accepted friends under each friendship's existing end-to-end encryption audience.

**Architecture:** Keep the source photo in the account's encrypted SQLCipher app data. Prepare a separate encrypted media object for each accepted friend, bind every upload and descriptor to that friendship and profile operation, and publish it only inside a private-profile event. Preserve v1 text profiles, use v2 for avatar descriptors and removals, and render only the newest valid profile from the exact accepted friendship audience.

**Tech Stack:** Expo React Native, Expo Image Picker/FileSystem, existing native archive crypto bridge, encrypted SQLCipher history store, private-media API, Jest and Node tests.

**Spec:** [private profile delivery](../../technical/private-profiles.md)

## Global Constraints

- Private profiles are sent only through an accepted friendship and remain control events, never Chat bubbles.
- Relay and media storage receive only ciphertext and routing metadata; avatar keys remain inside encrypted profile events.
- A profile photo is bounded to the existing encrypted-media limit of 2 MiB and an accepted MIME type.
- Each friend-specific upload is immutable and uses exact-operation recovery; no retries may widen the audience or replace bytes.
- Legacy version 1 profiles remain readable; version 2 carries a validated descriptor or explicit `null` removal.
- Profile name/status changes continue to fan out to accepted friends with the existing exact retry behavior.

## Review Focus

- A failed or uncertain upload retries the same ciphertext, operation, object ID, and friendship audience.
- A queued/failed profile publication cannot cause a new profile revision to overwrite its pending media.
- Missing local source bytes never turn an existing photo into an implicit removal.
- A descriptor from one friend or friendship request is never reused in another audience.
- Account replacement, logout, and corrupt local photo storage suppress late publication and plaintext display.

---

### Task 1: Version the private profile photo contract

**Files:**
- Modify: `apps/mobile/src/features/social/private-profile.ts`
- Test: `apps/mobile/tests/private-profile.test.mjs`
- Modify: `docs/technical/private-profiles.md`

**Interfaces:**
- `encodePrivateProfile({ revision, name, status })` keeps emitting v1.
- `encodePrivateProfile({ revision, name, status, avatar })` emits v2 with a descriptor or `null`.
- `decodePrivateProfile` accepts legacy v1 and strict v2; projection treats same-revision field differences as conflict.

- [x] Write failing tests for v2 descriptors, explicit removal, malformed nested fields, legacy parsing, and conflicting same-revision friend grants.
- [x] Run `node --experimental-strip-types --test tests/private-profile.test.mjs` and confirm the missing v2 behavior fails.
- [x] Implement strict v2 parsing using the existing encrypted-media descriptor validator.
- [x] Run the focused test and TypeScript check.

### Task 2: Persist the selected source photo safely

**Files:**
- Create: `apps/mobile/src/features/social/private-profile-photo-store.ts`
- Modify: `apps/mobile/src/features/auth/runtime.ts`
- Modify: `apps/mobile/src/features/social/private-profile-flow.ts`
- Test: `apps/mobile/tests/private-profile-photo-store.test.mjs`
- Test: `apps/mobile/tests/private-profile-flow.test.mjs`

**Interfaces:**
- Store accepts a JPEG/PNG/WebP/GIF no larger than 2 MiB and keeps it in account-bound encrypted SQLCipher data.
- Profile flow distinguishes an absent photo from an unavailable/corrupt saved photo.
- Profile flow exposes explicit photo replacement/removal; text-only edits preserve the current photo.

- [x] Write failing tests for size/type bounds, encryption-backed store ports, account binding, preservation on text-only edits, replacement, explicit removal, and unavailable-source fail-closed behavior.
- [x] Implement the local source store and inject it through the authenticated runtime.
- [x] Run focused storage/profile tests and TypeScript.

### Task 3: Publish one exact encrypted photo per friend

**Files:**
- Create: `apps/mobile/src/features/social/private-profile-photo-publisher.ts`
- Create: `apps/mobile/src/features/social/private-profile-photo-publication-storage.ts`
- Modify: `apps/mobile/src/features/social/private-profile-photo-storage.native.ts`
- Modify: `apps/mobile/src/features/social/private-profile-flow.ts`
- Modify: `apps/mobile/src/features/auth/runtime.ts`
- Test: `apps/mobile/tests/private-profile-photo-publisher.test.mjs`
- Test: `apps/mobile/tests/private-profile-flow.test.mjs`

**Interfaces:**
- Profile media upload takes `{ targetId, audience, revision, operation, bytes, mimeType }` and returns a validated `MediaDescriptor`.
- The media job remains durable until the exact private-profile event is confirmed; uncertain response retries the saved bytes and operation.
- Profile fanout creates distinct operations and descriptors for each accepted friend and publishes `avatar: null` only for explicit removal.

- [x] Write failing tests for friend-bound context, per-friend descriptors, lost upload/send response recovery, stable exact retries, fixed audience, deletion/removal, and pending-revision conflicts.
- [x] Implement profile-specific upload intent persistence and connect the fanout callback.
- [x] Run focused message/profile tests and TypeScript.

### Task 4: Add Android profile-photo editing and display

**Files:**
- Modify: `apps/mobile/src/features/social/private-profile-screen.tsx`
- Modify: `apps/mobile/src/features/messages/native-new-conversation.tsx`
- Modify: `apps/mobile/src/features/messages/screen.tsx`
- Modify: `apps/mobile/src/features/messages/conversation-details-screen.tsx`
- Modify: `apps/mobile/src/features/social/friends-screen.tsx`
- Modify: `apps/mobile/src/features/messages/native-chat-list.tsx`
- Test: `apps/mobile/tests/private-profile-screen.ui.test.tsx`
- Test: `apps/mobile/tests/native-new-conversation.ui.test.tsx`
- Test: `apps/mobile/tests/conversation-details-screen.ui.test.tsx`
- Test: `apps/mobile/tests/friends-safety.ui.test.tsx`
- Test: `apps/mobile/tests/native-chat-list.ui.test.tsx`

**Interfaces:**
- Android profile editor offers choose/change/remove controls with a square crop and real save feedback.
- Accepted-friend rows, private chat header, conversation details and profile home render the latest profile avatar with the existing rounded-square treatment.
- Loading, empty, unavailable, and failed media states retain a neutral avatar and actionable retry where possible.

- [x] Write failing UI tests for selecting, replacing, removing, and showing the latest friend-scoped photo.
- [x] Implement the picker/editor and image renderer using the existing photo viewer/media code patterns.
- [x] Run focused UI tests, full behavior/UI suites, TypeScript, lint, Android export/build, and whitespace checks.

### Task 5: Record current implementation evidence

**Files:**
- Modify: `docs/technical/private-profiles.md`
- Modify: `docs/technical/project-status.md`

- [x] Run all required local checks after the final code change.
- [x] Record which media/native/provider checks were not performed and keep the overall Android conversion status open until those gates pass.
