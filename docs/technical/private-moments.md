# Private chat Moments contract

Status: approved and implemented; visual device acceptance and production storage remain open.

## Product behavior

Each accepted one-to-one conversation has Chat and Moments tabs. A Moment is visible only to the two accounts in that accepted friendship audience. Circle Moments remain isolated in their Circle conversation and epoch. The standard authenticated message context and end-to-end encryption carry every post and interaction; the relay never receives Moment text, captions, sticker content, or media keys in plaintext.

Members can post text or a photo with a caption, react to a Moment, reply from the Moments tab, and delete their own Moment. A reply is an ordinary Chat message with an encrypted Moment preview; selecting the preview returns to the source Moment. Only the original sender can promote their own accepted Chat text or photo into Moments. Promotion creates a separate encrypted Moment event for the same private friendship audience and never broadens the source message's audience. Moment controls never render as Chat bubbles.

## Audience and history rules

The active private message context supplies the conversation ID and `friend:<accepted-request-id>` audience. The sender fixes the normal current recipient set when preparing each immutable message operation. Every private-Moment selection, reaction, reply, deletion, and promotion verifies both the conversation and audience against locally accepted history before sending. New friendship requests have distinct audience IDs; events from an earlier friendship audience are read-only and cannot be reacted to, replied to, promoted, or deleted through that new audience. No Circle identifier, epoch, membership, or recipient set is added to a private Moment body.

The backend authorizes private media against the active accepted friendship and the audience captured at upload. The encrypted descriptor is included only inside an end-to-end encrypted message. An operation cancellation creates a durable fence, blocks later PUTs, preserves media when the message event committed, and queues only that operation's unused ciphertext for deletion. A delete Moment event hides the Moment in projections; it does not erase already delivered encrypted history or promise revocation of media already fetched by a recipient.

Implementation checkpoint: private Chat and Moments now support encrypted text/photo messages and Moments, reactions, Moment replies in Chat, author deletion, and sender-only promotion of eligible Chat text or photo. Private photo uploads use a device-protected retry vault bound to the active peer and friendship audience; retries preserve the exact media ciphertext and operation. Backend private conversation IDs are validated as `private:` followed by the 64-character lowercase hexadecimal conversation hash. Six screen-render/interaction tests cover tabs and composer, text posting, photo preview/send/retry/discard, reactions, delete confirmation, Moment replies and navigation back to the source, and keeping Moment controls out of Chat bubbles. The owner selected a retention policy of keeping encrypted history until the user deletes it; automatic expiry is not desired. Chat message deletion now propagates through the server redaction ledger and restore filtering; standalone Moment deletion remains its separate encrypted event behavior. Android device acceptance and Supabase deployment remain open.

The Chat tab's long-press delete action is available only on messages authored by the current account, including Moment replies because they are ordinary Chat messages. It applies to private and Circle chats; Circle administrators cannot delete another author's message. The server captures the original recipient accounts at message commit. Late Circle members cannot see earlier redaction entries, while original offline recipients remove the message on reconnect. Restoring an older backup requires a successful online redaction check before import; if the service is unavailable or the response is invalid/ambiguous, restore stops without importing messages or stickers. New backup archives omit messages whose deletion is still pending server confirmation.

## Event and media contract

Use strict, versioned `private-moment`, `private-moment-reaction`, `private-moment-deletion`, and `private-moment-reply` JSON bodies. Each control event's `id` equals its immutable message operation ID. Text/caption and encoded-body bounds match the Circle Moment contract: 280 Unicode scalar values for captions, 8,000 characters for reply text, 32 KiB for a reply body, and 4 KiB for a standalone post. Reaction choices are `❤️`, `😂`, `😮`, `😢`, `👍`, and `🎉`; each account's latest active reaction per Moment wins. Strict parsers reject unknown fields and malformed Unicode.

Photo bytes are normalized and size-bounded on device, encrypted before upload, and retained in the protected upload vault with the exact operation, caption, audience, and ciphertext for retry. The private media API stores opaque ciphertext and binds each object to the sender account/generation, operation, conversation, and fixed `friend:<request-id>` audience. Both parties in that active friendship may download the descriptor's object. Other accounts, another friendship audience, and blocked/non-friends are denied. The existing Circle media path remains Circle-only. Cancellation and cleanup use the operation-bound media invariants in [encrypted media](encrypted-media.md).

## Projection and recovery

Moment timelines derive solely from accepted encrypted incoming/outgoing history for one conversation and audience, deduplicate the outgoing copy, and order by authenticated local sequence with creation time only as a legacy fallback. Conflicting IDs or same-operation payloads fail closed. Reactions are aggregated by sender and event ordering. A deletion applies only when its encrypted sender is the original Moment author in the same friendship audience. Replies include the source ID, audience, caption, and optional encrypted media descriptor; they are sent only while that source Moment remains present and accessible in the current conversation history.

Queued posts and media keep their original operation, payload, recipients, audience, and ciphertext across retries. Account/session replacement clears the rendered projection and suppresses late UI effects. Media may be discarded only through server-confirmed operation cancellation; committed operations keep their event and media. Circle Moment promotion/reply/reaction authorization remains unchanged.

## Verification requirements

- Strict codecs and history projections isolate private Moments from Circles and from other private conversations/audiences.
- Sender tests prove exact fixed-recipient retries and reject changed friendship audience, stale or absent Moment IDs, non-author deletion/promotion, and account replacement.
- Private media API/PostgreSQL tests prove accepted-friend grants, denial outside the captured audience, exact operation binding, cancellation-vs-commit ordering, read denial after friendship revocation, and durable cleanup retry.
- Photo tests prove encryption precedes upload, protected draft recovery keeps exact ciphertext and operation, and failed/cancelled uploads never create a Moment.
- Expo Jest UI tests cover Chat/Moments tabs, text posting, photo preview/send/retry/discard, reactions, delete confirmation, reply in Chat with embedded Moment preview/navigation, empty state, and ensuring controls are not Chat bubbles. Loading/error projections and device presentation still require native acceptance.
- Run mobile tests, TypeScript, Expo lint, Go PostgreSQL race tests, `go vet`, Rust tests if native archive or crypto code changes, and whitespace checks. Provider, emulator, and multiple-physical-device acceptance remain separate release gates.

