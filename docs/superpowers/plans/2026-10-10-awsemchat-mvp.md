# AwsemChat MVP Implementation Plan

> **Current execution:** The owner selected inline `superpowers:test-driven-development` and explicitly disabled subagent-driven development. Implement task-by-task with observed failing tests, minimal implementation and full relevant suite verification.

**Goal:** Deliver the agreed Android MVP without weakening its encrypted private audiences or history-recovery guarantees.

**Architecture:** Expo clients own plaintext, encryption keys, local history, and backup encryption. A Go service owns authorization and relays encrypted events, with PostgreSQL on the user's VPS and ciphertext media in Supabase Storage. Validate the security integration first, then deliver dependent vertical slices.

**Tech Stack:** Expo, React Native, TypeScript, Go, SQLite, PostgreSQL, Supabase Storage; cryptographic library and provider dependencies selected through Task 1 evidence.

**Spec:** `docs/superpowers/specs/2026-10-10-awsemchat-mvp-design.md` (user approved 2026-10-10). Presentation and Android music direction are superseded by `docs/technical/ui-backend-handoff.md`; privacy rules remain binding. Task1 status: partial; native crypto/storage/backup probes have passed, while authenticated key distribution and complete application security/provider gates remain unfinished. See `docs/technical/project-status.md` for the current task-by-task status. Composite checklist items stay unchecked until every required clause is verified.

## Global Constraints

- Android first; preserve future iOS support.
- One active phone per account.
- Circles capped at 20 participants including the creator.
- Accepted friendship before private messages or PINGs.
- No read receipts, typing, online, or last-seen indicators.
- New Circle members cannot see prejoin messages or Moments.
- Only the original sender promotes content to Moments; preserve its original audience.
- PING/PONG only in private chats.
- Circle messages show latest profile status; no Now Playing in Circle bubbles.
- All three delivery stages in the spec remain in the MVP.
- Preserve the approved UI in `docs/technical/ui-backend-handoff.md`; no redesign. Anti Slop applies during implementation per the owner's session choice; privacy constraints remain binding.
- No external deployment, credential creation, provider purchase, or app-store submission is included in plan execution without scoped authorization.

## Review Focus

- Simultaneous Circle joins must never exceed 20; assert against a real PostgreSQL transaction in Task 3.
- Replacement phones and old backups must not revive revoked sessions or memberships; assert in Tasks 2 and 6.
- Promoted older Moments must not leak through quoted replies or push previews; assert in Task 7.
- Offline retries must not duplicate events or invent delivery receipts; assert in Task 4.
- Corrupt backup imports must not destroy usable history; assert in Task 6.

## Execution structure and file ownership

The approved UI demo is committed in Git (baseline `89fac6d`). The owner directed work back to `/Users/erik/Developer/projects/awsemchat` on2026-10-12. Production commits were fast-forwarded into `codex/awsemchat-mvp`; this original checkout is now canonical. Commit narrowly scoped changes; never introduce credentials or redesign the approved UI. Use `apps/mobile` for the Expo application and `services/api` for Go. Keep product features together inside each platform, with domain/use-case, persistence, and transport boundaries within each backend feature. `docs/technical` owns reviewed provider and security decisions.

This document sequences the whole MVP. Task 1 produces the concrete security/provider contracts required to expand later slices into executable steps. Later task interfaces below are proposed application interfaces, not claims that a particular library supports them. Do not invent library calls or silently substitute fake encryption. Expand each dependent slice into a short subsystem plan using the validated contracts before implementing it.

## Task 1: Validate security and provider feasibility

**Files:** `docs/technical/e2e-design.md`, `docs/technical/provider-feasibility.md`, `validation/e2e/`, `validation/backup/`, `validation/media/`.

**Interfaces:** Produces a reviewed protocol choice, native integration/build instructions, ciphertext event schema, audience/key lifecycle, replacement-device flow, encrypted backup format, and provider constraints. All subsequent tasks consume these decisions.

