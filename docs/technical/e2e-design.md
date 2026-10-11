# E2E production foundation

Date: 2026-10-10. Status: **PROPOSED; native security gate BLOCKED**. This is an integration contract for review, not an implemented or audited protocol. The approved [UI handoff](ui-backend-handoff.md) controls presentation; the MVP privacy rules remain binding. No dependent production communication slice may claim this gate passed.

## Evidence and protocol choice

| Candidate | Official capability/license evidence | Fit and remaining work |
| --- | --- | --- |
| [libsignal](https://github.com/signalapp/libsignal) | AGPL-3.0; Java/Android and Swift wrappers; external usage unsupported; Android build documentation requires JDK21 | Established private-session implementation. Circle recipient fanout is application work. Hermes needs a native wrapper, not the Node addon. License acceptance and binding/API maintenance remain decisions. |
| [vodozemac](https://github.com/matrix-org/vodozemac) 0.11.1 | Apache-2.0; Rust Olm/Megolm implementation; upstream reports an audit | Existing locked host probes run against this version. An experimental Expo Android Kotlin/JNI adapter and synthetic emulator probe now exist; no iOS adapter is present. Upstream audit does not cover this app or binding. |
| [OpenMLS](https://github.com/openmls/openmls) / [RFC9420](https://www.rfc-editor.org/rfc/rfc9420.html) | MIT; standardized membership epochs; Android/iOS targets built but explicitly untested in upstream CI | Better group lifecycle abstraction, but native wrapper, persistence, authentication service and restricted historical-content handling remain application work. No local OpenMLS probe run. |

**Candidate decision:** prototype vodozemac Olm pairwise sessions with explicit per-event recipient fanout for private chats and Circles (at most 19 other active phones). This avoids distributing a reusable Circle history key to new members. Use the same encrypted event path for Moments, reactions, replies, PING/PONG, profile/status and Now Playing. Megolm probes only demonstrate primitive behavior; Megolm is not selected for the initial production adapter. Performance, security review and native integration must validate this choice before adoption. OpenMLS is the concrete fallback if maintaining authenticated pairwise group fanout becomes unacceptable; libsignal remains an alternative subject to license/support approval.

Olm session success proves possession of the supplied identity keys, not that those keys belong to the intended person. **Approved 2026-10-10:** accepted friends may chat without manual safety-code verification; QR/safety-code comparison remains optional. First contact uses trust-on-first-use and persistent identity pinning. This does not protect unverified first contact against active server key substitution. Preserve pinned identity history; an identity change resets verification and produces a clear warning. Sending stops until the changed identity is acknowledged. Never silently re-encrypt pending messages for changed keys. The bounded Android durable foundation now persists TOFU pins, optional verification, acknowledged changes, ratchets and exact outbox bytes together; see [native transaction contract](../../validation/e2e/android/durable-state.md). The bounded [signed prekey foundation](../../validation/e2e/android/signed-prekeys.md) now validates pinned signatures, native publication retry, consumption and replenishment. Authenticated server key allocation/directory, production identity and history integration still require validation.

## Trust boundaries and metadata

Clients alone hold plaintext and decryption keys. The Go relay, PostgreSQL, Supabase and push provider never receive message/quote/caption/status/reaction/media plaintext. Android Keystore protects local secret wrapping; SQLCipher protects persisted history, with encrypted media cache and explicit exclusion from OS plaintext backup. A compromised unlocked phone or authorized recipient can retain/share content; revocation cannot erase downloaded copies.

Server-visible control data: account/device IDs and current device generation, phone number at verification boundary, contact PIN mapping, friendship/block state, Circle membership/roles/invite states and revisions, conversation/event IDs, sender/recipient IDs, server sequence, operation ID, timestamps, ciphertext byte lengths, object IDs/size, delivery acknowledgements, IP/network logs and push tokens. The relay learns the recipient graph and timing. Third-party OTP sees phone verification; Google sees backup account/object sizes/timing; storage sees ciphertext and traffic; music permission sees session metadata; GIF search sees only the user's provider query. No presence, typing, last-seen or read events exist. Clear notification text is generic (no sender/content preview); background fetch retrieves ciphertext subject to current authorization.

## Proposed envelope version 1

This is a semantic schema, not a frozen deployed wire format. Opaque IDs are stable across rename, pagination and retry. The server authorizes every transport request, including upload grants, realtime and acknowledgement. PING/PONG carries a routing authorization kind (server-visible metadata), repeated inside the protected payload. The server rejects either kind unless the conversation is private and friendship is currently accepted, including retries; the receiving client also rejects mismatched kind and any PING/PONG in a Circle. A malicious client labeling encrypted PING as ordinary content does not bypass recipient enforcement. PONG requires explicit user action and never counts as a read receipt.

```json
{
  "version": 1,
  "eventId": "opaque-client-generated-id",
  "clientOperationId": "opaque-idempotency-id",
  "conversationId": "opaque-id",
  "senderDeviceId": "opaque-id",
  "senderDeviceGeneration": 7,
  "membershipRevision": 12,
  "audienceId": "immutable-event-audience-id",
  "recipients": [
    {"deviceId": "opaque-id", "generation": 4, "sessionId": "opaque-id", "olmType": 1, "ciphertext": "base64"}
  ]
}
```

Each pairwise plaintext contains a canonical versioned protected header repeating event/conversation/sender/generation/revision/audience IDs, the complete original audience hash, content kind and payload. On decrypt compare protected values with outer routing values and local trusted identity/session. Reject mismatch, unknown versions, excessive sizes, invalid signatures/identity changes and duplicate event IDs before applying mutations. Server receipt and membership authorization remain independent of decryption. Server sequence is transport ordering, never a substitute for authenticated sender content. A sender identity signature over the canonical header/payload is proposed for transferable source provenance (promotion); exact serialization/signature API and domain separation require review/native probe. Do not invent cryptographic calls in TypeScript.

Payload kinds include text, media, sticker, GIF, Moment, reaction, reply, deletion, delivery and profile update. Target IDs, emoji, quote snapshots and media keys are encrypted. Routing may expose target identifiers only where required for authorization; such exposure must be listed in the versioned API contract. A media descriptor inside the encrypted payload carries algorithm/version, random media ID, ciphertext object IDs, ciphertext digest, key/nonce, MIME/dimensions, encrypted thumbnail descriptor and size. Use a reviewed native AEAD implementation with fresh random keys/nonces; authenticate descriptor/object association and reject modified bytes before displaying. Algorithm selection and streaming/chunk limits are pending native evidence.

## Audience and key lifecycle

- Private send requires accepted friendship at server acceptance and current device generations. Unfriend/block closes future private communication and key distribution. Historical downloaded content remains local.
- Circle create includes creator; invitation acceptance commits capacity and membership revision transactionally. Circle maximum is 20. Invites do not grant content access. Every accepted join, leave, removal or replacement increments revision; outbox send under a stale revision fails closed and requires explicit audience reconciliation before re-encryption. Never silently add new recipients on retry.
- Every event records immutable original account audience and device generation at acceptance. Clients encrypt only to the authorized device snapshot. A join/rejoin has a new membership interval: no historical event/key backfill from before join or during absence. Exclude removed members from all future event/key envelopes even if a cached pairwise session still exists.
- Sender-only promotion: server verifies source author, target conversation and immutable original audience; new Moment audience is original eligible audience intersected with currently authorized recipients. Never rewrap the old source key to a newcomer. Owner receives an encrypted self archival copy. Source provenance and immutable audience are included in protected content; server metadata checks alone cannot prove plaintext provenance.
- Reply to restricted Moment/message can send a quote/media/key only to recipients who can access the target. For a mixed Circle, propose restricted reply audience; UI must label it. If that presentation is not approved, block send with a safe explanation until an approved fallback exists. No automatic whole-Circle plaintext quote or replacement thumbnail.
- Reactions/deletions share their target's restricted audience. Fetch pages, search, shared media, thumbnails, push, receipts and realtime enforce the same eligibility. An inaccessible event must not leak via counts/previews.
- Current status for older Circle senders resolves a separate current authorized encrypted profile snapshot; old bubble payload is not a status archive. Nonfriend Circle status visibility remains an owner decision. Music is accepted-friends only, expires and is absent from Circle bubbles.

## Media transport and revocation boundary

**Proposed required transport:** the Go service proxies ciphertext downloads (including thumbnails and ranged/resumed reads) from the private Supabase bucket. Clients receive opaque proxy URLs/grant IDs, never direct Supabase signed download URLs. Every proxy request checks current session/device generation, immutable event audience, current membership eligibility and tombstone state. A cached grant never substitutes for those checks. Disable shared/CDN response caching; the proxy alone holds Storage credentials and uses server-side upstream access. It does not decrypt media.

Serialize revocation and admission checks against authoritative current state; cancel active proxy streams when that state changes and recheck authorization before admitting subsequent chunks/ranges. Define the delivery boundary as bytes already admitted before revocation: those may be in flight and cannot be recalled, just as downloaded copies cannot. After the revocation commit, no new read/range/chunk admission is permitted. Implementers must demonstrate this synchronization and cancellation behavior; an ordinary one-time authorization check at stream start is insufficient for this contract.

Direct signed URLs are bearer capabilities that remain usable until expiry; app token or membership revocation does not revoke an already issued Storage URL. They cannot satisfy immediate access revocation, and shortening TTL is not an equivalent. If a deployment exposes such a URL, fail this gate and remediate the transport before claiming immediate revocation. The proxy proposal and its stream semantics remain unverified until implementation/device tests.

## One active phone and restore

Replacement verification serializes a new device generation and revokes prior tokens, push delivery, sockets, proxy upload/download grant authority and send authority at the authorization boundary above. No direct client Storage signed download URL is issued. Stale proxy grants are rejected on every new read/range/chunk admission; already admitted bytes and downloaded copies cannot be recalled. New phone creates fresh identity/session material; contacts get an identity-change warning. Old phone never stays authorized by possessing old keys. Already downloaded history cannot be revoked cryptographically.

Restore first authenticates account, then separately unlocks backup using recovery material. Import only archival receive/history/media material, never old bearer tokens, active sender ratchets, pending network sends, push/OAuth secrets, invitations or current membership authority. Refresh friendship/membership/revocation state online before sending; old backup does not resurrect removed membership or identity keys. Quarantine imported messages as local history; preserve their original audience and membership interval. Review whether imported historical sender signing keys are necessary; default exclude them and retain verified source records.

## Delivery and idempotency

Proposed states: local queued/sending → server accepted (sent) → each original intended device durably stores and validates ciphertext (delivered). A device receipt is an authenticated event, independent of reading. Circle delivery aggregates the immutable original intended recipients. Removed/unreachable recipient becomes terminal unavailable rather than delivered; never shrink the denominator and invent success. UI wording for partial delivery is an owner decision. Deduplicate by sender generation + operation ID and preserve server result for retry. Duplicate receipt does not advance twice. Restored old phone cannot acknowledge current-generation delivery.

## Product decisions requiring owner confirmation

Rows marked approved record user decisions. Other rows remain proposals requiring decisions before the affected slices.

| Topic | Concrete proposal | Consequence / pending choice |
| --- | --- | --- |
| PIN | Random nonsequential 8-character human-readable code, exclude ambiguous characters; explicit rotate, invalidate old lookup immediately, preserve existing friendship | Format, lookup rate limits and rotation UX need approval; PIN never authenticates or unlocks backup |
| Reassigned number | Approved 2026-10-11: SMS alone restores account access; replacement revokes the previous phone and creates fresh live keys. Historical backup still requires its separate recovery key. | This policy accepts reassigned-number account/social-identity takeover risk; SMS does not decrypt old history. Do not require old-phone approval or an account recovery factor. |
| Admin succession | Last admin must nominate an accepted current member before leaving; deletion/disappearance handled by explicit recovery policy | Deterministic automatic successor versus mandatory transfer needs approval |
| Rejoin | Fresh membership interval, no content from absence, prior locally held history retained | Privacy rule derives from spec; retention presentation needs confirmation |
| Deletion | Author sends tombstone; remove server ciphertext/object access and local quote snapshots when received; no recall of exported/downloaded copies | Decide tombstone text, offline retention, backup deletion policy and whether historic quotes are retained |
| Nonfriend status | Separate Circle-only encrypted current text-status snapshot to current members, revoke on leave; music remains friends-only | Owner must approve Circle status audience; fallback omit status for nonfriends rather than leak friend-only snapshot |
| Removed receipt | Terminal unavailable; show partial delivery rather than Delivered | Owner chooses wording/expiry; never infer read |
| Recovery | Generate random recovery key; confirmation/save check; optional password wrapping only after reviewed on-device KDF tuning; no server recovery of history | Choose password option, archive retention/media scope/limits and loss UX |
| Preferences | Device-local encrypted persistence, included in encrypted backup; archive remains archived on incoming message | Confirm archive behavior and replacement-phone preference policy |

## Completion evidence

Host Rust tests in `validation/e2e` validate Olm private exchange/outsider rejection, Megolm join/removal primitives and ciphertext tamper rejection. They do not test account-key authentication, native bindings, replay persistence, media AEAD, SQLCipher, backup restore or server authorization. See [native gate](../../validation/e2e/README.md), [backup gate](../../validation/backup/README.md), [media gate](../../validation/media/README.md). The experimental Android bridge passed a synthetic API33 ARM64 emulator probe; see [bridge evidence](../../validation/e2e/android/README.md). The subsequent [durable foundation probe](../../validation/e2e/android/durable-state.md) validates native sealed-state transactions and recovery, persistent TOFU and key-change blocking on the emulator. Server identity/audience authorization, production history integration and production adoption remain unvalidated.
