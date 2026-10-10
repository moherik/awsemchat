# Approved UI baseline and backend handoff

Date: 2026-10-10
Status: UI approved by the product owner; production integration remains outstanding.

This document records the final UI decisions and the data needed to support them. Read it alongside the [MVP specification](../superpowers/specs/2026-10-10-awsemchat-mvp-design.md), [implementation ledger](implementation-ledger.md), and [GIF integration notes](giphy-setup.md). For presentation, this document supersedes earlier UI proposals and intermediate screenshots. The MVP specification still governs privacy, encryption, audience restrictions, and account security. A working demo control does not prove a production service exists.

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

“Removed” describes UI entry points, not deletion of existing user content. Custom emoji remains in the product scope, but its removed sample editor has no approved production replacement yet.

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
| GIF favorite | provider and providerGifId, title, asset reference/URL and dimensions, favorite ordering/time if persisted | Favorites and search/send preview |
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
| GIF picker | Client-side GIPHY requests; local favorite list | Favorite/unfavorite, select preview, send encrypted attachment descriptor/content; no chat/account data in provider search |
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
7. Latest profile status is resolved for other Circle senders, even for older messages. Own Circle bubbles omit sender/status. Nonfriend Circle-member status visibility still needs a policy.
8. Now Playing is opt-in, for accepted friends, and excluded from Circle bubbles. User chose to explore Android music-app integration rather than rely on Spotify public API eligibility; automatic integration is not implemented.
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
| GIF favorites and chat preferences are session data | Decide device-local persistence vs encrypted account sync/backup; pin ordering/limits; whether incoming messages remain archived |
| GIPHY web verified; platform keys configured separately | Validate native keys, provider requirements/attribution and launch eligibility; define encrypted GIF delivery/caching so remote URLs do not become permanent media IDs |
| Now Playing shows a sample song when enabled | Android permission/provider feasibility, authorized sharing updates, stale/stopped clearing, privacy controls |
| Custom emoji sample editor removed | Approve actual creation/management UI and versioned assets/reaction model before delivery |
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
