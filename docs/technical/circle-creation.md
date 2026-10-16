# Recoverable Circle creation

The coordinator in `apps/mobile/src/features/social/circle-creation.ts` is wired to account-bound native storage and the Android production creation screen. Signed-in native controller creation and retry recovery are verified against an isolated migrated API. Interactive screen controls, avatars and join-time profile distribution still require implementation or acceptance.

## Operation contract

Validate the version1 encrypted profile input and up to19 distinct invitee IDs before writing an intent. Persist separate immutable creation/profile operation IDs, the exact profile payload, original invitation selection and app account binding before any network side effect. The native vault must protect this private draft at rest; an ordinary plaintext file or demo store is not an acceptable implementation.

Creation calls the existing idempotent Circle endpoint, persists the returned Circle ID, sends the initial profile at revision1 through the account-bound native sender and then persists accepted-profile state. Invitations follow profile acceptance. Already joined selected friends are skipped during recovery; failed invitations retain the original selection for retry. Profile retries use the exact original operation and payload, preserving native outbox idempotency. No retry silently changes recipients or creates a second Circle.

The coordinator retains a completed record until the UI acknowledges the specific returned Circle ID. Reopening that record returns the existing result without replaying network side effects. Clearing the record before the user-visible result would make an interrupted completion indistinguishable from a fresh request and risk duplicate creation.

Account bindings are checked around every asynchronous boundary. Expired bindings produce rejected promises suitable for UI error handling. Controllers sharing a vault serialize operations; the native factory must return the same vault owner for the same namespace. Corrupt or foreign recovery records fail closed without overwriting the draft.

## Verification and remaining work

Ten coordinator tests cover persistence before network, lost create/profile replies, partial invitation failure, account changes, selection bounds, expired bindings, concurrency, corrupt recovery state and retained completed results. The initial six tests, expired-binding case and completed-result case were observed failing before implementation. Concurrency/corrupt-state checks are supplementary regressions. The current mobile suite passes247 tests, with TypeScript and Expo lint. Earlier coordinator-only evidence covered236 tests.

Coordinator tests use injected remote/storage ports. Six vault tests use authenticated Node AES-GCM with controlled file/pointer writes; two supplier tests cover account changes during opening and token replacement. These eight cases were observed failing before implementation. The Android synthetic seed/force-stop/resume probe separately verified the real native archive codec, private files and SecureStore reopening, ciphertext without a readable Circle name, and acknowledgment cleanup. It does not establish signed-in creation, actual power loss or native failed-write behavior. Remaining work:

- Verify native interrupted writes, storage failures and power loss. Host tests preserve the previous pointer on failed updates and retain a newly committed pointer/ciphertext after a lost response. Unreferenced ciphertext from interrupted writes may remain; safe orphan collection and storage-exhaustion behavior remain open.
- Accept the signed-in creation screen, searchable PIN-based accepted-friend checkbox selector, pagination, recovery and result acknowledgment on Android. Signed-out, signed-in form and recovered-creation screens were visually inspected. Native screen controls, keyboard/TalkBack, search and checkbox interactions were not exercised. Keep avatar and friend profile display in scope; the profile encoder currently accepts only null and encrypted media/personal profile support remains unfinished.
- Recovery now offers an explicit choice to finish without remaining invitations once the encrypted profile is accepted. Earlier-stage abandoned recovery, unavailable storage and unreadable drafts still need a separate recovery path.
- Distribute fresh profile snapshots to newly joined members without granting old chat/Moment history.
- Apply migration7 and restart the local development API only when the complete native profile/recovery path is ready for signed-in acceptance. No external deployment is included.

## Native draft storage

The account/device/generation/API-origin fingerprint selects a cached vault owner. SecureStore holds a small versioned pointer and its per-save recovery key; the private file contains only native authenticated ciphertext. The archive record uses `awsemchat.pending-circle.v1`, a single self audience, and a fixed creation context, distinct from history backup. Reads enforce size/context/binding checks before exposing the draft. Updates write a unique ciphertext file, authenticate its contents, commit the protected pointer, then remove the old owned file. A failed or uncertain pointer write never deletes the potentially referenced ciphertext. Bearer tokens are checked in memory by the supplier and never persisted in the draft fingerprint or pointer.

