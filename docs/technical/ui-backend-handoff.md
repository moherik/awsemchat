# Approved UI baseline and backend handoff

Date: 2026-10-10
Status: UI approved by the product owner; production integration remains outstanding.

Native history pagination checkpoint (2026-10-16): Android chat now requests older events through authenticated `GET /v1/messages/history?conversation=…&audience=…&cursor=…&limit=…`. The server returns only opaque ciphertext and routing/crypto metadata for the active account generation, scopes cursors to that same conversation/audience, checks current private friendship or exact Circle membership interval, excludes redactions, and leaves delivery receipts unchanged. Pages are received by Android through native E2E decryption after redaction sync; the UI shows “Load earlier messages” while the relay has more. This does not restore data for a replaced device; encrypted backup remains the recovery path. The API contract is documented in [history pagination](../superpowers/specs/2026-10-16-native-history-pagination.md). Go and client behavior tests pass; PostgreSQL-backed history assertions are unverified because `AWSEM_TEST_DATABASE_URL` is unset, and emulator acceptance remains skipped.

Android account/settings checkpoint (2026-10-15): the native You tab now reads the authenticated account PIN and latest end-to-end encrypted profile; edit routes into the production profile publisher. Native Settings links only to production flows for profile, friends/requests, Circles, saved Circle updates, archived chats, personal sticker storage, and encrypted backup/restore. The browser remains a demo. Android's settings list should add a feature only after its device/backend behavior exists; do not route Android users into the demo fallback in `flows.tsx`.

Android shared-media checkpoint (2026-10-15): the chat header opens a native gallery backed by the active conversation's local encrypted history. It lists chat photos, GIF messages, and photo Moments, decrypts through private or Circle media adapters, retains Circle key epochs, and reuses the full-screen caption/download viewer. GIFs use the existing photo-message envelope with `image/gif` media MIME; no dedicated backend message schema is needed. The current gallery only indexes media already present in local history; it has no server pagination. The browser Shared media remains on sample data.

Android appearance checkpoint (2026-10-15): Appearance in native Settings controls system/light/dark themes and persists the selection in Android SecureStore. The setting is device-local and requires no backend field or API; the Android palette listens to the persisted value. The browser retains its independent demo theme preference.

Native chat-list production checkpoint (2026-10-15): the Android/iOS Chats tab now reads accepted friends and active Circles from the authenticated paginated controllers and decrypts previews locally from accepted history. Private rows are keyed to the current friendship request audience; Circle previews and profile names are limited to the viewer’s current `joinedEpoch` and later. Current Circle profile name/avatar are sourced from the latest accepted encrypted profile. The current API and encrypted-history contract supply all server data needed; the client derives rows and does not need plaintext message previews or unread/read-receipt fields from the Go service. Pin, mute and archive are local account/device/generation-scoped preferences in SQLCipher, included in local and Drive encrypted archives; no preferences endpoint is needed. Chats hide archived rows; Settings lists them and supports open/unarchive. The list never invents unread counts. Web remains the separately labeled demo. See the [current implementation status](project-status.md) and [chat-list implementation plan](../superpowers/plans/2026-10-15-native-chat-list.md).

Native New conversation checkpoint (2026-10-15): the Android/iOS picker uses the existing accepted-friends endpoint and pagination, searches actual PINs, routes the Circle shortcut to Circle creation, and routes a selected accepted friend to the live private chat. No new backend endpoint is needed. Current friend DTOs contain no private profile avatar or text status, so the screen displays a neutral rounded avatar and PIN. To show a person’s selected display name/status/photo here, implement account-bound encrypted private profile distribution and accepted-friend profile delivery first; do not put private profile values in public friendship DTOs. The web picker remains a demo. See the [native picker implementation status](project-status.md) and [plan](../superpowers/plans/2026-10-15-native-new-conversation.md).

