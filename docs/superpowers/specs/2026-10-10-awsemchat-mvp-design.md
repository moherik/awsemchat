# AwsemChat MVP specification

Date: 2026-10-10
Status: MVP product specification; UI baseline approved on 2026-10-10. Production integration remains outstanding.

Backend amendment (2026-10-16): the architecture table in section 13 now names Elixir/Phoenix instead of Go, and the E2E protocol is selected as vodozemac (Olm/Megolm). See the [Phoenix chat backend plan](../plans/2026-10-16-phoenix-chat-backend.md) for the decision record. Product scope, privacy, and security requirements below are unchanged.

UI amendments and backend data requirements: [Approved UI baseline and backend handoff](../../technical/ui-backend-handoff.md). This addendum supersedes earlier presentation proposals; privacy/security requirements below still apply.

## 1. Purpose and success

AwsemChat is a public mobile app for personal communication with friends and family. Anyone can register, but communication happens in accepted friendships and invitation-only Circles. It provides a relaxed space away from work, with classic BlackBerry-era BBM character and modern usability.

The MVP succeeds when real users can register, connect by PIN, reliably exchange encrypted messages, save and revisit private Moments, express themselves with stickers and reactions, and recover their history on a replacement phone. No adoption or performance figures are assumed.

## 2. Scope and delivery order

Android first, using Expo and React Native with future iOS support in mind. One active phone per account. All three delivery stages below belong to the intended MVP; they are sequencing, not scope reductions.

1. Private communication: phone verification, PIN friend requests, encrypted private chats, Circles, delivery receipts, encrypted backup and restore.
2. Memories and expression: Moments, replies into Chat, reactions, GIFs, Circle emoji, sticker editor and collections, PING/PONG.
3. Music: automatic Spotify Now Playing, subject to provider and mobile feasibility validation.

Voice/video calls, public feeds, public groups, online/last-seen indicators, typing indicators, read receipts, and multiple active devices are outside the MVP. Drawing tools and a standalone sticker-upload workflow are also excluded.

## 3. Identity and friendships

- Registration and login use phone-number verification. Phone numbers are not exposed to other users.
- Each account has a shareable contact PIN. This is a contact identifier, not an authentication or backup secret.
- Adding a PIN sends a friend request. Messages and PINGs are unavailable until the recipient accepts.
- Friends can unfriend, block, and report. Blocking stops private messages, PINGs, and new invitations.
- A replacement-phone login revokes the previous phone's server session. Revocation prevents future server access; it cannot erase content already downloaded on that phone.
- PIN format, rotation policy, verification provider, account-deletion flow, and protection against phone-number reassignment require resolution before implementing identity.

## 4. Navigation

Main tabs:

| Tab | Contents |
| --- | --- |
| Chats | Conversation list with All, Private, and Circles filter pills; All selected initially |
| Friends | Accepted friends, incoming requests, add by PIN |
| You | Profile, status, Spotify connection, personal stickers, backup/restore, settings |

Every private conversation and Circle has Chat and Moments tabs. Moments has no global feed. Circle details contain members, invitations, shared stickers/emoji, admin controls, and notification settings.

Private-chat profiles show text status and Now Playing. Circle messages show the sender's name and latest profile text status below it, including on older messages. Circle message bubbles do not show Now Playing.

## 5. Messaging and delivery

Supported content: text, photos, GIFs, stickers, message replies, and emoji reactions. The MVP does not implicitly include voice notes, video attachments, or documents.

Message states: sending, sent, delivered, failed. Failed sends offer retry. Engineering must prevent duplicate messages when retrying or reconnecting.

Delivery is recipient-device receipt, not server acceptance or reading. In a Circle, delivered means all intended recipients received it. The intended audience is determined at send time; membership changes must not silently redefine the receipt. Handling recipients removed before delivery must be explicit before implementation and must not falsely mark delivery complete.

No read receipts, typing indicators, online indicators, or last-seen timestamps. Reading content must not emit a read event to other users. Local unread state is permitted without revealing it to senders.

## 6. Circles

- Private groups named Circles, capped at 20 participants including the creator.
- Admins invite their accepted friends; invitees accept before joining.
- New members cannot access messages or Moments from before they joined.
- Circle members may add shared custom emoji and stickers; admins may remove them from the shared collection.
- Blocking another member does not automatically remove either person from a shared Circle. A user can leave or ask an admin to remove someone.
- Removal/leave must stop access to future content. It cannot revoke copies already received.
- Admin succession, the last admin leaving, invitation capacity races, and rejoining rules must be defined before implementing membership. Rejoining must not grant access to content from an absence by accident.

## 7. Moments

Moments is a lasting shared album within a private conversation or Circle. Content remains until its author deletes it; it does not expire after 24 hours.

Two creation paths:

1. Publish directly in that conversation's Moments tab.
2. Select your own existing chat message or photo and choose Add to Moments.

