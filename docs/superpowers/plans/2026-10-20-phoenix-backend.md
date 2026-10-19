# AwsemChat Phoenix Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Elixir Phoenix backend for AwsemChat: accounts with dev OTP, PIN friendships and blocking, private conversations and Circles, opaque-envelope messages with realtime delivery over Channels, Moments, reactions, chat preferences, unread positions, media, seeds and auto-reply bots.

**Architecture:** One Phoenix API app (`src/backend`, module `AwsemChat`/`AwsemChatWeb`) with domain contexts (Accounts, Social, Chat, Moments, Reactions, Media, Bots) behind thin REST controllers under `/api/v1` plus one authenticated per-user Channel topic for realtime fan-out. Messages are stored as metadata plus an opaque `payload` jsonb the server never reads, so the later E2E stage changes only client encoding. PostgreSQL 16 runs in a dedicated Docker container.

**Tech Stack:** Elixir 1.16.0 / OTP 26, Phoenix 1.7.20 (installed `phx_new` archive), Ecto SQL + Postgrex, Bandit, phoenix PubSub/Channels, cors_plug, ExUnit with SQL sandbox, Docker `postgres:16-alpine`.

**Spec:** `docs/superpowers/specs/2026-10-20-phoenix-backend-design.md` (approved 2026-10-20). The plan argues from that spec; executors read both. Product rules still come from `docs/superpowers/specs/2026-10-10-awsemchat-mvp-design.md`.

## Global Constraints

- Backend root: `src/backend/`. App name `awsemchat`, web module `AwsemChatWeb`. Generate with `mix phx.new awsemchat --no-html --no-assets --no-dashboard --no-mailer --no-live --no-gettext` and move contents up so the app root is `src/backend/` itself (generator runs in a temp dir or use `--app awsemchat` in place; do not create a second nested repo root).
- Postgres: Docker container name `awsemchat-postgres`, image `postgres:16-alpine`, host port **5433** (5432 is occupied by an unrelated `openpay-postgres` container that must never be touched), user/password/db `postgres`/`postgres`/`awsemchat_dev` and `awsemchat_test`. Ship `src/backend/docker-compose.yml` and `.env.dev` style config in `config/dev.exs`/`config/test.exs`.
- Payload opacity: no server code may read, validate, or transform fields inside `messages.payload`, `moments.payload`. Size cap 256 KB per payload only.
- No read receipts, presence, typing, or last-seen anywhere in API or events. `conversation_positions` is never returned to anyone but its owner.
- IDs: server-generated UUIDs (`binary_id`). Timestamps UTC; JSON ISO-8601.
- Error shape everywhere: `{"error": {"code": "snake_case_code", "message": "human text"}}`. Codes are defined once in `AwsemChatWeb.Errors` and never invented inline.
- Auth: bearer token in `Authorization` header; socket connects with `?token=`. All routes under `/api/v1` except `POST /api/v1/auth/request_code` and `POST /api/v1/auth/verify_code`.
- Circles: 20 active members max including creator, enforced inside the same transaction as the membership insert.
- Every mutation that another device must see broadcasts on `user:<id>` topics via `AwsemChatWeb.UserChannel` (see Event contract below).
- Do not modify the mobile app in this plan (that is Plan 2), except nothing at all in this plan.
- Working branch: current checkout on `v2`; commit per task.

## Event contract (Channel `user:<id>`, topic string `"user:" <> user_id`)

Server→client events, all payloads JSON-encoded maps:

- `"message:new"` → `%{"message" => envelope}` sent to every member of the conversation (sender included).
- `"message:delivered"` → `%{"messageId" => id, "userId" => reader_id, "deliveredAt" => ts}` sent to the sender only.
- `"friend_request:changed"` → `%{"request" => request_json}` to sender and recipient.
- `"friends:changed"` → `%{}` to both sides on accept/unfriend/block changes.
- `"circle:changed"` → `%{"circleId" => id, "change" => "created"|"updated"|"member_added"|"member_removed"|"left"|"invitation"}` to affected members.
- `"moment:changed"` → `%{"conversationId" => id, "momentId" => id, "change" => "created"|"deleted"|"reaction"}` to conversation members with access.
- `"reaction:changed"` → `%{"targetType" => "message"|"moment", "targetId" => id, "reactions" => [...]}` to conversation members.