Circle avatar production checkpoint (2026-10-12): encrypted profile version1 now accepts null or `{epoch,media:{version:1,id,key,size,mimeType}}`. The backend continues to receive only encrypted profile events and opaque ciphertext objects; never expose image keys/names/descriptions in public Circle DTOs. Native selection/removal/retry and list/header/details display are connected. New membership audiences receive a fresh encrypted object/descriptor, leaving old grants fixed. Upload intent retains original profile revision and clears only after accepted matching later profile content. Full325 mobile tests/static checks and live local ciphertext-copy authorization checks pass; native screen/provider/separate-device acceptance and stale-operation retirement remain open. See [profile contract](circle-profiles.md) and [current status](project-status.md).

This document records the final UI decisions and the data needed to support them. Read it alongside the [MVP specification](../superpowers/specs/2026-10-10-awsemchat-mvp-design.md), [implementation ledger](implementation-ledger.md), and [GIF integration notes](giphy-setup.md). For presentation, this document supersedes earlier UI proposals and intermediate screenshots. The MVP specification still governs privacy, encryption, audience restrictions, and account security. A working demo control does not prove a production service exists.

Native shared-media history continuation (2026-10-16): when the Android gallery reaches the end of media already present in local encrypted history, “Load earlier shared media” fetches the next authorized history page through the session-bound relay paginator, synchronizes redactions, imports ciphertext through native decryption, then projects newly available photo, GIF, and Moment thumbnails. Existing local media entries remain cached during paging; failed pages expose a retry action. No new endpoint or plaintext media index is introduced. The browser gallery remains demo-backed. PostgreSQL integration and device acceptance remain unverified.

## 1. Added, changed, and removed

| Area | Added or changed in the approved UI | Removed or superseded |
| --- | --- | --- |
| Overall design | Classic BBM influence, modern blue accent, light/dark/system themes, compact rows, rounded-square photo/initial avatars throughout | Single-screen prototype; circular avatars are not the selected shape |
| Navigation | Chats, Friends, You; All/Private/Circles chat filters; separate Chat/Moments tabs per conversation | Global/public Moments feed |
| Chat list | Long-press row actions: pin/unpin, mute/unmute, archive; pinned chats sort first; pin and mute indicators; full-width rows | Visible three-dot button on each chat row; archived chats in the main list |
| Archive | You → Settings & profile → Archived chats; open archived conversation and unarchive | Main-tab archive entry |
| Private-chat header | Name with a single combined status/music line; overflow scrolls with pauses; reduced motion uses static truncation | Separate wrapped status and song rows |
| Message actions | Incoming bubbles retain side reply/react controls; own-message menu contains Reply, React/remove reaction, Save to Moments, and Retry when failed; tighter own-message receipt spacing | Side reply/react buttons on own bubbles |
| Replies | Private and Circle message replies; composer quote draft, cancel, explicit send; sent quote opens/highlights target | Plain unlinked reply text as the intended production model |
| Media composer | Photo picker/camera; before-send editor with draggable rectangular crop, flip, rotate, reset, filters, caption | Immediate photo send without preview |
| Media viewer | Fullscreen chat/Moment/shared-media image preview, caption, top download action | Noninteractive placeholder thumbnails |
| Shared media | Actual photos/GIFs from that conversation, thumbnail grid, count, empty state, fullscreen viewer | Coffee/flower/cake sample tiles and prototype explanatory copy |
| Moments creation | Post entry at the top of the list opens Create Moment; text draft, optional photo, explicit Post | Bottom chat-like composer; separate oversized Add photo Moment / Share Moment buttons |
| Moments interactions | Reactions stay on the Moment; Reply switches to Chat with a quoted Moment draft; quote links back to original; shared popup actions | Reply that immediately sends a chat; inline Delete Moment footer action; inline overflow action rows |
| Friends | Compact list with chat-list side padding; name search; accepted-friend selection shows rounded-square avatar, status, PIN | Spacious name-only rows |
| Friend requests | Request identity/avatar and compact Accept/Decline controls; empty state after handling requests | Prototype name/“Sample request” and oversized controls |
| New conversation | Create a Circle row with group icon; accepted-friend avatar/status/PIN; search by name or PIN | Name-only selection list |
| Circle creation | Accepted-friend checkbox rows with avatar/PIN and 20-person count | View Circle members link before creation |
| Circle chat | Other senders show name and latest status; own messages omit You/status; no song in Circle bubbles | Own-message sender/status label; song in Circle bubbles |
| Circle details | Editable name, description, avatar; compact members/roles; member removal menu; leave Circle; single Invite friends entry | Cluttered Circle members page and inline list of every possible invitee |
| Circle invitations | Separate searchable accepted-friend checkbox page, batch selection, remaining capacity | One Invite [name] row per accepted friend inside details |
| Circle stickers | Details opens Manage Group stickers directly; personal/group picker tabs, contribution, admin removal, save personal copy | Intermediate Circle stickers & emoji page and its sample emoji form |
| Sticker maker | Photo source; freely adjustable rectangular crop; on-device background removal adapter; multiple draggable/deletable text boxes; save composition | Fixed crop presets as sole crop interaction; single fixed text box; crop pretending to remove background; standalone finished-sticker upload |
| Sticker management | Personal library/packs, recent stickers, Circle collection, contribution/removal, independent personal copies | Small static sample-only picker |
| GIFs | GIPHY trending/search, loading/error/retry/pagination; category pills Trending/Favorites/Happy/Love/Laugh/Wow/Sad; star to favorite; corrected grid padding | Three fixed sample GIFs |
| Feedback | Shared dismissible snackbar, progress/result/error feedback, sheet-aware hosting; bottom offset only where needed | Inline event messages such as Crop applied / Opening your photos |
| Popup menus | Shared web/native component, viewport positioning, outside dismissal and keyboard behavior on web; chat-row long press | Ad hoc inline popup action layouts |

