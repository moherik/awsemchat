# AwsemChat Phoenix backend and UI wiring design

Date: 2026-10-20
Status: Draft for owner review. Governing product documents: [MVP specification](2026-10-10-awsemchat-mvp-design.md) and [UI/backend handoff](../../technical/ui-backend-handoff.md). Where this document narrows the MVP spec, the narrowing is an owner decision recorded in section 3; privacy and product rules from the spec still apply.

## 1. Intent

The approved AwsemChat mobile UI is complete and runs entirely on an in-memory demo store (`src/mobile/src/features/demo-store.ts`) seeded by fixtures. There is no server, no persistence, and no second participant. This stage delivers an Elixir Phoenix backend and wires the existing UI to it so the app becomes a real, functioning chat application: two people can register, add each other by PIN, chat in real time, hold Circles, post Moments, and see delivery states, all over the network.

The transport and storage shapes are designed so the spec's end-to-end encryption stage can slot in later without reworking the API or the database.

## 2. Goals, non-goals, anti-goals

Goals:

- Phoenix backend with PostgreSQL: accounts, PIN friendships, block/unblock, private conversations, Circles, messages, Moments, reactions, chat preferences, unread positions, delivery bookkeeping.
- Realtime delivery and receipts over Phoenix Channels from the first message; no polling.
- The existing approved UI screens keep their visual design and drive off live backend data.
- Seeded friend accounts with auto-reply behavior so a single emulator shows real two-way chat.
- Session logout (Log out row in You/settings plus token revoke) so accounts can be switched on one device.
- Idempotent sends, cursor pagination, machine-readable error codes, loading/empty/error states that reuse the app's approved snackbar and empty-state patterns.
- Everything the MVP spec requires in stages 1 and 2 except: E2E encryption, encrypted backup/restore, PING/PONG, push notifications, Spotify Now Playing, custom-emoji collections, and GIPHY favorites sync (section 9).

Non-goals (this stage):

- End-to-end encryption. Messages are stored server-side as opaque envelopes that carry a client-encryption-ready payload shape, so encryption becomes a payload-encoding change plus key distribution, not a schema or route rewrite (section 6).
- Push notifications, PING/PONG, backup/restore, Now Playing, custom emoji collections.
- Deployment to a VPS. The backend runs locally (Docker Postgres + `mix phx.server`); the emulator reaches it via `10.0.2.2` (Android) or the LAN IP.
- Production SMS. Login uses a dev OTP behind a provider behaviour.

Anti-goals:

- Do not regress the approved UI. Layout, chrome, colors, spacing, and interactions stay as the owner approved; wiring changes data flow, not visuals.
- Do not leak sender-visible read state, presence, typing, or last-seen anywhere in the API (spec section 5).
- Do not let the demo fixtures remain the source of truth in the wired app: after this stage the app works with no fixture data except an explicit optional seed.

## 3. Recorded decisions

