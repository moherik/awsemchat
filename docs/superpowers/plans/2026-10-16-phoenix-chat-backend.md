# AwsemChat chat backend plan (Phoenix + vodozemac)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Date:** 2026-10-16
**Status:** Planning approved direction. No production code exists yet; `apps/backend/` is empty and the mobile app is an approved demo UI only.

**Goal:** Build the production chat backend that lets the approved demo UI grow into a real product: phone-verified accounts, PIN friendships, Circles with enforced history boundaries, reliable encrypted messaging with delivery receipts, encrypted media, and push notifications, without the server ever holding content keys.

**Spec:** `docs/superpowers/specs/2026-10-10-awsemchat-mvp-design.md` (approved 2026-10-10). This plan amends its section 13 architecture table (Go -> Elixir/Phoenix; protocol neutral -> vodozemac). Product scope is unchanged.

**Supersedes the backend portion of** `2026-10-10-awsemchat-mvp.md` (that plan's Go `services/api` tasks and its Task 1 protocol comparison are replaced by the decisions recorded below). Mobile-side tasks of that plan (Expo app work, local storage, backup UI) still apply.

## Decisions recorded 2026-10-16 (user decisions)

1. **Backend: Elixir + Phoenix, single service.** Rejected alternatives with reasons: Go (spec's original choice; user switched to Elixir for one-language client/server ecosystem and BEAM realtime concurrency); ejabberd as chat server (user considered, then dropped: XMPP client reliability on React Native is the dominant risk, all domain logic must live in Phoenix anyway, and Phoenix Channels covers offline queue, receipts, and group fan-out directly).
2. **E2E protocol: vodozemac (Olm/Megolm).** Rejected alternatives with reasons: libsignal (AGPL license, officially unsupported outside Signal, no Hermes-compatible binding); MLS/OpenMLS (best epoch semantics but young mobile bindings, parked as future option); cryptobox and libsession (smaller communities, no advantage over vodozemac for this scope). vodozemac won on MPL-2.0 license, a passing host probe already recorded in `docs/technical/provider-feasibility.md`, Megolm per-sender session rotation matching Circle membership epochs, and a built-in key export/import format serving spec section 11 backups.
3. **Crypto stays client-side only.** The server routes opaque Olm/Megolm envelopes and owns control data (accounts, friendships, membership, delivery bookkeeping, key-directory metadata). This preserves spec section 13 trust boundaries unchanged.

## Architecture

One Phoenix application serves two planes, deployed as a single release on the user's VPS with PostgreSQL.

| Plane | Responsibility |
| --- | --- |
| Control plane (Phoenix HTTP) | Phone OTP verification and sessions; device replacement revocation; PIN friend requests, unfriend, block; Circle creation, invitations, roles, 20-participant cap, membership epochs; Olm key directory (identity keys, one-time keys, fallback keys); media authorization (short-lived signed URLs for Supabase ciphertext); push fan-out; report submission; backup metadata |
| Relay plane (Phoenix Channels) | Per-conversation topics; opaque envelope routing; per-recipient delivery acks meaning device receipt; fan-out snapshot frozen at send time; bounded offline queue in PostgreSQL; connection auth tied to session revocation |

Client side (existing approved demo, to be adapted): Expo React Native app on Android first. New native module wraps vodozemac (Rust crate) via Kotlin/JNI. Plaintext, local SQLite history, and all keys live on the phone, per spec sections 5, 11, and 13.

### Message lifecycle (private chat)

1. Sender encrypts with the Olm pairwise session; sends envelope with a client operation ID over the authenticated Channel.
2. Server persists the envelope plus per-recipient delivery rows, then delivers or queues it. The server cannot decrypt it.
3. Recipient device acks on device receipt; server updates delivery state and notifies the sender. No read event exists anywhere in the protocol.
4. Retry reuses the same operation ID; the server deduplicates, satisfying spec section 5's no-duplicate requirement.

### Circle lifecycle and epochs

1. Membership records carry an epoch counter. Invites require acceptance; joins and removals are transactional and enforce the 20-participant cap including creator.
2. Any membership change increments the epoch. Clients rotate their Megolm sender session on the new epoch and distribute it only over Olm pairwise sessions to current members.
3. New members receive only fresh sessions, so pre-join messages, Moments, and their reply previews stay undecryptable (spec sections 6 and 7). Removed members stop receiving sessions at the next rotation.
4. The server enforces membership for routing and metadata; the protocol enforces content confidentiality. Neither substitutes for the other.

### What the server can see (spec section 13, stated honestly)

Accounts and phone numbers at rest, sessions and device records, friendships and PINs, Circle membership and roles, message timestamps/sizes/routing, delivery states, key-directory material (which is useless for decryption without client identity keys), media ciphertext in Supabase, and push tokens. It never sees message bodies, captions, Moments content, reactions, PING content, or media plaintext.

## Global constraints (carried from the spec)

- Android first; preserve future iOS support. One active phone per account; replacement login revokes the previous session.
- Circles capped at 20 participants including the creator; accepted friendship required before private messages or PINGs.
- No read receipts, typing, online, or last-seen indicators at any layer, including logs and push payloads.
- New Circle members cannot access pre-join messages or Moments; only the original sender promotes content, preserving its audience.
- Notifications and logs carry no plaintext (spec section 13).
- No external deployment, credential creation, provider purchase, or store submission during plan execution without explicit authorization.

## Review focus (security invariants to assert in tests)

- Server storage and logs contain only ciphertext envelopes and control data; a database dump cannot yield message content.
- Membership epoch changes gate content access: a new member cannot decrypt prior content; a removed member cannot decrypt future content.
- Fan-out recipients are frozen at send time; later membership changes never rewrite existing delivery records.
- Session revocation kills the Channel connection and rejects all subsequent authenticated requests.
- Retry with a reused operation ID never creates a second message; delivery acks update state but never imply reading.
- Push payloads and notification previews contain no plaintext and no restricted-Moment previews.
- Offline queue entries expire per a bounded retention policy and cannot be delivered to revoked sessions.

## Execution structure

Elixir umbrella or single app under `apps/backend/` (decide at Task 2 scaffold; prefer a single app with clearly separated contexts: `accounts`, `social`, `circles`, `keys`, `relay`, `media`, `push`, `reports`). Database migrations via Ecto. The Go validation probe recorded in the implementation ledger stays isolated under `validation/`; its policy assertions (audience intersection, capacity race) are re-expressed as Elixir tests in Tasks 4 and 5 rather than ported as code.

## Task 1: vodozemac Android validation and E2E design

**Files:** `docs/technical/e2e-design.md`, `validation/e2e/` (Rust probe extensions), `validation/mobile-vodozemac/` (Expo dev-build spike).

**Interfaces:** Produces the reviewed key lifecycle, identity model, envelope schema, and a working Android proof. All later tasks consume these contracts.

- [ ] Extend the existing Rust host probe (vodozemac 0.11.1, recorded in `docs/technical/provider-feasibility.md`): Olm pairwise session, Megolm group session shared over Olm, rotation on simulated membership change, tampered-ciphertext rejection, Megolm key export/import round-trip with passphrase.
- [ ] Pin the vodozemac version and record its MPL-2.0 obligations in `docs/technical/e2e-design.md`.
- [ ] Build the Android spike: a minimal Expo development build with a Kotlin/JNI native module exposing register-identity, create-pairwise-session, encrypt, decrypt, create/rotate-group-session, export/import-keys. Expo Go cannot run this; use a dev build.
- [ ] On two Android devices or emulator plus device: Alice/Bob pairwise exchange; add Carol to a 3-member group and assert she cannot decrypt pre-join traffic; remove Bob and assert his failure to decrypt post-rotation traffic; restart both apps and assert session persistence; restore exported keys into a fresh install and assert history decrypts.
- [ ] Decide and document the identity model: trust-on-first-use with optional SAS/emoji verification, or verification required at first contact. Record the user's decision; do not silently choose.
- [ ] Write `docs/technical/e2e-design.md`: identity and key distribution, Olm session management policy (when to create, when to rebuild), Megolm rotation triggers, envelope schema, key-directory schema, media key distribution, and the explicit list of server-visible metadata.
- [ ] Gate: dependent tasks do not start until the Android spike passes and the design doc is reviewed by the user.

## Task 2: Phoenix foundation and identity

**Files:** `apps/backend/` (mix project), `apps/backend/lib/awsem/accounts/`, `apps/backend/priv/repo/migrations/`, `apps/backend/lib/awsem_web/` (endpoints, Channel socket), `docs/technical/otp-provider.md`.

**Interfaces:** `Accounts.verify_phone(challenge_id, code, device_ctx)`, `Accounts.require_session(token)`, `Accounts.replace_device(actor, new_device_ctx)` (revokes prior session).

- [ ] Scaffold the Phoenix app with Ecto/PostgreSQL, structured logging with a redaction policy (no plaintext, keys, OTP codes, or tokens, per spec section 13), and a health endpoint.
- [ ] Select the OTP provider behind an adapter; record the choice and its trust boundary in `docs/technical/otp-provider.md`. A local stub provider serves tests and development.
- [ ] Failing tests first: expired and replayed OTP rejected; rate limiting enforced; verifying a new phone revokes the previous session and that the revoked token fails on both HTTP and Channel auth; phone numbers absent from every non-owner API response.
- [ ] Implement accounts, sessions, and device records; run tests to green.
- [ ] Wire Channel socket authentication to sessions, so Task 5 inherits revocation for free. Commit.

## Task 3: friendships, block, and the Olm key directory

**Files:** `apps/backend/lib/awsem/social/`, `apps/backend/lib/awsem/keys/`, migrations for friendships, requests, blocks, key material.

**Interfaces:** `Social.request_friend(actor, pin)`, `Social.accept_request(actor, request_id)`, `Social.block(actor, user_id)`; `Keys.publish_bundle(actor, identity_key, one_time_keys, fallback_key)`, `Keys.fetch_bundle(viewer, user_id)`.

- [ ] Failing tests: PIN lookup never exposes phone numbers; requests require accepted state before messaging; blocking stops new requests, messages, and PINGs (spec section 3); one-time-key counts decrement on fetch and exhaustion is reported to the client for refill.
- [ ] Implement PIN lifecycle per the spec's section 16 requirements: format, rotation, and lookup, with the concrete choices recorded in `docs/technical/e2e-design.md`.
- [ ] Implement the key directory per the Task 1 schema: identity key, signed one-time keys, fallback key, keyed by account and device (single device now, schema ready for the future).
- [ ] Client integration: on login, generate and publish the vodozemac identity bundle; on friendship acceptance, establish the Olm session lazily on first message or explicitly at acceptance, per the design doc's policy. Commit.

## Task 4: Circles, membership, and epochs

**Files:** `apps/backend/lib/awsem/circles/`, migrations for circles, memberships, invitations.

**Interfaces:** `Circles.create(actor, name, member_ids)`, `Circles.invite(actor, circle_id, invitee_ids)`, `Circles.accept_invite(actor, invitation_id)`, `Circles.remove_member(actor, circle_id, user_id)`, `Circles.leave(actor, circle_id)`.

- [ ] Failing tests: 21st participant rejected including concurrent joins inside a real PostgreSQL transaction (policy assertion carried over from the earlier Go probe); only admins invite accepted friends; invitation acceptance required; removal/leave stops future routing immediately; epoch increments on every membership change; rejoin produces a new epoch with no access to absence-period content; last-admin and succession rules per the spec's section 16 resolution.
- [ ] Implement roles, transactional capacity enforcement, epoch counter, and membership-scoped queries the relay plane consumes.
- [ ] Client integration: on epoch change, clients rotate Megolm sessions and distribute to current members only; assert in an integration test that a joining member's first decryptable message is post-join. Commit.

## Task 5: relay plane (Channels, receipts, offline queue)

**Files:** `apps/backend/lib/awsem/relay/`, `apps/backend/lib/awsem_web/channels/`, migrations for envelopes and delivery records.

**Interfaces:** Channel events `message.new` (envelope + operation ID), `message.ack` (device receipt), `envelope.history` (cursor paginated); server fan-out enqueues per frozen recipient list.

- [ ] Failing tests: envelope stored and routed only to current authorized recipients; fan-out list frozen at send; ack updates delivery state and never emits any read-like event; reused operation ID deduplicates; revoked session cannot connect or receive; offline queue retention bounded and enforced by a sweeper; reconnect replays only unacked envelopes to that device.
- [ ] Implement topics, envelope persistence, per-recipient delivery rows, offline queue with retention, and cursor pagination matching the handoff doc's data principles.
- [ ] Device verification: Android end-to-end send between two phones through the real backend; airplane-mode retry without duplication; delivery state transitions sending -> sent -> delivered visible in the (demo) UI wired to real state. Commit.

## Task 6: media pipeline

**Files:** `apps/backend/lib/awsem/media/`, Supabase Storage bucket configuration (privileged credentials server-side only).

**Interfaces:** `Media.authorize_upload(actor, conversation_id, media_id)`, `Media.authorize_download(actor, media_id)` returning short-lived signed URLs.

- [ ] Failing tests: download authorization checks current membership at request time; a removed member's signed URL request fails; URLs are short-lived; Supabase objects are ciphertext including thumbnails (spec section 13); media keys travel only inside encrypted envelopes.
- [ ] Implement upload/download authorization; document the encrypted object layout and integrity metadata per the handoff doc's media model.
- [ ] Client: swap the demo's fixture media for real encrypted upload/download through Supabase with the existing PhotoEditor pipeline unchanged. Commit.

## Task 7: push notifications

**Files:** `apps/backend/lib/awsem/push/`, provider adapter, `docs/technical/push-provider.md`.

**Interfaces:** `Push.notify_new_message(envelope_meta)`, `Push.notify_request(...)`, mute preferences per conversation.

- [ ] Select the push provider (Expo push service or direct FCM) behind an adapter; record the choice in `docs/technical/push-provider.md`.
- [ ] Failing tests: payloads contain no plaintext and no message previews; muted conversations suppress alerts but not unread counts; blocked users cannot trigger pushes; PING respects per-chat mute and cooldown (spec section 9).
- [ ] Implement fan-out on relay events; client shows decrypted previews only after local decryption on device. Validate on a real Android device with the app backgrounded. Commit.

## Task 8: safety, reports, and logging policy

**Files:** `apps/backend/lib/awsem/reports/`, audit tests.

- [ ] Block enforcement is complete across private messages, PINGs, and invitations; verify with integration tests at the routing layer.
- [ ] Report flow: client submits only user-selected decrypted content after explicit disclosure (spec section 12); the report store is access-controlled and retention is documented before enabling in any build.
- [ ] Assert the logging policy mechanically: a test greps structured logs produced during the full integration suite for plaintext markers, keys, OTP codes, and tokens. Commit.

## Task 9: profile, status, and Now Playing distribution

**Blocked on:** the section 13 open decision (status/Now Playing audience key design) and the Android media-session feasibility validation recorded in `docs/technical/provider-feasibility.md`.

- [ ] Resolve with the user: encrypt status/Now Playing over pairwise sessions (strongest privacy, higher churn) or distribute as audience-controlled metadata via Phoenix (simpler, server sees current status values). Record the decision in `docs/technical/e2e-design.md` before implementation.
- [ ] Implement the chosen design; Circle bubbles resolve latest status server-assisted or client-fetched per the decision; Now Playing never appears in Circle contexts.

## Task 10: backup groundwork (local first)

**Blocked on:** Task 1 key-export format and the section 16 backup UX decisions.

- [ ] Define the encrypted archive format: local history, media, personal stickers, Circle collections, plus exported Olm/Megolm key material. Recovery password or key never stored with the backup (spec section 11).
- [ ] Implement local export/import with the failure-safety assertions from the earlier plan: wrong secret fails cleanly, interrupted import leaves prior history usable.
- [ ] Google Drive scheduling and the Android job limits follow the local format; scheduled jobs remain best effort with visible last-success/progress/failure state.

## Mapping to spec delivery stages

| Spec stage 2 section | Covered by |
| --- | --- |
| Stage 1: verification, friendships, encrypted chats, Circles, receipts | Tasks 1-5 |
| Stage 1: encrypted backup and restore | Task 10 |
| Stage 2: Moments, replies, reactions, GIFs, Circle emoji, stickers, PING/PONG | Mostly client-side against Tasks 5-6 contracts; no new backend surface beyond relay payload kinds |
| Stage 3: Now Playing | Task 9 |

## Open decisions (do not block Tasks 1-8)

| Decision | Needed by | Notes |
| --- | --- | --- |
| OTP provider purchase/configuration | Task 2 | Adapter pattern means the choice can move |
| Push provider | Task 7 | Expo push vs direct FCM |
| Offline queue retention window | Task 5 | Bounded sweeper; exact duration is an ops choice |
| Identity verification UX (TOFU vs SAS required) | Task 1 gate | User decision required in the E2E design review |
| Status/Now Playing key design | Task 9 | Spec section 13 open item |
| Deployment shape | Before first real deploy | Docker Compose on the VPS is the default proposal; no store submission in this plan |