“Removed” describes UI entry points, not deletion of existing user content. Custom Circle emoji are deferred beyond the MVP; standard emoji remain available for reactions. Do not build a custom-emoji editor, picker, or message/reaction path for this release.

## 2. Data delivery principles

These are integration requirements, not an already deployed API schema. Backend and mobile engineers should agree transport and versioning before implementing endpoints.

- Use stable opaque IDs for users, conversations, memberships, requests, messages, Moments, media, stickers, packs, and emoji. Display names, PINs, array positions, and URLs are not primary keys.
- Use UTC timestamps and explicit states; the UI formats time locally. Never deliver preformatted demo times as authoritative data.
- Return cursor-paginated collections for chats, accepted friends, requests, messages, Moments, shared media, and sticker collections. Search must work beyond the first loaded page.
- Support loading, empty, offline, permission-denied, and retryable failure states. Include machine-readable error codes without exposing private content.
- Mutation acknowledgement and realtime updates must reconcile by stable ID. Retried sends/creates need a client operation ID to prevent duplicates.
- Do not copy the demo store wholesale into a server DTO. The Go service routes encrypted envelopes and authorized metadata. Decrypted message bodies, quotes, captions, Moment content, and media bytes belong on the client under the chosen E2E protocol.
- VPS PostgreSQL stores authorized metadata/envelopes; Supabase stores encrypted media objects. Storage URLs alone are insufficient: the receiving client needs authenticated media descriptors and securely distributed decryption material.
- No typing, presence, last-seen, or remote read-receipt events. Unread counts and local read position must not become sender-visible read receipts.

## 3. Required client-facing models

Field names below illustrate semantics; they are not frozen JSON wire names. Private payload fields may be carried inside encrypted content rather than plaintext API responses.

