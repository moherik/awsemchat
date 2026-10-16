# Operation-bound media cleanup specification

Date: 2026-10-14
Status: Product design approved; implementation completed and verified locally on 2026-10-14. Supabase and Android/SecureStore acceptance remain unverified.

## Problem

Circle media is uploaded before its encrypted relay event is committed. If a user discards that send, or the app loses the response while resolving whether it committed, ciphertext can remain in private storage without a message or profile that references it. The existing upload API identifies the Circle, object, and epoch, but does not bind an object to the relay operation that will publish it. Storage also has no deletion contract.

Cleanup must preserve the existing end-to-end encryption boundary and fixed message audience. A timeout is not evidence that a message failed: cleanup must arbitrate against relay commit and keep ciphertext whenever the event won.

## User-visible behavior

- A user can discard a pending Circle media operation, including after upload.
- AwsemChat asks the authenticated API to cancel that operation. If the API confirms that no relay event committed, the operation becomes permanently cancelled, its associated media is deleted, and the client may clear its protected pending upload.
- If the event already committed, the API returns the committed result and retains all associated media. The client reconciles the message/profile/collection state and does not report a successful discard.
- If the API cannot establish either result, the client retains the exact protected operation and media and offers retry. It must not clear or replace pending state based on a timeout or generic error.
- Retrying cancellation is idempotent. The same operation cannot later be sent after cancellation, even if the cancellation response was lost.

## Operation and media binding

Every Circle media object is associated at upload time with the authenticated owner, session generation, Circle, epoch, object ID, and the immutable relay operation ID that will publish its descriptor. One operation may own multiple media objects, which is required for collection snapshot parts. An object ID cannot be rebound to another operation, owner, Circle, epoch, or ciphertext.

The client persists the operation ID in its protected upload intent before the first network request, then persists `uploadAttempted=true` before making the first PUT. Exact upload retry reuses the same object ID, ciphertext, and operation. This durable flag distinguishes a job proven never to have reached the API from one whose upload result may have been lost. All media publication paths must provide this binding:

- Chat photos, Moment photos, one-off sticker sends, and shared collection additions use the operation already stored in their intent.
- Circle avatar edits allocate and persist the `circle-profile` event operation before upload; the profile retry must use that same operation.
- Collection refresh assigns each refreshed media object to the `circle-collection-snapshot` part operation that publishes it. A part may reference multiple objects; its operation ID is allocated and persisted before those uploads.

Prepared media with `uploadAttempted=false` is locally discarded without a server deletion call. Once `uploadAttempted=true`, discard uses the operation cancellation endpoint even if the PUT returned an error, since the server may have stored the object before the response was lost.

## API and storage contract

Circle media PUT requires the operation ID in addition to its existing Circle, object ID, and epoch. The backend rejects malformed IDs, inactive sessions, nonmember/incorrect-epoch uploads, and any operation already cancelled. Exact retries remain valid only for the original owner, operation, Circle, epoch, and ciphertext digest.

An authenticated operation-cancel endpoint accepts a Circle and operation ID. Under the same account-generation-operation lock used by message send, it checks for a committed relay event:

1. If the event exists, return `committed` with the event identity and retain all media.
2. If no event exists, persist a cancellation tombstone and durable cleanup work for every media object bound to that owner, generation, Circle, and operation; then return `cancelled` only after the tombstone transaction commits.

The relay send transaction takes the same lock and checks the tombstone before creating an event. This gives one definitive winner: either the event commits first and cancellation preserves media, or cancellation commits first and the event is rejected. A distinct shared operation-lock helper must be used by relay, media upload, and cancellation so lock derivation and acquisition order cannot drift.