- [x] Consult official current protocol, Expo57, SQLite encryption, Supabase, Drive, and Spotify documentation; record dated source links and distinguish verified capability from inference. See provider-feasibility and E2E design (2026-10-10).
- [x] Compare established protocol implementations for native Android/Expo compatibility, license, private chats, Circle epochs, and audience-restricted Moments. Explicitly identify server-visible metadata. Candidate remains conditional on native/security review.
- [ ] Run a minimal Android integration probe: Alice/Bob exchange authenticated ciphertext; outsider cannot decrypt; adding Carol does not unlock earlier content; removing Bob prevents future decryptions; tampered ciphertext is rejected. Record commands and actual output.
- [ ] Validate SQLite encryption and backup export/import on a device. Assert wrong secret fails, valid import restores test history, and interrupted import leaves prior history usable.
- [ ] Validate Spotify public-release access and foreground/background update constraints, Drive scopes and scheduling limits, and on-device background removal. Do not equate developer-mode access with public availability.
- [ ] Resolve spec section 16 product edge cases with concrete proposals: PIN lifecycle, reassigned numbers, admin succession, rejoin, deletion, nonfriend status audiences, removed-recipient receipts, and recovery UX. Obtain user decisions where intent is nonderivable.
- [ ] Gate: only proceed to dependent production slices when their integration contracts are verified. Report provider or protocol conflicts to the user with a concrete alternative; preserve MVP scope until the user changes it.

## Task 2: Identity and mobile foundation

Progress (2026-10-11): Go authentication core, explicit migration command, local API command, startup/readiness checks and graceful shutdown pass real PostgreSQL17 integration and race tests. Owner chose mock SMS first; the mock requires explicit development mode and loopback binding. Contact PIN is fixed. Native login/session integration, secure persistence and account-bound encryption/controller probes now pass, with rendered Android login screens. Application-wide integration, foreground replacement revalidation, lifecycle retirement and complete device acceptance remain unfinished; this task is not complete. See `docs/technical/identity-service.md` and `services/api/README.md`.

**Files:** `apps/mobile/app.config.ts`, `apps/mobile/src/app/`, `apps/mobile/src/features/auth/`, `apps/mobile/src/storage/`, `services/api/cmd/api/main.go`, `services/api/internal/auth/`, `services/api/migrations/001_identity.sql`.

**Interfaces:** `VerifyPhone(ctx context.Context, challengeID, code, deviceID string) (Session, error)`; `RequireSession(ctx context.Context, token string) (AccountDevice, error)`; client `LocalHistoryStore` and `EncryptionAdapter` defined from Task 1.

- [ ] Expand this slice's plan with exact selected SDK, dependency versions, OTP adapter, session/key interfaces, migrations, and commands. Scaffold Expo through the official generator, use `expo install`, and create a Go module. Never assume Expo Go supports selected native modules.
- [ ] Write failing tests: expired/replayed OTP rejected, rate limit enforced, second-phone verification revokes first session, phone number absent from public profile response, revoked token rejected by all transports.
- [ ] Run focused tests to establish the failures, implement identity and secure local storage, then rerun until passing.
- [ ] Build Android and verify OTP screens, safe errors, secure session persistence, and replacement-device behavior. Commit this working slice.

## Task 3: PIN friendships and Circle membership

**Files:** `services/api/internal/friends/`, `services/api/internal/circles/`, `services/api/migrations/002_social.sql`, `apps/mobile/src/features/friends/`, `apps/mobile/src/features/circles/`.

**Interfaces:** `RequestFriend(ctx context.Context, actorID, pin string) (Request, error)`; `AcceptFriend(ctx context.Context, actorID, requestID string) error`; `AcceptCircleInvite(ctx context.Context, actorID, inviteID string) (MembershipEpoch, error)`.

- [ ] Expand the slice plan with validated key-epoch contracts and resolved membership rules.
- [ ] Write failing tests asserting unaccepted friendships cannot message, only admins invite accepted friends, invite acceptance is required, member count includes creator, and concurrent joins cap at 20 in PostgreSQL.
- [ ] Implement the rules, blocked-user checks, and transactional capacity enforcement; verify key distribution excludes prejoin history and removed members.
- [ ] Run Go unit/integration tests and device flows for PIN requests, invitation rejection, full Circle, leave/rejoin, and admin succession. Commit.

## Task 4: Reliable encrypted messaging

**Files:** `services/api/internal/messages/`, `services/api/internal/realtime/`, `services/api/migrations/003_events.sql`, `apps/mobile/src/features/chat/`, `apps/mobile/src/storage/outbox.ts`.

**Interfaces:** `SendEnvelope(ctx context.Context, actorID string, envelope Envelope) (EventID, error)`; `AcknowledgeDelivery(ctx context.Context, recipientID string, eventID EventID) error`; client `queueMessage(input: MessageInput): Promise<MessageID>`.