| Model | Required information | UI use |
| --- | --- | --- |
| User/profile | userId, displayName, contact PIN, avatar descriptor or null, current text status; optional authorized Now Playing payload | Friends, requests, new conversation, header, other Circle senders |
| Friendship/request | requestId, sender/recipient IDs, incoming/outgoing direction, pending/accepted/declined/cancelled state, creation time | Accept/decline, outgoing state, permission to chat |
| Conversation | conversationId, private/circle type, peer or Circle ID, display metadata, latest accessible message reference/time, unread count/local position | Chat rows, filtering, previews, navigation |
| Own conversation preferences | conversationId, pinned flag and ordering, muted flag, archived flag; separate PING mute preference | Sorting, indicators, long-press actions, archive list |
| Circle | circleId/conversationId, name, description, avatar descriptor, active member count, viewer role/capabilities | Header, editable details, membership count |
| Membership/invitation | membershipId, circleId, userId, role, joined/left boundaries; invitationId, inviter, invitee, state, expiry if supported | Member rows, invites, removal, leave, history eligibility |
| Message | messageId, conversationId, senderId, creation time, content kind, encrypted text/media/sticker payload, optional reply target, delivery state | Bubble ownership, preview, receipts, reply and retry |
| Reply | target type message/Moment, stable targetId, authorized quote snapshot, target availability/deletion state | Composer embed, sent quote, original navigation |
| Moment | momentId, conversationId, authorId, creation time, encrypted text/caption and optional media/sticker descriptor, optional sourceMessageId, audience eligibility, deletion state | Post list, author-only delete/promotion, reply navigation |
| Reaction | target type/id, actorId, emoji identifier, aggregate counts and viewer selection derived from accessible events | Message toggle and Moment reactions |
| Media | mediaId, type/MIME, width/height, optional duration, byte size, encrypted object/thumbnail references, integrity metadata, associated message/Moment ID and caption in encrypted payload | Thumbnail grid, preview, save, failed download handling |
| Sticker | stickerId, owner/contributorId, packId, optional circleId, rendered asset descriptor, editable composition when retained, removal state/capabilities | Send, edit, save copy, Circle management |
| GIF favorite | Local favorite GIPHY ID and title; fetch current rendition URLs directly from GIPHY when needed | Favorites category; no application backend record |
| Settings/backup | theme, notification preferences, music opt-in state, backup schedule/destination/status, last successful backup time | You/settings flows |

Current demo sticker composition includes source image, crop/background state and positioned text layers. Production must define a versioned composition schema and render/export format; sent stickers must preserve the appearance even if their source composition is edited later.

## 4. Operations and updates expected by screen

| Screen/flow | Reads | Mutations and update expectations |
| --- | --- | --- |
| Identity/PIN | Own profile/PIN and verification state | Phone verify/login, device replacement/revocation; PIN lookup/request; do not expose phone numbers |
| Friends/requests | Paginated accepted friends, searchable name/PIN, pending requests, outgoing states | Send/cancel/accept/decline; update both request list and accepted friends; unfriend/block/report subject to privacy rules |
| Chat list | Accessible conversations and own preferences; latest accessible content locally decrypted | Pin/unpin, mute/unmute, archive/unarchive; immediate local update with reconciliation on failure |
| Archived chats | Only archived conversations belonging to viewer | Open without automatically unarchiving; explicit unarchive returns it to main list |
| Chat | Ordered paginated encrypted messages, delivery events, sender profiles, reactions | Idempotent send/retry, reply send, reaction add/remove; incoming message/delivery/reaction updates |
| Moments | Accessible Moment pages, media descriptors, reaction events | Create, author delete, sender-only promote chat content, reaction add/remove; replies use ordinary chat send after user confirmation |
| Circle details | Circle metadata, paginated members/roles, effective permissions | Update name/description/avatar, invite, remove, leave; propagate metadata/member changes without changing conversation identity |
| Invite friends | Searchable accepted friends minus existing members; capacity and pending invitations | Batch invitation with per-person results; enforce capacity transactionally; joining follows accepted invitation |
| Shared media | Authorized conversation photos/GIFs, newest/history pages, thumbnail descriptors | Download/decrypt/save locally; exclude stickers from current photo/GIF grid |
| Sticker library/Circle | Personal packs/stickers, recent use, accessible Circle collection and capabilities | Create/edit personal sticker, contribute, save independent personal copy, admin remove; never recall saved personal copies |
| GIF picker | Client-side GIPHY requests; SQLite favorite IDs/titles | Favorite/unfavorite, select preview, send an encrypted `image/gif` photo-message; no chat/account data in provider search |
| Profile/settings | Own profile/settings; authorized friend profile updates | Update avatar/status/settings; backup/restore and music integration require real implementations |

Delivery means device receipt, not server acceptance or reading. Circle delivery must track the original intended recipients, including an explicit policy for removed/unreachable recipients. The UI must render sending/sent/delivered/failed from real state, not the demo's hardcoded Delivered label.