Only the original sender can promote chat content. Promotion stays in the same conversation and preserves the original audience. A newly joined member must not gain access to an older message because it was later promoted. Current membership restrictions still apply to new distribution.

Replies to Moments appear in Chat with an embedded image/content preview. Tapping the preview opens the original Moment. Emoji reactions live directly on the Moment; there is no separate comment thread in Moments.

Privacy applies to the whole reply, including quoted content, thumbnails, media keys, notifications, and navigation. If a member cannot access a Moment, they cannot receive its reply preview or associated reply content. This can create audience-restricted messages within a Circle.

Proposed presentation: chronological Moments with a subtle new-content indicator, no view counts or seen-by lists. This follows the agreed relaxed direction; exact layout remains a design detail.

Deletion requires a defined behavior for linked chat previews and offline clients before implementation. It must not promise removal of screenshots, exported files, or existing independent backups.

## 8. Stickers, GIFs, and emoji

Stickers are created in a small in-app editor with photo crop, background removal, and text. No drawing tools. A source photo is chosen for editing rather than uploaded as a finished sticker.

Users can save received stickers into their personal collection and reuse them in other conversations. Saving is an explicit copy action; removing a Circle sticker from its shared picker cannot recall personal copies already saved.

The Circle sticker picker has Group stickers and Personal stickers tabs. Every Circle member can contribute shared stickers, managed through Circle details; admins can remove them. Each Circle has its own custom emoji collection for messages and reactions, with member contributions and admin removal.

Private chats use personal stickers and standard emoji. Cross-Circle custom-emoji reuse is not implied.

Background removal should be evaluated on-device to avoid exposing source photos to an external service. GIF provider, content limits, supported sticker/emoji formats, collection limits, and asset-deletion behavior need technical decisions. GIF search must not transmit private conversation content.

## 9. PING/PONG

Private chats only. PING is an attention-grabbing alert with an optional PONG reply. Per-chat settings can mute these alerts. Proposed sound/vibration respects system silent mode and Do Not Disturb, with a short cooldown to prevent repeated alerts. Exact cooldown and foreground animation remain implementation design decisions.

PONG is never automatic and is not a read receipt. No PING/PONG in Circles.

## 10. Profiles and Now Playing

Profiles include a text status. Circle bubbles resolve the latest status rather than a historical snapshot.

Now Playing updates automatically from a connected music app, starting with Spotify. It is visible to all accepted friends and displayed below the profile alongside status in private chats. It is absent from Circle message bubbles.

Proposed privacy behavior: explicit opt-in when connecting, a pause-sharing control, and clearing stale playback information. These controls should not create online/last-seen indicators.

Provider access, public-release eligibility, allowed polling, background execution, OAuth permissions, token handling, and stopped/offline playback behavior require validation. Automatic continuous updates are a product requirement, not yet a verified technical capability. Any feasibility conflict must return to the user rather than silently changing to manual sharing.

Circle profile-status access for members who are not mutual friends must be resolved explicitly; Circle membership does not automatically create a friendship or authorize sharing Now Playing.

## 11. Backup and restore

Both Google Drive and local storage are supported using an encrypted backup format.

- Google Drive: manual backup and optional daily or weekly schedules.
- Local: export/import an encrypted file that can be copied to another phone.
- Contents: chats, Moments, media, personal stickers, and Circle collections available to the user, plus the key material necessary to restore the included history securely.
- Restore: verify the account's phone number and unlock the backup with a separate recovery password or key. The friend PIN and SMS code do not decrypt history.
- Current membership controls future access after restoration. Restored history does not reauthorize removed memberships or replay an old active-device session.

Backup is optional. If the phone and recovery secret are lost, account recovery does not imply history recovery. Never store a plaintext recovery secret with the backup. Restore validates authenticity, format compatibility, and account ownership before replacing local data. Partial failures must preserve the previous usable state.

Scheduled jobs are best effort under mobile operating-system limits. Show the last successful backup, progress, failure, and retry. Password-versus-key UX, retention, media inclusion/size limits, and migration policy must be settled during the security design.

## 12. Safety and reporting

Provide block, unfriend, and report actions. Reporting explicitly submits selected decrypted messages or Moments for review, with the user informed of what leaves the encrypted conversation. Unselected content remains private.

Reporting does not imply routine server access to plaintext. Operational review process, retention of submitted reports, and launch policies remain required release work.

## 13. Technical architecture and trust boundaries

| Responsibility | Technology / owner |
| --- | --- |
| Mobile UI and application | Expo + React Native; Android first |
| Local history and offline state | SQLite on the phone, with encryption at rest |
| Backend | Elixir/Phoenix (amended 2026-10-16, was Go) |
| Backend database | PostgreSQL hosted by the user on a VPS |
| Encrypted media objects | Supabase Storage |
| Backup destinations | Google Drive and user-selected local files |

