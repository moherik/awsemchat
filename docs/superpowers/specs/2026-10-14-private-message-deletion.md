# Private and Circle message deletion design

## Goal

Let a person remove one or more messages they sent in a one-to-one private chat or Circle from every original participant’s AwsemChat history. The deletion must survive synchronization, replacement phones, and restoration of an older encrypted backup. Messages remain encrypted end to end; the server never needs their contents.

## User-approved behavior

- A person may delete only messages they authored. They can select one or more of their own chat messages and choose **Delete for everyone**.
- In a private chat, deletion applies to both participants; in a Circle, it applies to the author and every account in the event’s original fixed recipient set. It applies to every AwsemChat phone currently or later used by those accounts.
- A recipient phone that is offline learns of the deletion after reconnecting. The app synchronizes deletions before exposing restored history.
- Restoring a backup requires an internet connection so the app can check the deletion records before importing or displaying messages. If that check fails, restore fails without changing local history.
- An encrypted backup file created before deletion may still contain the old ciphertext/plaintext archive payload. AwsemChat filters that content during every later restore. Copies exported from AwsemChat or captured outside it cannot be recalled.
- A phone offline at the time of deletion can continue showing its already-saved copy until it reconnects. This feature cannot erase screenshots, copied text, or files already saved outside AwsemChat.
- Only the message author can delete a message for everyone. Circle admins cannot delete another member’s messages through this feature.
- Standalone Moments retain their existing author-delete control. A Moment reply that appears as a Chat message follows the Chat message deletion rule.

## Current behavior and constraints

The relay stores an opaque `message_events` row plus fixed-generation `message_deliveries`. For a Circle event, those delivery rows define the original recipient set; later Circle membership changes do not rewrite it. The sender receives the server event ID and stores it in the local outgoing receipt. The native incoming history currently stores the sender operation, conversation, audience, sender keys, and plaintext, but not the server event ID. Encrypted history backups preserve that native record. Therefore deletion cannot rely only on a server event ID being present in every existing local or backup record.

Private Moment deletion currently sends an encrypted control message and hides the Moment in the local projection. It does not erase the Moment’s saved history or make an older backup reconcile deletions. Standard Chat messages have no delete flow.

## Product behavior

Long-pressing a private-chat or Circle Chat message authored by the current account offers **Delete for everyone**. The action is unavailable on messages authored by someone else. Confirmation states the message will be removed for the original participants. Selecting multiple own messages applies the operation to each selected message; partial failure is reported per message and successful deletions remain complete. Standalone Moment controls retain their existing author-delete behavior; a Moment reply shown as a Chat message follows this deletion rule.

After a deletion is accepted by the server, the sender’s local timeline no longer shows the message. The recipient’s timeline removes it during redaction synchronization. Deleted-message control records are never rendered as ordinary Chat bubbles. No read receipt is added. Existing delivery receipts remain historical transport acknowledgements and do not restore message visibility. A sender sees a terminal redacted status for the deleted event; deleted content is never returned.

When deletion is pending because the network is unavailable, the sender may hide the selected row locally as pending, but retains its encrypted deletion operation durably for exact retry. It must not report global deletion as complete until the server confirms the redaction. A definitive server rejection restores the row and reports the failure. An unknown response is retried with the same operation and target; it must not create a second deletion or guess whether the first committed.

## Server authority and privacy

PostgreSQL stores a durable redaction ledger keyed by the original server event ID. It binds the event to its sender account, original conversation and audience, and commit time. A private event is visible in the feed only to its two original accounts. A Circle event is visible only to the author and accounts in that event’s original fixed delivery set. A later Circle member cannot enumerate or learn about earlier events through redactions. The ledger contains no message text, media bytes, encryption keys, or plaintext metadata. Account-level access lets a replacement phone for an original participant reconcile history after SMS account recovery.