Chat mute and PING mute are separate settings. Production notification generation must respect both as applicable. Muting does not remove unread counts or history. Whether preferences sync to a replacement phone or remain device-local must be decided and documented.

## 5. Privacy and access rules that affect payloads

1. Accepted friendship is required for private communication. PINs identify contacts; they are not login credentials.
2. Circles have at most 20 active participants including creator. Invitations require acceptance in production; the demo currently adds selected friends immediately and labels invitations simulated.
3. New members cannot read pre-join messages or Moments. Removing/leaving stops future key/content access; downloaded copies cannot be recalled.
4. Promoting an old message does not expand its audience. A Moment reply must not leak its quote, thumbnail, key, or reply content to members without access to the target.
5. Author-only Moment deletion and original-sender-only promotion must be enforced, not inferred from a client menu.
6. Circle sticker contributions are member actions; removal is an admin action. Return effective capabilities and enforce them server-side.
7. Latest profile status is resolved for other Circle senders, even for older messages. Own Circle bubbles omit sender/status. Every current Circle member can see a current encrypted name/status snapshot, including members who are not accepted friends; a membership change requires a fresh snapshot for the new epoch.
8. Now Playing is opt-in, for accepted friends, and excluded from Circle bubbles. User approved Android notification access with a clear system-permission warning and a separate sharing opt-in; metadata must be read from active media sessions only, never notification text.
9. Photo editing and background removal keep source photos local. Upload only intended encrypted output. Native background removal quality/permissions still require device validation.
10. Backups must be encrypted and authenticated. Phone verification cannot decrypt old history; restore requires recovery material and must not reinstate revoked sessions/memberships.

## 6. Production gaps and decisions still required

| Current demo behavior or unresolved area | Required production work/decision |
| --- | --- |
| In-memory useDemo store; reload resets changes | SQLite persistence, migrations, encrypted local storage/key management, network reconciliation/offline queue |
| Message/Moment replies use array indexes; asset keys include indexes | Stable IDs, tombstones, fetching unloaded targets; deleted/inaccessible quote rules including retained snapshots |
| Sticker collections keyed by Circle name; rename migrates demo keys | Collections keyed by immutable circleId; rename changes metadata only |
| Demo friends/PIN arrays and seeded avatars | Real profile records keyed by userId; null avatar fallbacks; eliminate index-dependent PIN mapping |
| Placeholder message times, sender “Mum”, Delivered labels and local unread clearing | Real sender/timestamp/delivery data, local unread semantics, intended-recipient delivery aggregation |
| Circle admin inferred from first member; controls not permission-complete | Explicit roles/capabilities, admin succession/last-admin leave, concurrent capacity checks, invitation acceptance, rejoin boundaries |
| Moment list is demo array order; some seeded counts are synthetic | Agree list order and cursors, real reaction aggregation/viewer state, deletion sync/offline behavior |
| GIF favorites | Native favorites persist GIPHY IDs and titles in local SQLite and reload current media URLs from GIPHY; no backend favorite record is required. Chat pin/mute/archive are device-local, included in encrypted backups, and incoming messages leave archived chats only when the owner explicitly unarchives them. |
| GIPHY API client is wired to native chat and encrypted media uses `image/gif`; local tests cover API parsing, bounds, favorites, preview and send handoff | Verify native keys and live provider access, obtain production API access/approved attribution artwork, and perform Android device acceptance. Never persist GIPHY URLs or cache provider media. |
| Now Playing shows a sample song when enabled | Implement the approved Android notification-access plus separate share-consent flow; publish only active media-session metadata to accepted friends and clear/expire stale state |
| Android reports were previously unavailable | Native report flow now sends only reporter-selected text excerpts/details through authenticated `POST /v1/reports`; server verifies friendship/event access, rejects redactions and expires records after 90 days. Add moderation access/audit controls and abuse-rate limits before public launch |
| Custom Circle emoji | Deferred beyond MVP; standard emoji reactions remain supported |
| Google Drive/local backup screens simulate snapshot restore | Real encrypted archive format, media/key inclusion, schedule limitations, Drive integration and safe restore validation |
| Native downloads/background removal/menu/gesture experience not device-verified | Development build on Android, permission/error tests, slow-device checks; later iOS checks |
| Phone auth, E2E, notification delivery and backend transport not connected | Choose/audit protocol integration, verification service, session revocation, encrypted media pipeline and notification payload policy |