The phone encrypts/decrypts communication. Phoenix authorizes accounts and membership and relays encrypted payloads; it does not hold content-decryption keys. Supabase stores ciphertext, including protected thumbnails. Privileged storage credentials never ship in the mobile app. Downloads require authorization in addition to encryption.

Use an established encryption protocol, not custom cryptographic primitives. Protocol/library selection is vodozemac (Olm/Megolm, amended 2026-10-16); native Android integration, licensing review, group membership, restricted Moments audiences, device replacement, and backup validation remain outstanding. End-to-end encryption alone does not automatically enforce history visibility; membership epochs and key distribution must enforce it.

Protect message bodies, photos, GIF/sticker payloads, Moments, replies, reactions, and PING/PONG content. Profile/status and Now Playing distribution need an explicit audience/key design. Authentication, routing, delivery, and membership metadata are necessary server-visible control data; do not claim that E2E hides every metadata field. Phone verification and third-party music authorization have their own provider trust boundaries.

Proposed backend organization separates domain rules and use cases from HTTP/realtime transport, PostgreSQL access, and storage adapters. Start with a single service rather than assuming microservices. Transport, hosting, notification provider, and exact library/SDK versions are not selected yet.

The local database owns the user's available decrypted history and pending sends. PostgreSQL owns current account authorization, accepted friendships, membership, and delivery bookkeeping. Encrypted event storage supplies offline delivery; its retention is still a technical decision. Supabase owns media bytes, not their plaintext meaning or access keys.

Notifications must not leak restricted Moment previews or plaintext to a push provider. Logging must exclude message plaintext, keys, verification codes, and music access tokens.

## 14. Visual direction

Classic BlackBerry-era BBM feeling, modernized for AwsemChat rather than copied branding.

- Compact conversation rows and separators: make people and conversations easy to scan.
- Prominent avatars and readable status: express personal identity and mood.
- Restrained blue accent: carries the agreed BBM-inspired character and marks selected/action states.
- Familiar chat bubbles: distinguish authors and keep the conversation central.
- Light/dark themes, comfortable touch targets, accessible text sizes: support daily mobile use.
- Filter pills are functional categories explicitly requested by the user; avoid making unrelated controls uniformly pill-shaped.
- Stickers, custom emoji, and personal Moments supply expression; avoid decorative status dots that suggest availability.

Design dials: Energy 2, Rhythm 1, Motion 1. Balanced personality, predictable conversation structure, and brief purposeful interaction feedback. PING may have a short triggered effect; no perpetual motion.

Apply the supplied Anti Slop UI skill and core rules. Exact colors, typography, tokens, and screens must be designed and checked in both themes; this specification is not a validated visual implementation.

## 15. Acceptance scenarios

1. Two users verify their phones, exchange PINs, and cannot communicate until the request is accepted. Neither sees the other's phone number.
2. A message sent offline retries after reconnection without duplication; delivery updates only after recipient-device receipt. Opening it emits no read receipt.
3. A Circle rejects a 21st participant, including concurrent joins. New members cannot decrypt earlier messages or Moments.
4. Only an original sender promotes their message/photo. Later joiners cannot access the resulting Moment or previews/replies about it.
5. A Moment reply appears in Chat; tapping its preview opens that Moment for authorized members. Reactions appear on the Moment.
6. A user crops a photo, removes its background, adds text, and creates a usable sticker. Members contribute Circle stickers/emoji, admins remove them, and received stickers can be saved personally.
7. PING/PONG works only after friendship acceptance and only in private chats. Muted alerts remain quiet; PONG requires an explicit action.
8. Updated text status appears below names in older Circle messages. Now Playing appears in private-chat profiles and never in Circle bubbles.
9. Both Drive and local backups restore included content on a replacement phone. Wrong recovery secrets or corrupted backups fail safely. The previous phone loses future server access.
10. Server/database/storage inspection cannot reveal communication plaintext or content keys. Removed members receive no future keys. Security review validates the chosen protocol and restore path.
11. Blocking stops private contact and invitations. Reporting sends only user-selected content after explicit disclosure.
12. Android device verification covers empty/loading/error states, text scaling, accessibility, both themes, offline transitions, notification settings, and every interactive control.

## 16. Decisions required before their affected implementation

This is an agreed product specification with bounded technical unknowns, not an implementation-ready security design. Resolve these without reopening accepted product choices:

- E2E protocol native integration (vodozemac selected 2026-10-16); group/audience key lifecycle; identity verification and replacement-phone safety.
- OTP, notification, GIF, and background-removal providers or on-device implementations.
- Spotify production access and realistic background-update behavior.
- PIN lifecycle, account deletion/number reassignment, Circle admin succession/rejoin, and delivery edge cases.
- Moment deletion/linked-reply behavior and status visibility for nonfriend Circle members.
- Backup recovery UX, retention, size limits, and failure-safe restore.
- Media limits, offline event retention, API/realtime contracts, and operational deployment.

Next stage after user review: write an implementation plan with technical validation first. Approval of this spec does not itself select an execution method or start product implementation.