The relay validates that the authenticated actor owns the target event and that it is a supported private or Circle Chat message. It rejects events authored by another account, non-message control events, unknown events, and events outside the account’s permitted original audience. For a Circle event, authorization is based on its immutable server event and original delivery rows, not current membership; the author can delete after leaving, while no later member gains access to the redaction. New records can be targeted by server event ID. An outgoing message restored from an older archive can be targeted by the full legacy descriptor (conversation, original audience, operation ID, and both sender public identities); the server resolves it only within the authenticated sender account and rejects ambiguous matches. Retries for the same target are idempotent. A different account or a newly joined Circle member cannot enumerate redactions.

The redaction commit is authoritative: in the same transaction, the relay removes the original opaque envelope and all original recipient ciphertext from active message storage, marks the event redacted, and records the minimal account-visible redaction entries for the sender and each original recipient. It retains only the event’s non-content idempotency digest and routing identity needed to reject resend and authorize redaction sync. It retains empty, valid JSON placeholders plus delivery sequence rows so existing inbox cursors and historical acknowledgement receipts remain stable, but never returns deleted payloads. Sender status reports the terminal redacted state, and an exact send retry cannot recreate the ciphertext. The relay does not return the original event or its ciphertext through inbox paths. New access to media attached to that event is denied where the media service can bind access to the event operation; Circle media follows the same rule. Existing downloads or externally saved copies cannot be revoked. The server keeps the minimal redaction records for as long as old backups can be restored; otherwise a prior archive could resurrect the message.

When a deletion notice can be encrypted and routed to the exact original participants, the normal message path carries a versioned control event containing the target’s stable identity but no original content. Circle notices must never be sent to a current, expanded Circle audience; they are limited to original recipients. A control event is only a best-effort end-to-end encrypted notification. The server ledger remains authoritative when a participant is offline, has replaced their phone, or left the Circle. Synchronization therefore works even when a notice cannot be decrypted or delivered to an old generation.

The server already knows event IDs, sender, fixed recipient accounts, conversation, and delivery time to relay messages. The ledger adds the fact that an event was deleted and when. It does not let the server inspect message contents.

## Stable identity and legacy history

New native history records and encrypted archive payloads retain the server event ID after send/receive confirmation. The client uses it for direct matching with a redaction. The deletion feed also includes a strict legacy matching descriptor derived from existing relay fields: conversation ID, exact friendship or Circle audience, sender operation ID, and sender public identity pair. This allows older encrypted archives—whose local records contain operation, conversation, audience, and sender keys but no server event ID—to be filtered without matching on message contents.

The native parser validates every identifier and key field in the descriptor. A descriptor that matches multiple local records is treated as an integrity conflict: restore or redaction application fails closed rather than deleting an ambiguous message. A descriptor that matches no local record is an idempotent no-op. New records must agree on both event ID and legacy descriptor when both are available.

## Synchronization and local storage

Redactions use a separate paginated cursor from the message inbox cursor. The first sync on a replacement phone starts at the beginning of the account-visible redaction ledger. Each page removes the matching message and advances the cursor in one commit to the native sealed durable state, which owns live history, outgoing records, archival history, and transport cursor state. The separate SQLCipher database stores personal stickers and is not a message-history source. A crash before commit replays the page safely. Account or session replacement cancels the old operation and prevents writes into the new account namespace.

For each redaction, clients remove matching incoming history, outgoing sent history, and archival history. They remove pending message display data and prevent future media loads. Circle redaction does not change the original fixed recipient set, historical delivery receipts, leave/rejoin behavior, or the rule that a newly joined member cannot read older Circle history. The encrypted deletion control event remains available only as control metadata needed for durable retry/validation and is not presented as a message. Outgoing drafts that never committed as server events cannot be targeted by a global redaction; deleting an unsent draft remains a separate local discard operation.

The message timeline must not publish a restored or newly synchronized snapshot until all redaction pages needed for that account have been applied. If synchronization is unavailable, the UI reports that history is waiting to reconcile and keeps restored content hidden until the check succeeds. An already-open offline phone may display its existing cached history until connectivity returns, as stated above.