Do not treat UI approval as closure of these engineering decisions. Resolve them before claiming production readiness; keep the approved visual layout unless a security or capability constraint requires a reviewed change.

## 7. Integration acceptance checklist

- [ ] Backend IDs remain stable through Circle rename, member change, pagination and offline reconciliation.
- [ ] Every friend row has correct avatar/name/status/PIN; request decisions update friendship state accurately.
- [ ] Pinned ordering, mute indicators and archive/unarchive survive the selected persistence policy; archived conversations remain openable from settings only.
- [ ] Sending/retry does not duplicate messages; receipts reflect actual device delivery and never expose reading.
- [ ] Chat and Moment replies remain drafts until Send; links locate originals outside the currently loaded page and handle unavailable targets.
- [ ] Edited pixels/caption arrive correctly; preview/shared media use real authorized assets; failed media downloads have retry feedback.
- [ ] Circle invitations, admin edits/removals and leave enforce role/capacity/history boundaries under concurrency.
- [ ] Moment promotion/reply cannot expand the original content audience; deletion propagates consistently.
- [ ] Sticker sends/copies are independent of later edits/removal; Circle permissions are enforced.
- [ ] All failures/loading/empty states use the approved UI patterns and snackbars; no private data reaches GIF search, logs or notification previews outside encryption policy.
- [ ] Native Android integration and encrypted backup/restore are tested on a real device before release.

## 8. Source map and visual evidence

Current UI owners: `apps/mobile/src/features/chat-app.tsx` (chat/list/Moments/Friends/You), `flows.tsx` (details/settings/invitations/shared media), `demo-store.ts` and `sample-data.ts` (demo models), `media-sheet.tsx`, `gif-picker.tsx`, `photos/`, `stickers/`, `feedback/`, `popup-menu*`, and `scrolling-status.tsx`.

Useful current examples: [chat row spacing](chat-row-spacing.png), [own-message menu](own-message-menu.png), [Moments post entry](moment-post-entry.png), [Moment reply draft](moment-reply-draft.png), [photo editor](photo-editor.png), [fullscreen viewer](photo-viewer.png), [Circle details](circle-details.png), [Circle invitation selection](circle-invite-friends.png), [sticker text layers](sticker-text-layers.png), and [live GIPHY search](giphy-live-search.png). Screenshots capture particular iterations; use the change table and current code for later amendments. In particular, old `moment-composer.png` and screenshots with own-message side buttons are superseded.
# Circle production integration checkpoint (2026-10-12)

Native Circle controls now consume authenticated real membership data and fixed PINs, with current accepted encrypted name/description profiles. Invitation selection uses paginated accepted friends with PIN search/checkmarks and excludes existing members; invitation acknowledgment does not add membership before recipient acceptance. Admin-only remove/handoff and leave/sole-member closure use explicit confirmation and immutable operation/epoch/actor-target interval guards. Saved operations survive interrupted replies in device-protected storage. Cancellation is server-fenced or returns the original committed result; it never pretends to undo a completed change.

The membership-operation DTO/HTTP contract and evidence are in [circle-membership.md](circle-membership.md). The current API implementation includes migrations1–14; the existing local8088 process was not migrated during the 2026-10-14 verification. Foreground admin maintenance sends fresh current-epoch encrypted profile events to joined members, without granting old chat/Moment history. Circle avatar, collection, sticker, Moment, and photo client paths are implemented against the local controlled media service. Current migration and two-account client/API integration evidence is in [circle-collections.md](circle-collections.md); media operation ownership/cancellation and durable cleanup are specified in [encrypted-media.md](encrypted-media.md). Personal sticker backup/restore, private-chat Moments, configured-provider acceptance and native/device acceptance remain open. Existing web/demo fields are not production data sources. Current automated evidence:481 mobile tests,56 Rust tests, TypeScript, Expo lint, full PostgreSQL Go race tests, vet and whitespace checks pass. Emulator and Supabase acceptance remain unverified; see [current project status](project-status.md).
