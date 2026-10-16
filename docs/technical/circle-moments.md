# Circle Moments client contract

Updated 2026-10-14. This describes the first production client slice, not a complete Moments feature or a backend service contract.

## Current behavior

The Circle chat screen has separate Chat and Moments tabs. Members can post text Moments or choose a photo with a caption. Photos are resized and converted locally, encrypted before upload, then published as an ordinary end-to-end encrypted Circle message through the existing account-bound sender and current Circle epoch. The sender fixes the intended recipients using the normal Circle message context. A later member does not receive old inbox events, so they cannot see Moments posted before joining. The relay does not receive the caption or media descriptor in plaintext. The photo renders only after an authorized member downloads and decrypts it on device.

Before a Circle photo is sent to Chat or Moments, the local editor supports a freeform crop, horizontal flip, 90-degree rotation, Original/Mono/Warm/Cool/Vivid filters, and a caption. The edited image is kept on device and encrypted before upload. Prepared image bytes are bounded by the encrypted-media 2 MiB plaintext limit.

The encrypted Moment body is UTF-8 JSON with this shape:

```json
{
  "version": 1,
  "type": "circle-moment",
  "id": "<stable operation id>",
  "caption": "<up to 280 characters>",
  "media": {
    "epoch": 3,
    "media": {
      "version": 1,
      "id": "<opaque media id>",
      "key": "<64 lowercase hex characters>",
      "size": 12345,
      "mimeType": "image/jpeg"
    }
  }
}
```


Circle photo Chat bodies use a separate strict shape and share the same encrypted-media descriptor format:

```json
{
  "version": 1,
  "type": "circle-photo-message",
  "id": "<stable operation id>",
  "caption": "<up to 280 characters>",
  "image": { "epoch": 3, "media": "<encrypted media descriptor>" }
}
```

The photo is encrypted before upload. The client binds its operation and caption to the protected upload intent and sends the body through the normal Circle sender with the captured epoch. The server fixes original recipients and rejects a stale epoch; retry keeps the same operation and body. Long-press promotion creates a new Moment event for the same current audience and reuses the encrypted media descriptor.

Moment reactions are also ordinary encrypted messages, kept out of the Chat projection:

```json
{
  "version": 1,
  "type": "circle-moment-reaction",
  "id": "<stable operation id>",
  "momentId": "<Moment id>",
  "emoji": "❤️",
  "active": true
}
```

The client accepts the MVP reaction set `❤️`, `😂`, `😮`, `😢`, `👍`, and `🎉`. A sender's latest active reaction replaces their prior choice; an inactive event removes it. Counts are projected only from the Moment's Circle epoch. A reaction can be sent only if the Moment is present in accepted local history and its audience matches the current Circle epoch, so it cannot introduce an old Moment reference to new members.

Replying to a Moment switches to Chat and places the reply in the regular message composer. Sending creates an ordinary encrypted Circle Chat message whose strict body contains the reply text and an embedded Moment preview. The preview contains the caption and, when present, the same encrypted media descriptor; the image is decrypted only by an authorized member on device. Tapping the preview switches to Moments and scrolls to the original card. Replies are allowed only when the Moment is present in accepted local history and belongs to the current Circle audience epoch. The reply body is bounded to 32 KiB and reply text to 8,000 characters.

An author can delete their own Moment while it remains in the current Circle audience epoch. Deletion is a small encrypted tombstone event referencing the Moment ID. The timeline applies it only when it comes from the same sender and epoch as the original post; forged references from another member or another epoch are ignored. The event is excluded from Chat bubbles. This removes the post from the timeline on devices that receive the event; encrypted history and remote media cleanup are separate retention work.

An author can long-press an accepted own text or photo Chat message to copy it into Moments. The publisher looks up the original outgoing operation, requires its accepted delivery event and exact current Circle audience, and creates a new Moment. For a photo it reuses the encrypted media descriptor; the media key stays inside the encrypted event and the Moment is restricted to the same membership epoch. Sticker, reply, Moment-control, stale-audience and over-280-character messages are rejected. A Circle photo Chat message is itself an encrypted body containing its caption and epoch-bound media descriptor; the composer previews a locally selected image before sending, and the message view decrypts the image on device. Its upload intent binds caption and operation in protected local recovery state, so an uncertain send can retry the exact same photo message.

```json
{
  "version": 1,
  "type": "circle-moment-reply",
  "id": "<stable operation id>",
  "text": "See you there",
  "moment": {
    "id": "<original Moment id>",
    "audience": "circle:3",
    "caption": "<Moment caption>",
    "media": "<optional encrypted media descriptor from the Moment>"
  }
}
```

`media` is optional; descriptor validation uses the existing encrypted-media limits. The whole JSON body is bounded to 4096 bytes. A queued Moment retains its original operation ID, body, and epoch for exact retry; a second post is blocked while that Moment remains pending. For photo posts, the encrypted upload vault binds the caption and operation ID to the locally encrypted photo before network upload. Lost upload or send replies resume the same intent; a Circle epoch change blocks publishing an unfinished photo to a different audience. The timeline reads accepted local encrypted history for one immutable Circle ID and `circle:<epoch>` audience, deduplicates the outgoing-history copy, and preserves delivery state. Chat projection filters Moment control bodies so they do not appear as ordinary text bubbles. Tapping a full-size Moment or Chat photo opens the shared full-screen viewer with its caption and a device-save action; compact Moment reply previews remain inline.

## Current gaps

Private-chat Moments are absent; a separate [private Moments contract](private-moments.md) and [TDD implementation plan](../superpowers/plans/2026-10-14-private-chat-moments.md) define the remaining work, including private media authorization. Circle author names are currently resolved to the member PIN when a current recipient key match exists, otherwise to “Circle member”; displaying each member's personal name/status in Circle Moments and bubbles needs a defined, audience-safe personal-profile publication contract. Member-wide custom Moments link navigation is limited to embedded reply previews. Encrypted-history retention and automatic cleanup for abandoned, never-cancelled objects remain separate work. Emulator interaction and very large-image acceptance remain unverified. The backend's recipient acknowledgments and fixed-recipient rules remain authoritative; this client slice does not implement a Moment-specific relay endpoint or authorization layer.

No Supabase project is configured. Media publication must use the existing local encrypted-media integration until a provider is selected and configured. Do not store plaintext Moment content or media keys in server metadata, expand an existing message's audience when promoting it, or make an inaccessible Moment's content/preview/key visible in a reply.

## Verification boundary

Focused mobile tests cover codec bounds and strict fields, Circle/audience timeline isolation, encrypted photo upload ordering, protected caption/operation recovery, exact uncertain-send retry, reaction aggregation/toggling, author-only deletion, text/photo promotion eligibility, stale epoch/account rejection, exclusion of Moment controls from Chat bubbles, typed Moment reply/photo projection, and edited-photo data URI validation. Operation-bound cancellation and retry cleanup is now covered by [the encrypted media contract](encrypted-media.md). The full mobile suite (481 tests), TypeScript, Expo lint, and staged/unstaged whitespace checks pass. No emulator or provider workflow was run. These checks do not establish emulator screen acceptance, provider-backed media upload, server-side Moment-specific authorization, two-device visual behavior, retention of encrypted history, cleanup of never-cancelled orphan objects, or the remaining product requirements above.