The tombstone and cleanup queue are database state. After committing them, cancellation makes a bounded best-effort delete of its operation's objects. A service worker also drains durable cleanup work in bounded batches and retries failures with backoff, so process restarts do not lose cleanup. It calls an idempotent `Storage.Delete` for exact immutable object IDs and marks each item complete only after deletion succeeds or storage confirms it is absent. Media reads reject tombstoned/cancelling objects immediately, even while ciphertext deletion is pending. Local storage deletion must validate the object ID, be idempotent, and sync the containing directory. Future Supabase storage must delete only the backend-derived object key; provider credentials remain server-side. The API's `cancelled` result confirms that the operation is fenced and cleanup is durably scheduled; it does not claim that an unavailable storage provider has already removed the bytes.

The HTTP surface remains authenticated and private, uses no-store responses, accepts no client-supplied recipient list, and never receives plaintext, media keys, captions, or decrypted metadata. The cancellation response reveals only whether the caller's operation committed or was cancelled; unknown operations are safely cancellable by their authenticated owner and generation.

## Persistence and migration

A new forward-only migration records the owner generation and operation ID on each Circle media claim, adds a generic operation-cancellation tombstone keyed by sender, generation, and operation, and adds durable per-object cleanup state/work. Existing media rows predate operation binding and cannot be safely guessed into an operation. They remain accessible under existing grants and are excluded from operation cleanup until a separate audited legacy-retention policy is approved. Migration rollback is not part of the deployment contract.

The operation tombstone is permanent for the lifetime of the account generation so an old retry cannot resurrect a cancelled send. A replacement phone has a new generation and cannot reuse old operation IDs or media authority. Cleanup queue records contain opaque object identifiers and routing metadata only.

## Failure handling and privacy invariants

- A DB failure before the tombstone commits leaves the operation unresolved; the client retains its exact protected intent.
- A storage-delete failure after tombstone commit leaves the event fenced and the media unreadable; durable cleanup retries later.
- A lost cancellation response is resolved by repeating the same endpoint call. The result is still `cancelled` or `committed`.
- A committed event always wins over deletion, including a message whose response was lost or whose recipients have not acknowledged delivery.
- Circle membership changes do not change the original message audience, media grants, or operation ownership.
- The server stores and deletes opaque ciphertext only. E2E envelope contents, recipient bindings, and the existing fixed recipient list are unchanged.
- Cancellation does not revoke or delete media already referenced by a committed event, including a collection/profile event.
- Cleanup retries must be bounded and observable through operational metrics/logs without logging bearer tokens, captions, keys, plaintext, or ciphertext.

## Verification required before calling implementation complete

Go/PostgreSQL tests must cover send-versus-cancel races in both orderings, cancellation replay after a lost response, permanent send rejection after cancellation, committed-event preservation, same-operation multiple objects, owner/generation isolation, upload-versus-cancel races, stale session rejection, Circle membership changes, denied reads as soon as cancellation commits, storage delete idempotency, retry after storage failure, and local filesystem deletion safety. HTTP tests must cover strict routes/query/body validation and opaque responses.

Mobile tests must prove that operation IDs are saved before upload, `uploadAttempted` is saved before every PUT, every publication path uses the same ID for upload and relay, multiple collection snapshot objects map to the correct part operation, exact retries retain ciphertext/object IDs, unresolved results preserve protected state, confirmed cancellation clears state, and a committed response reconciles without deletion. TypeScript, Expo lint, full Go race tests, vet, migration tests, whitespace checks, and live local PostgreSQL/filesystem integration are required. Android device/emulator acceptance is optional for this server/client contract and remains skipped unless requested.

## Explicitly out of scope

This design does not add media expiration, retention windows, bulk account deletion, private-chat media storage, Supabase configuration, cloud cleanup guarantees, plaintext scanning, or any change to encryption formats, media descriptors, delivery receipts, or recipient selection. It does not automatically clean pre-migration orphan files whose operation cannot be proven.

## Implementation freedom

The exact API response field names and bounded public error codes can follow existing conventions. The semantic states, operation lock, durable retry queue, immediate read fence, and ciphertext deletion conditions above are fixed.