## Backup and restore

New encrypted history archives include stable server event IDs for committed chat messages and preserve legacy matching fields. Archive creation excludes messages already redacted locally and excludes pending-delete content from the ordinary history projection. Pending deletion operations remain in a separate protected retry record, not as visible message history.

Restore authenticates and validates the entire archive first, fetches every applicable server redaction page, filters redacted messages, then imports the resulting history and sticker data. A failed online lookup, invalid descriptor, or account change must occur before either component is imported. Message history and the personal-sticker library use separate encrypted stores, so each component commits atomically in its own store and retries are idempotent; a successful history import followed by a sticker-store failure may leave a partial restore that can safely be retried. Older archives without event IDs are filtered using the validated legacy descriptor. A restore that cannot contact the redaction service fails before native history is changed.

The redaction cursor is transport state, not archive data. Restoring on another phone starts a fresh redaction scan. Re-importing an old archive after a prior restore still filters every redaction before merge, so removed records cannot return through exact-record archive deduplication.

## Failure handling and invariants

- Only the authenticated author account can redact its event, including after that account replaces its phone or leaves a Circle.
- The original recipient set is immutable for both private and Circle events. Redaction does not add recipients, include later Circle members, or grant access to an unrelated/new friendship.
- Redaction is idempotent; lost responses and retries do not create duplicate ledger entries or control messages.
- No message is physically removed from the sender’s only recoverable local operation state until the server confirms redaction. The pending delete survives process restart and retries the exact target.
- Once server redaction commits, each original recipient’s history and every future AwsemChat restore remove the target before showing the affected history.
- Redaction page application and cursor advancement are atomic with the native encrypted message-history mutation.
- Account changes, generation changes, malformed ledger entries, ambiguous legacy matches, and out-of-order pages fail closed without cross-account deletion or message resurrection.
- Deletion never creates a read receipt and never changes fixed-recipient Circle delivery semantics.

## Verification requirements

Test-first implementation must prove:

- The API permits the sender to delete their own private or Circle Chat event by event ID or a unique legacy descriptor, and rejects another sender’s event, non-message control events, an outsider, a newly joined Circle member, an ambiguous descriptor, and a recipient mismatch.
- Concurrent and repeated deletion requests produce one stable redaction; a lost response can be retried safely.
- Inbox pages and media access no longer expose a redacted event after commit, while unrelated events and recipients remain unaffected.
- Current, old-generation, and replacement-phone sessions for each original private/Circle participant reconcile only that account’s redactions; later Circle members receive no earlier redaction entries.
- Redaction sync removes incoming, outgoing, and archived history and is safe to replay after crashes; its cursor never advances before the local deletion commits.
- New archives preserve event identity. Legacy archives match by the strict descriptor, reject ambiguous descriptors, and never restore a redacted record.
- Restore fails without changing the active database when the online redaction check fails or the account changes during the check.
- Pending deletion retries exact target/operation across process restart; confirmed deletion removes local plaintext, while a definitive rejection restores it.
- Message text, media bytes, encryption keys, and plaintext are absent from redaction rows, logs, errors, and API responses.
- Circle leave/rejoin, fixed original-recipient delivery, delivery receipts, existing Moment deletion, archive authentication, and sticker restoration regressions remain green.

## Rollout

Deploy the additive database migration and redaction API before enabling the Chat control. Existing message rows remain readable. The API provides a legacy descriptor so pre-upgrade archives can be filtered. Enable private-chat and Circle Chat controls only when the client can apply redactions before exposing history and restore. Do not expire redaction rows while a corresponding old message archive remains restorable.

## Open scope boundary

This spec does not revoke copies saved outside AwsemChat or guarantee physical removal of remote media bytes where the media provider cannot delete an object. Redacted media must be inaccessible through AwsemChat; provider-level garbage collection remains a separate operational concern.