## Connected Android verification (2026-10-12)

The development-only `circleCreationLiveSeed`, `circleCreationLiveProfile`, `circleCreationLiveFinish` and `circleCreationLiveCleanup` phases in `circle-creation-harness.ts` use the actual authentication runtime, account-bound native encryption, production Circle coordinator, native encrypted vault and real HTTP APIs. They require the explicit temporary origin `http://127.0.0.1:8090` and use synthetic accounts only. Two deliberately discarded successful HTTP results model lost create/profile replies; these are fault injections, not actual network outages.

All seven migrations were applied to the isolated local schema `android_circle_verify_20261012`. The normal development APIs on8088/8089 and their schemas were not migrated or restarted. The temporary8090 API was stopped after verification; Metro and ADB reverse mappings were restored. Creator and peer synthetic sessions were logged out. The isolated schema is retained as test evidence.

Observed PASS results:

- Process2794: account login/preparation, accepted friendship, real remote creation with a discarded reply, durable original draft and one remote Circle.
- Process4324, after force-stop: actual SecureStore/account/native encryption reopening, exact create retry with one Circle, real accepted profile send with its reply discarded, and retained native committed send.
- Process4626, after another force-stop: production controller exact profile retry, one accepted profile revision, creator name projection, completed-result reopening without duplicate effects, one real invitation, membership changing only on acceptance, and result acknowledgment clearing the pending record.
- Process4857: synthetic creator logout and fixture-metadata cleanup.

Independent PostgreSQL reads confirmed one Circle at profile revision1, one message event, two members and one accepted invitation. Screenshots inspected: `/private/tmp/awsem-circle-recovery-signed-in.png` and `/private/tmp/awsem-circle-form-signed-in.png`. The form rendered the real accepted-friend PIN, checkbox, search field and correctly disabled blank-name action. This is rendering evidence, not interaction acceptance.

The Mac was unlocked, but the native computer-use tool did not support the emulator window. A visible-emulator attempt stalled during graphics initialization; verification returned to the previously working headless configuration. Keyboard entry, search/filter and checkbox actions, actual button-driven navigation, TalkBack/themes, two separate devices, native power loss and storage exhaustion remain unverified. Fresh profile snapshots for new members are still unfinished; creator-name projection does not prove the joining member receives the Circle name.

Verification review also found misleading failure feedback: invalid profiles and failed initial saves could be described as saved recovery. Three test-first regressions now distinguish invalid input, no saved intent, resumable saved intent and unreadable recovery. The screen only offers saved-recovery wording after successfully reading a pending record. The complete247-test mobile suite, TypeScript and lint pass. All43 Rust tests and uncached real-PostgreSQL Go race tests pass; Go vet passed in this verification turn. No native source changed, so no new APK build is claimed.

## Invitation recovery choice (2026-10-12)

The native saved-creation screen offers “Finish without remaining invitations” only after the initial encrypted profile has been accepted. A second step explains that the Circle stays and already sent invitations remain active. Confirming calls `finishWithoutInvitations(circleId)`, serialized through the existing account-bound vault. It requires the same saved Circle and accepted profile, writes the completed record, and retains it until Open Circle acknowledgment. It does not contact the relay, resend invitations, cancel existing invitations or delete the Circle. The immutable original invitation selection remains in the saved record. A lost completion response is recoverable through the usual completed-result path.

Four test-first coordinator regressions cover retained Circle/operations and no resumed invitations, rejection before profile acceptance or for a different Circle, failed completion persistence, and replaced-account rejection. All251 mobile tests, TypeScript and uncached Expo lint pass. The first full-suite attempt could not bind localhost fixture sockets in the sandbox; the rerun with localhost access passed. Existing Node module-type warnings remain. No backend or native encryption source changed in this slice. Emulator interaction testing was explicitly skipped by the owner; this is controller/static verification, not native screen acceptance.