- [ ] Expand the slice plan with exact ciphertext schema, transport, immutable recipient set, idempotency key, receipt state machine, and retained offline-event policy.
- [ ] Write failing assertions: identical idempotency key yields one event; reconnect replay yields one local message; server acceptance is sent, not delivered; Circle delivery needs all intended recipients; reads emit no receipt; plaintext and keys absent from server logs/storage.
- [ ] Implement encrypted text/replies and local outbox using the validated adapter, with safe retry and offline recovery.
- [ ] Verify two-device messaging, interrupted connections, recipient removal behavior, tampered events, and sender state UI. Commit.

## Task 5: Encrypted photos and media storage

**Files:** `services/api/internal/media/`, `apps/mobile/src/features/media/`, `services/api/migrations/004_media.sql`.

**Interfaces:** `AuthorizeUpload(ctx context.Context, actorID string, input UploadInput) (UploadGrant, error)`; `AuthorizeDownload(ctx context.Context, actorID, mediaID string) (DownloadGrant, error)`; client `encryptMedia(source: LocalFile, audience: Audience): Promise<EncryptedMedia>`.

- [ ] Expand the slice plan with Supabase private-bucket authorization, selected file limits, ciphertext thumbnails, failure cleanup, and expiration rules.
- [ ] Write failing assertions: unauthorized download denied; storage contains ciphertext only; modified media rejected; failed upload leaves message retryable; privileged credentials absent from bundle.
- [ ] Implement photo encryption/upload/download, local media handling, and photo message rendering.
- [ ] Verify file-size rejection, network interruption, expired grants, and outsider access on device and integration tests. Commit.

## Task 6: Drive and local encrypted backup/restore

**Files:** `apps/mobile/src/features/backup/`, `apps/mobile/src/storage/restore.ts`, `apps/mobile/src/features/settings/backup-screen.tsx`.

**Interfaces:** `createBackup(destination: BackupDestination, secret: RecoverySecret): Promise<BackupResult>`; `restoreBackup(source: BackupSource, secret: RecoverySecret): Promise<RestoreResult>`.

- [ ] Expand the slice plan with Task 1 format, account binding, recovery UX, media completeness, schema migration, scheduling, and transactional restore.
- [ ] Write failing assertions: Drive/local produce compatible files; wrong secret and tampering fail; interrupted restore preserves existing store; revoked membership/session stays revoked; restored history and media match fixture; no plaintext secrets in backup metadata.
- [ ] Implement exports/imports and Drive integration; show last success, progress, retry, and schedule limitations accurately.
- [ ] Verify real-device replacement-phone restoration from both destinations and recovery-loss messaging. Commit.

## Task 7: Moments and restricted replies

**Files:** `services/api/internal/moments/`, `services/api/migrations/005_moments.sql`, `apps/mobile/src/features/moments/`, `apps/mobile/src/features/chat/moment-reply.tsx`.

**Interfaces:** `CreateMoment(ctx context.Context, actorID string, input MomentInput) (MomentID, error)`; `PromoteMessage(ctx context.Context, actorID string, messageID MessageID) (MomentID, error)`; `ReplyToMoment(ctx context.Context, actorID string, momentID MomentID, envelope Envelope) (EventID, error)`.

- [ ] Expand the slice plan with source ownership, original audience intersection, deletion semantics, and encrypted reaction events.
- [ ] Write failing assertions: other sender cannot promote; postjoin promotion does not expand audience; unauthorized member gets neither preview nor reply nor media key; deleted Moment link follows reviewed deletion rule.
- [ ] Implement direct Moments, own-message promotion, chronological album, attached reactions, and replies in Chat with deep navigation.
- [ ] Verify three-device restricted-audience scenario, offline deletion/reconnect, and backup round-trip of Moments. Commit.

## Task 8: Stickers, Circle emoji, and GIFs

**Files:** `apps/mobile/src/features/stickers/`, `apps/mobile/src/features/emoji/`, `apps/mobile/src/features/gifs/`, `services/api/internal/collections/`, `services/api/migrations/006_collections.sql`.

**Interfaces:** `createSticker(input: StickerEdit): Promise<StickerID>`; `saveReceivedSticker(messageID: MessageID): Promise<StickerID>`; `AddCircleAsset(ctx context.Context, actorID, circleID string, asset AssetEnvelope) error`; `RemoveCircleAsset(ctx context.Context, actorID, circleID, assetID string) error`.