| Decision | Choice | Source |
| --- | --- | --- |
| Backend language/stack | Elixir + Phoenix + Ecto + PostgreSQL | Owner instruction (supersedes the spec's Go) |
| This stage's scope | Core functioning app, E2E later, envelopes designed for it | Owner, 2026-10-20 |
| Auth | Phone number + dev OTP (fixed test code) behind an OTP provider behaviour; real SMS provider swaps in later | Owner, 2026-10-20 |
| Second-party testing | Seeded friend accounts with auto-reply; owner also tests manually on emulator | Owner, 2026-10-20 |
| Chat preferences sync | Pinned/muted/archived sync to the account (survives device replacement) | My call; handoff listed this as undecided. Marked for owner veto. |
| Photo/media storage | Minimal local-disk store behind a Media context: authenticated upload and download by mediaId. Replaced by Supabase + encryption in the media stage. | My call; keeps photo chat/Moment flows functional instead of dead controls. Marked for owner veto. |
| Personal sticker library | Stays device-local for now. Sticker *messages* and Moment stickers work: the client uploads the rendered sticker PNG via `/api/v1/media` and the opaque payload carries the composition metadata plus that mediaId (keeps payloads under the size cap and preserves appearance after later edits). Circle shared-collection lists and library management wire to backend in the sticker stage. | My call, follows spec staging; media-reference detail added 2026-10-20 after plan review. |
| Message model | Every message is an opaque envelope: server stores metadata (ids, sender, timestamps, kind, reply reference, client op id) plus a client-encoded payload blob the server does not interpret. | My call; the E2E-readiness requirement. |
| Database | PostgreSQL 16 in a dedicated Docker container (`awsemchat-postgres`), never touching the existing `openpay-postgres` container | My call |
| Backend location | `src/backend/` (Phoenix project at repo root of that directory) | My call |
| Mobile network config | `EXPO_PUBLIC_API_URL` env var; default `http://10.0.2.2:4000` for Android emulator, overridable in `.env.local` | My call |
| Session token storage on device | Token persisted with `expo-file-system` (already installed). `expo-secure-store` swap is part of the security stage; no new native dependency this stage. | My call |
| Block/report scope | Block/unblock wired this stage (blocks new friend requests and private messages between the pair; shared Circles unaffected per spec; the private chat becomes read-only per the row below). Report deferred (needs review workflow). | Owner, 2026-10-20 |
| Logout | Add a Log out row to the You/settings list + `POST /auth/logout` token revoke. Only approved-UI addition of this stage. | Owner, 2026-10-20 |
| Unfriend/block conversation fate | Conversation stays visible in both chat lists, read-only: history readable, sends refused with an error code. | Owner, 2026-10-20 |
| Offline sends | Client keeps an outbox of pending sends keyed by clientOpId; pending messages auto-flush on socket reconnect (spec acceptance scenario 2, no duplicates via idempotency). Manual Retry remains for hard failures. | Answered by spec acceptance scenario 2 |
| Shared media screen | Server endpoint `GET /conversations/:id/media` with cursor pagination. Media references ride as send metadata (`message_media` table), not by parsing opaque payloads, keeping the envelope opacity rule intact. | My call (reviewer gap 2) |
| Circle delivered state with removed/unreachable recipients | Intended recipients are captured at send time. A recipient who leaves/is removed before acking is recorded as unreachable; the bubble shows Delivered only when every still-reachable intended recipient acked, and sender-side details show the delivered-to count. Never falsely marks complete. | My call (spec requires an explicit policy; satisfies "no false completion") |

## 4. Architecture

One Phoenix application. Contexts (domain layer) with transport kept thin:

- **Accounts** — users, phone numbers, dev OTP sessions, auth tokens, profiles (display name, PIN, avatar media reference, text status), block list.
- **Social** — friend requests (send by PIN, accept, decline, cancel), friendships, unfriend.
- **Chat** — conversations (private/circle), memberships with join boundaries, messages (envelopes), delivery bookkeeping, unread positions, own chat preferences.
- **Moments** — moment posts, promotion from chat messages, author-only deletion.
- **Reactions** — toggle reactions on messages and Moments, aggregate counts, viewer state.
- **Media** — dev-stage authenticated upload/download; interface isolated so Supabase replaces one module.
- **Directory** — personal sticker records that travel in envelopes are not stored; only referenced media ids resolve through Media.

Transport:

- REST JSON under `/api/v1` for reads and mutations (lists, sends, accepts, edits).
- Phoenix Channels for realtime: one socket at `/socket`, authenticated by token in connect params. Per-user topic `user:<id>` carries: new message envelopes, delivery receipts, friend request changes, membership changes, moment changes, reaction changes, preference conflicts. The client acks device receipt per message on the same socket, which is what "delivered" means (spec section 5: device receipt, not read).
- The mobile side uses the official `phoenix` JS client (works with React Native's WebSocket).

Seeding and bots (`mix run priv/repo/seed.exs` and a `Bots` GenServer):

- Creates owner-visible test accounts and friend relationships so the app is not empty on first run.
- Auto-reply: when a private message arrives from the owner to a bot user, the bot replies after a short delay (scripted responses with an echo fallback) through the same server-side delivery path a real client uses. Bots are ordinary users; the auto-responder is a small GenServer subscribed to the bot topics. Circle messages are not auto-replied (keeps circles honest; the owner tests circles with a second account or the web build later).

## 5. Data model (PostgreSQL, Ecto migrations)

All ids are UUIDs generated server-side (`binary_id`). All timestamps UTC, delivered as ISO-8601.

- `users`: id, phone (unique), display_name, pin (unique, 6-char, contact identifier only), avatar_media_id (nullable), status_text, now_playing (nullable, reserved), inserted_at.
- `auth_tokens`: id, user_id, token_hash, revoked_at, last_used_at. One active session per account; a fresh login revokes the previous token (spec: replacement phone revokes old session).
- `otp_codes`: id, phone, code_hash, expires_at, consumed_at. Dev OTP provider writes here; a future SMS provider implements the same `OtpProvider` behaviour.
- `friend_requests`: id, sender_id, recipient_id, state (pending/accepted/declined/cancelled), inserted_at.
- `friendships`: id, user_id, friend_id, created_at. Derived from accepted requests.
- `conversations`: id, type (private/circle), private_key (nullable, unique pair), circle fields: name, description, avatar_media_id, created_by. Private conversation exists once both sides are friends; created lazily on first open.
- `circle_memberships`: id, circle_id, user_id, role (owner/admin/member), state (active/left/removed), joined_at, left_at. History visibility boundary is `joined_at`; a rejoin inserts a new row so an absence never revives old access (spec section 6).
- `circle_invitations`: id, circle_id, inviter_id, invitee_id, state (pending/accepted/declined/revoked), inserted_at. Capacity (20 active) enforced transactionally with the membership insert.
- `messages`: id, conversation_id, sender_id, client_op_id (unique per sender, idempotency), kind (text/media/sticker/moment-ref), payload (jsonb, client-encoded, opaque to server), reply_to_message_id (nullable), reply_to_moment_id (nullable), created_at. Server never reads `payload` contents.
- `deliveries`: (message_id, user_id) → delivered_at. Written when the recipient client acks device receipt. Circle "delivered" state = acked recipients vs intended recipients captured at send time.
- `conversation_positions`: (conversation_id, user_id) → last_seen_message_id, updated only by the owning client; never exposed to other users; used for unread counts.
- `message_media`: (message_id, media_id, position) — media references as send-time metadata, used for the shared-media grid and authorization without reading opaque payloads.
- `blockings`: (blocker_id, blocked_id, created_at). Derived checks at send time and request time.
- `conversation_preferences`: (conversation_id, user_id) → pinned, pin_order, muted, archived.
- `moments`: id, conversation_id, author_id, kind (text/media/sticker), payload (jsonb, opaque), source_message_id (nullable, promotion), created_at, deleted_at. Audience filter: membership with `joined_at <= moment.created_at`.
- `reactions`: id, target_type (message/moment), target_id, user_id, emoji (string identifier). Unique per (target, user); the UI toggle keeps single-reaction-per-viewer semantics the demo has.
- `media`: id, owner_id, mime, byte_size, width, height, storage_path (dev local disk), inserted_at. Served only through the authenticated Media endpoint.

## 6. Message envelopes and E2E readiness

The server stores a message as metadata plus a `payload` jsonb blob the server treats as opaque bytes-with-shape. This stage the client encodes payloads as readable JSON:

```json
{ "v": 1, "text": "hello", "media": null, "sticker": null }
```

The encryption stage changes only the client encoder/decoder (payload becomes ciphertext + sender key material) and adds a key-distribution topic; routes, ids, delivery bookkeeping, pagination, and receipts are payload-agnostic by design. The `v` field versions the encoding. No server code reads inner fields; server validation is limited to size caps (payload <= 256 KB) and required metadata.

Replies quote by stable id (`reply_to_message_id`), and the client resolves quote snapshots locally; a deleted or inaccessible target renders as the approved unavailable-quote state (handoff section 7).

## 7. API surface (initial)

REST (`/api/v1`, JSON, bearer token except auth routes):

- `POST /auth/request_code` {phone} → {requestId}; `POST /auth/verify_code` {phone, code} → {token, user}; dev OTP prints/logs the code.
- `GET /me`, `PATCH /me` {displayName, statusText, avatarMediaId}, `POST /auth/logout`.
- `GET /friends?query=&cursor=`, `POST /friends/requests` {pin}, `GET /friends/requests` {direction}, `POST /friends/requests/:id/accept|decline|cancel`, `DELETE /friends/:userId`.
- `POST /blocks` {userId}, `DELETE /blocks/:userId`, `GET /blocks`.
- `GET /conversations?filter=all|private|circles&cursor=` → rows with last message reference, unread count, own preferences; `POST /conversations` {peerUserId} for private.
- `GET /conversations/:id/messages?cursor=&direction=`, `POST /conversations/:id/messages` {clientOpId, kind, payload, mediaIds[], replyTo...} → accepted envelope; retried clientOpId returns the original message (idempotent retry).
- `GET /conversations/:id/media?cursor=` → shared-media grid data (photos/GIFs, excludes stickers), backed by `message_media`.
- `POST /messages/:id/delivered` (or channel ack) → receipt.
- `PUT /conversations/:id/preferences`, `POST /conversations/:id/position`.
- Circles: `POST /circles`, `GET /circles/:id`, `PATCH /circles/:id`, `POST /circles/:id/invitations` {userIds[]}, `POST /invitations/:id/accept|decline`, `POST /circles/:id/leave`, `DELETE /circles/:id/members/:userId`, membership list cursor-paginated.
- Moments: `GET /conversations/:id/moments?cursor=`, `POST /conversations/:id/moments` {clientOpId, kind, payload, sourceMessageId?}, `DELETE /moments/:id`.
- Reactions: `PUT /reactions` {targetType, targetId, emoji}, `DELETE /reactions`.
- Media: `POST /media` (multipart) → {mediaId}, `GET /media/:id` (authenticated) → bytes.

Channel events (`user:<id>` topic):

- server→client: `message:new` (envelope), `message:delivered` (receipt update), `friend_request:changed`, `circle:changed`, `moment:changed`, `reaction:changed`.
- client→server: `message:ack` {messageId} (device receipt).

Errors are `{ "error": { "code": "friend_request_not_found", "message": "..." } }` with stable machine-readable codes the UI maps to snackbars/empty states.

## 8. Mobile wiring

New `src/mobile/src/data/` layer replaces the demo store as source of truth while keeping the approved screens:

- `api.ts` — typed REST client, base URL from `EXPO_PUBLIC_API_URL`, bearer token, error-code mapping.
- `socket.ts` — `phoenix` channel client; reconnect with backoff; offline detection drives the approved offline/error states.
- `models.ts` — wire types matching section 5 (opaque payload + envelope metadata).
- `store.ts` — same external-store subscription pattern as `demo-store.ts` (`useSyncExternalStore`), but state is backend data: session, friends/requests, conversations with cursors, per-conversation loaded message pages, moments, reactions. Actions call the API, update optimistically (sending state), reconcile on response/channel event, and roll back to failed state with retry on error. Pending sends live in an outbox keyed by clientOpId and auto-flush on socket reconnect without duplication; manual Retry handles hard failures.
- Screens (`chat-app.tsx`, `flows.tsx`, sticker screens) migrate from name-keyed/index-keyed demo models to id-keyed models: message replies and Moment references use stable ids, unread counts and delivery states come from the server, friend/circle rows render backend profiles. Visual components, layout, palette, and interactions are untouched.
- Read-only conversations (after unfriend/block): composer disabled with the existing failed/unavailable affordance; sends return `conversation_read_only` and render the approved error snackbar.
- Onboarding screens in `flows.tsx` (phone/OTP/profile) wire to the auth endpoints; dev OTP code is shown in a snackbar in dev builds so the flow is completable on the emulator.
- You/settings gains one new row, Log out (owner-approved addition): revokes the token, clears the local session, returns to onboarding. Block/unblock in the privacy settings wire to the block endpoints.
- `demo-store.ts` and `sample-data.ts` remain only as the fixture path for the existing web demo build; the wired app does not depend on them. Removal is a follow-up if the owner wants the demo path retired.

## 9. Explicitly deferred to later stages (per spec staging)

E2E encryption and key distribution; encrypted backup/restore; push notifications and their privacy policy; PING/PONG; Spotify/Now Playing; custom-emoji collections and sticker library management server sync; GIPHY favorites sync (stays local); Supabase media pipeline with encrypted objects; report submission and review workflow (owner decision 2026-10-20; until then the Report control is not wired and must be labeled coming-soon rather than left dead); account deletion and number-reassignment policy.

## 10. Testing and verification

- Backend: ExUnit with per-test DB sandbox; contexts covered by tests (auth/OTP, friendships, circle capacity under concurrency, join-boundary history filtering, idempotent sends, receipt bookkeeping, reaction toggles, author-only Moment deletion, preference sync). Channel tests for receipt and fan-out.
- Mobile: `npx tsc --noEmit` and `npx expo lint` after wiring (per mobile AGENTS.md); store logic covered by the existing `tests/*.test.mjs` node-test pattern where practical.
- Manual verification (owner on emulator): register two accounts (owner + seeded friend), friend request by PIN, realtime private chat with auto-reply, delivery states, circle create/invite/join, moments post and delete, reactions, archive/pin/mute, block/unfriend read-only behavior, logout and second-account login, offline → retry without duplicates. I record a click-through of every wired control per antislop R-35 before declaring done.

## 11. Resolved questions (recorded 2026-10-20)

1. Server-synced chat preferences: sync-to-account (my call; owner may veto at review).
2. Local-disk media storage this stage, Supabase later (my call; owner may veto at review).
3. Seeded bot replies: canned scripted responses plus echo fallback (owner confirmed the auto-reply testing approach).
4. Block wired this stage, report deferred; report control labeled coming-soon until its review workflow exists (owner decision).
5. Log out row added to You/settings with token revoke (owner decision).
6. Unfriend/block leaves the private conversation visible but read-only on both sides (owner decision).