Envelope JSON (wire shape, produced by `AwsemChat.Chat.Envelope.render/1`):

```json
{"id":"uuid","conversationId":"uuid","senderId":"uuid","clientOpId":"uuid",
 "kind":"text|media|sticker|moment-ref","payload":{},
 "replyTo":{"kind":"message|moment","id":"uuid"}|null,
 "mediaIds":["uuid"],"createdAt":"ISO-8601"}
```

Message state on the wire: `state` ∈ `sending|sent|delivered` is client-derived (a message the server accepted is at least `sent`; it becomes `delivered` when `message:delivered` reports all reachable intended recipients acked). The server does not store a state field.

## Review Focus (most likely failure classes; each has a pinned test in its owning task)

1. **Duplicate sends under retry**: the same `clientOpId` retried after a timeout returns the original message and inserts exactly one row. Pinned in Task 4 (`test_idempotent_send_returns_original`).
2. **Circle capacity race**: two concurrent invitation-accepts racing the 20-member cap result in exactly one active membership; the loser gets `:circle_full`. Pinned in Task 6 (`test_concurrent_join_capacity_race`).
3. **Join-boundary and removal leaks**: a member who joins after messages/Moments exist cannot list them; a removed member receives no further `message:new` fan-out even if a socket is still open. Pinned in Task 6 (`test_new_member_cannot_list_prejoin_messages`, `test_removed_member_gets_no_future_fanout` — the latter extended in Task 5's harness).
4. **Read-only enforcement**: after unfriend or block, sends fail with `conversation_read_only`/`blocked` AND the ex-friend's open socket stops receiving new messages for that conversation, while history lists still work. Pinned in Task 4 (`test_send_refused_after_unfriend_still_reads_history`) and Task 5 (`test_no_fanout_after_unfriend`).
5. **Receipt/position privacy**: `GET /conversations` and envelopes never include other users' positions or read state; the only cross-user signal is `delivered` acks. Pinned in Task 9 (`test_conversation_list_contains_no_foreign_read_state`).

---

### Task 1: Scaffold Phoenix app, Docker Postgres, green test harness

**Files:**
- Create: everything `mix phx.new` generates under `src/backend/` (API-only flags), `src/backend/docker-compose.yml`, `src/backend/.gitignore` additions (`/priv/media/`)
- Modify: `src/backend/config/test.exs` (port 5433, `awsemchat_test`), `src/backend/config/dev.exs` (port 5433, `awsemchat_dev`), `src/backend/mix.exs` (add `:cors_plug`, `:ecto_sql`, `:postgrex`, `:bandit` — generator defaults plus cors_plug)

**Interfaces:**
- Produces: runnable `mix phx.server` on port 4000; `mix test` with Ecto sandbox.

- [ ] **Step 1: Create the Postgres container**

`src/backend/docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: awsemchat-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: awsemchat_dev
    ports:
      - "5433:5432"
    volumes:
      - awsemchat-pgdata:/var/lib/postgresql/data
volumes:
  awsemchat-pgdata:
```

Run: `docker compose -f src/backend/docker-compose.yml up -d` then `docker exec awsemchat-postgres psql -U postgres -c 'create database awsemchat_test;'`

- [ ] **Step 2: Generate the API-only Phoenix app in place**

Run in a temp dir and move, or `cd src/backend && mix phx.new awsemchat --no-html --no-assets --no-dashboard --no-mailer --no-live --no-gettext` then relocate so `src/backend/mix.exs` is the project file (no nested `awsemchat/` directory). `mix deps.get`, set repo config host `localhost`, port 5433, in `dev.exs`/`test.exs`.

- [ ] **Step 3: Verify test harness**

Run: `cd src/backend && mix ecto.create && mix ecto.migrate && mix test`
Expected: `0 failures` (empty suite), no connection errors.

- [ ] **Step 4: Commit**

```bash
git add src/backend
git commit -m "feat(backend): scaffold Phoenix API app with Docker Postgres"
```

### Task 2: Accounts — users, dev OTP, tokens, auth plug, profile

**Files:**
- Create: `src/backend/lib/awsemchat/accounts/user.ex`, `src/backend/lib/awsemchat/accounts.ex` (context), `src/backend/lib/awsemchat/accounts/otp.ex` (behaviour + `DevOtp` impl), `src/backend/lib/awsemchat/accounts/token.ex`, `src/backend/lib/awsemchat_web/controllers/auth_controller.ex`, `src/backend/lib/awsemchat_web/controllers/me_controller.ex`, `src/backend/lib/awsemchat_web/auth.ex` (plug), `src/backend/priv/repo/migrations/*_create_users_and_auth.exs`
- Test: `src/backend/test/awsemchat/accounts_test.exs`, `src/backend/test/awsemchat_web/auth_flow_test.exs`

**Interfaces:**
- Produces (consumed by every later task):
  - `Accounts.request_code(phone :: String.t()) :: {:ok, %{requestId: String.t()}}` (dev: logs code via `Otp` behaviour)
  - `Accounts.verify_code(phone, code) :: {:ok, %{token: String.t(), user: %User{}}} | {:error, atom}`
  - `Accounts.authenticate(token :: String.t()) :: {:ok, %User{}} | {:error, :unauthorized}` (revoked/unknown token fails)
  - `Accounts.logout(token) :: :ok`
  - `Accounts.update_profile(user, %{displayName | statusText | avatarMediaId}) :: {:ok, %User{}}`
  - `Accounts.get_by_phone(phone)`, `Accounts.PIN.generate()` → 6-char A-Z0-9 unique; every user has one at creation.
  - Plug `AwsemChatWeb.Auth` puts `:current_user` or halts 401 `unauthorized`.
  - `Otp` behaviour: `request(phone) :: :ok`, `fetch(phone) :: {:ok, code}`; `DevOtp` stores in ETS, code `"123456"` constant per design doc dev UX, and logs it.

Migration: `users` per design doc section 5 (`avatar_media_id` uuid nullable, NO DB FK — application-level; recorded in design doc decision table).

- [ ] **Step 1: Write failing tests**

`accounts_test.exs`: `test_request_and_verify_code_returns_token`, `test_wrong_code_rejected`, `test_expired_code_rejected` (DevOtp short TTL, travel time or inject expiry), `test_new_login_revokes_previous_token` (verify twice, first token then `authenticate` → `:unauthorized`), `test_logout_revokes_token`, `test_update_profile_sets_status_and_pin_unique`.

`auth_flow_test.exs` (controller, `/api/v1`): request_code → verify_code → `GET /me` with bearer 200 returns `{id, displayName, pin, statusText, avatarMediaId}`; without token 401 `{"error":{"code":"unauthorized"}}`; `PATCH /me` updates displayName.

- [ ] **Step 2: Run to verify failure**

Run: `cd src/backend && mix test test/awsemchat/accounts_test.exs`
Expected: compile error / failures referencing missing modules.

- [ ] **Step 3: Implement Accounts**

Context functions per Interfaces. Token: 32 random bytes, base64url, stored as SHA-256 hash in `auth_tokens`; `verify_code` revokes all previous tokens for the user (one active session, spec §3).

- [ ] **Step 4: Run tests to pass**

Run: `cd src/backend && mix test`
Expected: all pass.

- [ ] **Step 5: Commit** `feat(backend): accounts, dev OTP auth, tokens, profile`

### Task 3: Media context and authenticated upload/download

**Files:**
- Create: `src/backend/lib/awsemchat/media.ex`, `src/backend/lib/awsemchat/media/store.ex` (behaviour), `src/backend/lib/awsemchat/media/local_store.ex`, `src/backend/lib/awsemchat_web/controllers/media_controller.ex`, migration `create_media`
- Test: `src/backend/test/awsemchat/media_test.exs`, controller tests in `src/backend/test/awsemchat_web/media_controller_test.exs`

**Interfaces:**
- Produces:
  - `Media.upload(owner :: %User{}, %Plug.Upload{}) :: {:ok, %Media{}} | {:error, :too_large | :unsupported}`
  - `Media.fetch!(media_id) :: %Media{}`; `Media.authorized?(user, media) :: boolean` (owner, or media referenced by a message in a conversation the user actively belongs to — needs `Media.record_reference/2` called from Chat in Task 4; until then owner-only)
  - `Store` behaviour: `put(upload) :: {:ok, path}`, `open(path) :: {:ok, IO.device}`; `LocalStore` writes under `priv/media/` (gitignored).
  - Route: `POST /api/v1/media` multipart field `file`, max 10 MB → `{"mediaId": uuid}`; `GET /api/v1/media/:id` streams bytes, 404 `media_not_found`, 403 `forbidden`.
- Consumes: `Accounts.authenticate/1`, `Auth` plug.

- [ ] **Step 1: Failing tests** (upload stores metadata + file; oversize rejected; download by owner streams original bytes; download by stranger 403; unauthenticated 401)
- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: `mix test` pass**, **Step 5: Commit** `feat(backend): media upload/download with local store`

### Task 4: Social — friend requests, friendships, blocking; Chat core — conversations and messages

**Files:**
- Create: `src/backend/lib/awsemchat/social.ex`, `src/backend/lib/awsemchat/social/{friend_request,friendship,blocking}.ex`, `src/backend/lib/awsemchat/chat.ex`, `src/backend/lib/awsemchat/chat/{conversation,message,message_media}.ex`, `src/backend/lib/awsemchat/chat/envelope.ex`, controllers `friends_controller`, `conversations_controller`, `messages_controller`, migrations for all tables per design doc §5
- Test: `src/backend/test/awsemchat/social_test.exs`, `src/backend/test/awsemchat/chat_test.exs`, `src/backend/test/awsemchat_web/conversations_controller_test.exs`

**Interfaces:**
- Produces:
  - `Social.request_by_pin(user, pin) :: {:ok, %FriendRequest{}} | {:error, :not_found | :self | :blocked | :already_friends}`
  - `Social.respond(user, request_id, :accept | :decline | :cancel) :: {:ok, %FriendRequest{}} | {:error, atom}`; accept creates the private `Conversation` (`type: :private`, `private_key` = lexicographically sorted pair uuid) if absent, both directions of `Friendship` row (one row per direction simplifies queries; or single row pair — implementer's choice, documented in module).
  - `Social.unfriend(user, other) :: :ok`; `Social.block(user, other) :: :ok`, `Social.unblock/2`; `Social.blocked_either?(a, b)`, `Social.are_friends?(a, b)`.
  - `Chat.send_message(sender, conversation_id, %{clientOpId, kind, payload, mediaIds, replyTo}) :: {:ok, %Message{}} | {:error, :conversation_read_only | :blocked | :not_member | :not_found | :payload_too_large}` — private: active friendship both ways, no block either direction, conversation not read-only; circle: active membership. Read-only = conversation exists and friendship/blocking currently forbids new sends but the row is retained (visible, history readable, per owner decision). Idempotent: unique index `(sender_id, client_op_id)`; on conflict return existing message. On accept, pre-creates one pending `deliveries` row per intended recipient (recipient set captured at send time, per design doc).
  - `Chat.list_messages(user, conversation_id, opts)` — cursor keyset on `(created_at, id)`, default page 50, direction `before`; enforces membership + join-boundary for circles + read-only still readable.
  - `Envelope.render(message) :: map` per contract above. Message kinds: `text`, `media` (photo/GIF pixels uploaded via `/api/v1/media` first; `mediaIds[]` set), `sticker` (payload = composition metadata + `mediaId` of the rendered PNG uploaded the same way — never raw base64 pixels, keeping payloads under the 256 KB cap), `moment-ref` (reserved).
  - Routes: `POST /api/v1/auth/logout` (revokes bearer token); `GET/POST /api/v1/friends...`, `POST/DELETE` blocks per design doc §7; `POST /api/v1/conversations` {peerUserId}; `GET /api/v1/conversations/:id/messages`; `POST /api/v1/conversations/:id/messages`.
- Consumes: Accounts, Media (`record_reference/2` when `mediaIds` present).

- [ ] **Step 1: Failing tests** (social): `test_request_by_pin_creates_pending`, `test_accept_creates_friendship_and_private_conversation`, `test_blocked_cannot_request`, `test_unfriend_keeps_conversation_visible_readonly`, `test_block_stops_new_requests`
- [ ] **Step 2: Failing tests** (chat): `test_idempotent_send_returns_original` (Review Focus 1), `test_send_refused_after_unfriend_still_reads_history` (Review Focus 4), `test_send_refused_when_blocked`, `test_payload_over_256kb_rejected`, `test_message_pagination_cursor_stable`, `test_reply_to_message_in_same_conversation_renders_in_envelope` (replyTo id round-trips in `Envelope.render`), `test_reply_to_message_in_other_conversation_rejected` (`:not_found` — cannot quote across audiences, design doc privacy §7)
- [ ] **Step 3: Verify failure**, **Step 4: Implement** (unique index migration for `(sender_id, client_op_id)`; read-only check = `Social.send_allowed?(sender, peer)` false while conversation row retained)
- [ ] **Step 5: `mix test` pass**, **Step 6: Commit** `feat(backend): friendships, blocking, conversations, idempotent messages`

### Task 5: Realtime — UserSocket, UserChannel, fan-out, delivery acks

**Files:**
- Create: `src/backend/lib/awsemchat_web/channels/user_socket.ex`, `.../user_channel.ex`, `src/backend/lib/awsemchat/chat/delivery.ex` (+ migration `deliveries`), `src/backend/lib/awsemchat_web/controllers/...` (none new; ack arrives on channel)
- Modify: `Chat.send_message` and `Social` accept mutations to broadcast (extract `Chat.Broadcast` helper that fans out `message:new` to all members **whose authorization still holds at fan-out time** — membership + not blocked + conversation visible)
- Test: `src/backend/test/awsemchat_web/channels/user_channel_test.exs`, `src/backend/test/awsemchat/chat/broadcast_test.exs`

**Interfaces:**
- Produces:
  - Socket connect params `%{"token" => token}` → `{:ok, socket}` with `assign(:user_id, ...)`; bad token closes with reason.
  - Channel topic `"user:" <> id`, `join/3` rejects other topics.
  - `Chat.ack_delivered(user, message_id) :: :ok` — flips the user's pending `deliveries` row to delivered (circles: each recipient acks their own row; a removed member's pending row is marked unreachable rather than left pending forever). Emits `message:delivered` to sender with the current acked/total counts.
- Consumes: envelope render, Social authz predicates.

- [ ] **Step 1: Failing channel tests**: `test_socket_rejects_bad_token`, `test_message_new_fans_out_to_both_participants`, `test_ack_delivered_notifies_sender`, `test_no_fanout_after_unfriend` (open socket, unfriend via API, second send → absent event; Review Focus 4)
- [ ] **Step 2: Verify failure**, **Step 3: Implement** (broadcasts fired inside the same process after `send_message` commits; use `Phoenix.Channel.Server` via `endpoint.broadcast("user:" <> id, event, payload)`)
- [ ] **Step 4: `mix test` pass**, **Step 5: Commit** `feat(backend): user channel realtime fan-out and delivery acks`

### Task 6: Circles — creation, invitations, membership, capacity, join boundaries

**Files:**
- Create: `src/backend/lib/awsemchat/chat/{circle,circle_membership,circle_invitation}.ex`, `src/backend/lib/awsemchat/chat/circles.ex`, `src/backend/lib/awsemchat_web/controllers/circles_controller.ex`, migrations
- Test: `src/backend/test/awsemchat/circles_test.exs`, `src/backend/test/awsemchat_web/circles_controller_test.exs`

**Interfaces:**
- Produces:
  - `Circles.create(creator, %{name, description, avatarMediaId})` — creates conversation `type: :circle`, creator active owner membership.
  - `Circles.invite(actor, circle_id, [user_ids]) :: {:ok, per_person_results}` (only accepted friends; batch), `Circles.respond(user, invitation_id, :accept | :decline)` — accept inserts membership **and** checks capacity in one transaction with a lock (`SELECT ... FOR UPDATE` on a circle counter row or membership count inside tx) → `{:error, :circle_full}`.
  - `Circles.leave(user, circle_id)`, `Circles.remove_member(actor, circle_id, user_id)` (admin/owner only), `Circles.update(actor, circle_id, attrs)`, `Circles.list_members(circle_id, cursor)`.
  - Join boundary: `Chat.list_messages` and `Moments` filter with `membership.joined_at <= message/moment.created_at` for the viewer's current membership row; rejoin = new row (already per schema).
- Consumes: Social friendships for invite eligibility; channel events (`circle:changed`) from Task 5.

- [ ] **Step 1: Failing tests**: `test_create_circle_with_owner_membership`, `test_invite_requires_accepted_friendship`, `test_accept_join_boundary_hides_prejoin_messages` (Review Focus 3), `test_concurrent_join_capacity_race` (two Tasks racing accept at 19 active; assert exactly one active 20th, loser `:circle_full`; Review Focus 2), `test_removed_member_cannot_list_messages_after_removal_and_gets_no_fanout`, `test_last_owner_leave_promotes_successor` (owner policy: promote oldest active member; if none, circle stays memberless read-only row)
- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: `mix test` pass**, **Step 5: Commit** `feat(backend): circles with capacity, invitations, join boundaries`

### Task 7: Moments — create, list, promote, author-only delete

**Files:**
- Create: `src/backend/lib/awsemchat/moments.ex`, `src/backend/lib/awsemchat/moments/moment.ex`, `src/backend/lib/awsemchat_web/controllers/moments_controller.ex`, migration
- Test: `src/backend/test/awsemchat/moments_test.exs`

**Interfaces:**
- Produces:
  - `Moments.create(user, conversation_id, %{clientOpId, kind, payload, sourceMessageId})` — promotion path requires `message.sender_id == user.id`, same conversation; audience = membership with `joined_at <= created_at`.
  - `Moments.list(user, conversation_id, cursor)` — audience-filtered; `Moments.delete(author, moment_id)` (author-only, else `:forbidden`); broadcasts `moment:changed`.
- Consumes: Chat membership predicates, channel broadcasts.

- [ ] **Step 1: Failing tests**: `test_create_and_list_moment`, `test_only_author_can_promote`, `test_only_author_can_delete`, `test_new_member_cannot_see_prejoin_moment` (Review Focus 3)
- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: `mix test` pass**, **Step 5: Commit** `feat(backend): moments with audience boundaries and promotion`

### Task 8: Reactions — toggle, aggregates, events

**Files:**
- Create: `src/backend/lib/awsemchat/reactions.ex`, `.../reaction.ex`, `src/backend/lib/awsemchat_web/controllers/reactions_controller.ex`, migration
- Test: `src/backend/test/awsemchat/reactions_test.exs`

**Interfaces:**
- Produces: `Reactions.set(user, target_type, target_id, emoji)` → unique (target,user); `Reactions.unset(user, target_type, target_id)`; `Reactions.list_for(target_type, ids) :: %{id => [%{emoji, userId}]}`; target must be visible to user; `reaction:changed` broadcast to conversation members.
- [ ] **Step 1: Failing tests**: `test_toggle_reaction_unique_per_user`, `test_aggregate_counts`, `test_cannot_react_to_invisible_target` (pre-join moment)
- [ ] **Step 2–5**: verify fail, implement, pass, commit `feat(backend): reactions with aggregates`

### Task 9: Preferences, positions, unread counts, conversation list

**Files:**
- Create: `src/backend/lib/awsemchat/chat/preferences.ex`, `.../position.ex` (+ migrations), `src/backend/lib/awsemchat_web/controllers/conversation_list_controller.ex` (or extend conversations_controller)
- Test: `src/backend/test/awsemchat/conversation_list_test.exs`

**Interfaces:**
- Produces:
  - `Chat.put_preferences(user, conversation_id, %{pinned?, pinOrder, muted?, archived?})`, `Chat.put_position(user, conversation_id, message_id)`.
  - `Chat.list_conversations(user, %{filter: :all | :private | :circles, cursor})` → rows: `{id, type, peerProfile | circleMeta, lastMessage: envelope | null, unreadCount, preferences}`; excludes archived unless requested (`includeArchived`); pinned first ordered by `pinOrder`. Unread = messages from others after `position.last_seen_message_id` (keyset count). Last message delivered as full envelope; client renders preview (keeps payload opacity).
- [ ] **Step 1: Failing tests**: `test_pinned_sorts_first_archived_hidden`, `test_unread_count_increases_and_position_clears`, `test_conversation_list_contains_no_foreign_read_state` (peer's position absent from payload; Review Focus 5)
- [ ] **Step 2–5**: verify fail, implement, pass, commit `feat(backend): preferences, positions, conversation list`

### Task 10: Shared media listing

**Files:**
- Modify: `src/backend/lib/awsemchat/chat.ex` (or `media.ex`) with `Chat.list_shared_media(user, conversation_id, cursor)` — from `message_media` joined to messages, excluding sticker-kind, newest-first
- Test: `src/backend/test/awsemchat/shared_media_test.exs`

**Interfaces:**
- Produces: `GET /api/v1/conversations/:id/media?cursor=` → `{items: [{mediaId, messageId, mime, width, height, createdAt}], nextCursor}`; `Media.authorized?` now uses `record_reference` data for non-owner access (wired in Task 4).
- [ ] **Step 1: Failing tests**: `test_shared_media_excludes_stickers`, `test_shared_media_requires_membership`
- [ ] **Step 2–5**: verify fail, implement, pass, commit `feat(backend): shared media listing`

### Task 11: Seeds and auto-reply bots

**Files:**
- Create: `src/backend/lib/awsemchat/bots.ex` (GenServer), `src/backend/priv/repo/seed.exs`, `src/backend/lib/mix/tasks/awsemchat.seed.ex` (prints bot phones/PINs)
- Test: `src/backend/test/awsemchat/bots_test.exs`

**Interfaces:**
- Produces:
  - Seed creates 3 bot users with phones `0811110001..3`, stable PINs (`BOTPIN1..3` padded to 6), display names and statuses matching the sample-data cast (Naya, Raka, Sari).
  - `Bots` GenServer under app supervision; subscribes to `user:<bot_id>` PubSub topics; on `"message:new"` from a human in a private conversation with the bot: auto-accepts any pending friend request from that human, records delivered ack, replies after `Process.send_after(self(), ..., 800..2000ms)` with `Chat.send_message(bot, ...)` — canned line list with echo fallback (`"You said: " <> text`), `clientOpId` generated server-side. Bot replies go through the identical `send_message` + broadcast path.
- [ ] **Step 1: Failing tests**: `test_bot_autoaccepts_request`, `test_bot_replies_to_private_message` (delay injected to 0 in test config), `test_bots_do_not_reply_in_circles`
- [ ] **Step 2–5**: verify fail, implement, pass, commit `feat(backend): seeds and auto-reply bots`

### Task 12: Error-code audit, CORS, run docs, curl smoke script

**Files:**
- Modify: `src/backend/lib/awsemchat_web/router.ex` (cors_plug for `http://localhost:8081` and LAN dev origins), every controller to route through `Errors.render/1`
- Create: `src/backend/lib/awsemchat_web/errors.ex` (single table of codes), `src/backend/README.md` (run: compose up, ecto setup, seed, phx.server; emulator URLs `10.0.2.2:4000`), `src/backend/scripts/smoke.sh` (curl: request_code→verify→me→request friend by seed PIN→send message→list)
- Test: `src/backend/test/awsemchat_web/errors_test.exs` — every code atom renders expected snake_case code; unknown controller errors map to `internal_error` without leaking exception data.

- [ ] **Step 1: Failing tests** for error rendering, **Step 2: verify fail**, **Step 3: implement Errors + CORS**, **Step 4: `mix test` pass; run `bash scripts/smoke.sh` against a running dev server and paste output**, **Step 5: commit** `feat(backend): error-code table, CORS, run docs, smoke script`

### Task 13: Full-suite gate and ledger update

- [ ] **Step 1:** Run `cd src/backend && mix test` → 0 failures; `mix format --check-formatted` → clean.
- [ ] **Step 2:** Start stack (`docker compose up -d`, `mix ecto.reset`, `mix run priv/repo/seed.exs`, `mix phx.server`) and run `scripts/smoke.sh`; record real output.
- [ ] **Step 3:** Append dated entry to `docs/technical/implementation-ledger.md` describing what is now real and what remains (E2E, push, backups, PING, Now Playing, report workflow) per the design doc §9.
- [ ] **Step 4: Commit** `docs: ledger entry for Phoenix backend stage`

---

## Out of plan (explicitly)

Mobile wiring (Plan 2) consumes this API and its event contract; it is a separate plan per the design doc §8. E2E encryption, push notifications, backups, PING/PONG, Now Playing, report workflow, Supabase media: design doc §9.