- [ ] Expand the slice plan with selected on-device image APIs, formats/limits, copied personal assets, encrypted collection distribution, and GIF provider contracts.
- [ ] Write failing assertions: crop/background removal/text persist in sticker; no direct finished-sticker upload or drawing controls; members contribute, nonmembers denied, only admins remove shared assets; saved personal copy survives picker removal; GIF search sends no conversation data.
- [ ] Implement editor and Group stickers/Personal stickers tabs, save action, custom emoji picker/reactions, and GIF selection.
- [ ] Verify devices with denied photo permissions, large images, cancelled edits, removed collection assets, and backup/restore. Commit.

## Task 9: PING/PONG, profiles, and safety controls

**Files:** `services/api/internal/profiles/`, `services/api/internal/safety/`, `apps/mobile/src/features/profile/`, `apps/mobile/src/features/ping/`, `apps/mobile/src/features/safety/`, `services/api/internal/notifications/`.

**Interfaces:** `SendPing(ctx context.Context, actorID, conversationID string) (EventID, error)`; `UpdateStatus(ctx context.Context, actorID, status string) error`; `SubmitReport(ctx context.Context, actorID string, selected ReportContent) (ReportID, error)`.

- [ ] Expand the slice plan with reviewed cooldown, notification adapter, profile audience, report retention, and blocked/shared-Circle behavior.
- [ ] Write failing assertions: PING in Circle rejected; pending friendship rejected; cooldown enforced; PONG never automatic; muted alert quiet; latest status renders on older Circle messages; report transmits only explicitly selected content.
- [ ] Implement settings, alerts, profile distribution, block/unfriend/report, and restricted notification previews.
- [ ] Verify silent/DND behavior on Android, permission denial, blocked contacts, and selected-content report disclosure. Commit.

## Task 10: Android music-app Now Playing

The UI handoff records the owner's choice to explore Android music sessions; this supersedes Spotify Web API as the required production provider. Spotify public-release eligibility remains documented, not assumed. Preserve future iOS interface without claiming equivalent provider support.

**Files:** `apps/mobile/src/features/music/`, local Android music-session Expo module/config plugin, encrypted profile update adapter.

**Interfaces:** proposed `requestMusicAccess()`, `setMusicSharing(enabled)`, `getNowPlaying()` and short-lived encrypted accepted-friend updates. Permission grant is separate from sharing consent; these are application interfaces, not SDK calls.

- [ ] Expand after Task1 security gate and native MediaSessionManager/NotificationListenerService feasibility. Validate permission scope, selected players, missing metadata, stop/expiry and device background limits.
- [ ] Assert sharing opt-in required; pause/revocation/sign-out clears; stale track expires offline; unaccepted friend gets no playback; Circle bubble never renders playback. Never consume general notification bodies.
- [ ] Implement approved native integration, foreground/background updates within validated limits, encrypted friend-profile rendering and disconnect cleanup.
- [ ] Verify on real Android device with multiple players, force-stop/Doze/revocation; keep broad permission explanation accurate. No provider credentials/publishing without scoped authorization.

## Task 11: UI integration and Android release validation

**Files:** `apps/mobile/src/theme/`, main routes in `apps/mobile/src/app/`, `docs/technical/android-acceptance.md`, `docs/technical/release-readiness.md`.

**Interfaces:** Unified Chats/Friends/You navigation, All/Private/Circles filters, Chat/Moments conversation navigation, accessible themed controls.

- [ ] Integrate production data into the approved UI handoff and verify Expo/native behavior; preserve visual layout and approved interactions. No UI redesign in production integration.
- [ ] Verify real functional screens against all 12 spec acceptance scenarios, not fabricated activity. Check empty/loading/error, text scaling, TalkBack, both themes, permissions, offline behavior, and every control.
- [ ] Run Go tests/integration tests, mobile tests/type checks, and actual Android build; record versions, commands, outputs, and device walkthrough evidence. Address failures before completion claims.
- [ ] Complete protocol/security review, credential configuration checklist, and product launch policy requirements. List remaining external access or user decisions accurately.
- [ ] Validate approved UI interactions against real production state, commit verified work and hand over runnable Android MVP. Apply Anti Slop during implementation as selected by the owner. Publishing requires its own scoped authorization.

## Self-review and handoff

Spec coverage: Tasks 2-3 cover identity/membership; 4-5 messaging/media; 6 recovery; 7 Moments; 8 expression; 9 status/PING/safety; 10 music; 11 navigation/UI and device acceptance. Task 1 owns technical unknowns and resolves interfaces before dependent production work.

This is the roadmap and first validation task, not fabricated certainty about unselected SDKs, libraries, or providers. Concrete subsystem plans follow demonstrated integration contracts. Continue inline test-driven development as directed by the owner; subagent-driven development is disabled.
