# Connected Android key service

Recorded2026-10-12 using emulator-5554, the rebuilt ARM64 debug APK, canonical-workspace Metro8081, loopback Go API8088 and synthetic PostgreSQL17 on55432. Migrations004 and005 were explicitly applied to this local database; no external deployment was performed.

The development-only route `awsemchat:///durable-crypto-probe?run=1&phase=keyService` created two synthetic accounts through the existing development mock-SMS adapter. It reset only the existing probe namespaces, kept credentials in memory and attempted logout for both sessions in cleanup. Console output contains fixed labels only.

The device reported PASS for:

- `NATIVE_PUBLICATION_TO_GO_POSTGRES`: both native signed batches and account-bound proofs were uploaded through the real mobile client and verified/persisted by Go.
- `NATIVE_ACK_AFTER_SERVER_COMMIT`: native pending/unpublished status cleared only after successful publication acknowledgement.
- `PRIVATE_CONSENT_ENFORCED`: allocation denied before friendship acceptance.
- `SERVER_ALLOCATION_EXACT_RETRY`: the same operation returned an identical allocation.
- `NATIVE_SESSION_FROM_SERVER_ALLOCATION`: the returned key matched the target's native identity, passed native outbound validation and established a session whose ciphertext decrypted to the exact synthetic text.
- `CIRCLE_ALLOCATION_CURRENT_AUDIENCE`: an accepted Circle invitation enabled current-epoch allocation.
- `REMOVED_AND_BLOCKED_ALLOCATION_REJECTED`: removing a Circle member and blocking private chat each denied subsequent retries in their respective contexts.

This is connected native key publication/allocation and native encryption evidence. The harness transfers the ciphertext directly between its two native adapters in one Android process. It does not prove a message relay, two separate devices, realtime/offline delivery, complete account-bound native storage walkthrough, replacement races, production SMS, media encryption or final product UI acceptance.

TypeScript and lint passed, and the complete73-test mobile suite passed. The previously recorded Go/PostgreSQL race suite verifies the endpoint/storage contracts separately. Generated APK/Android build files remain ignored.

## Relay and receipt extension — 2026-10-12

Migration006 was explicitly applied to the synthetic local database. The loopback API was restarted from current canonical source. Android ARM64 debug build succeeded in36 seconds, and the rebuilt APK was installed without clearing product app data. The correctly quoted development route passed at06:20:40 device log time:

- `NATIVE_MESSAGE_RELAY_INBOX`: native outbox uploaded through Go/PostgreSQL and fetched through recipient-only inbox.
- `LOST_ACK_EXACT_RECEIVE_RECOVERY`: recipient plaintext was committed while sender status remained Sent; the native exact-commit query then allowed acknowledgement.
- `RECEIPT_RETRY_WITHOUT_DUPLICATE_PLAINTEXT`: repeated recovery kept one native history record and sender status Delivered.
- `FIXED_CIRCLE_RECIPIENT_DELIVERY`: removing an unacknowledged original recipient kept status Sent and denied their later inbox access.

The previous key publication/allocation labels also passed. Unlike the earlier run, this extension transports the private message through the actual relay and uses real receipt/status endpoints. It still runs two synthetic accounts in one emulator process. Persistent cursor/offline/background synchronization, separate-device acceptance and final production UI integration remain required. The default native durability suite also passed after APK installation. All84 mobile tests, typecheck/lint, the full PostgreSQL race suite and go vet pass.

## Persistent inbox extension — 2026-10-12

The next ARM64 debug build succeeded in34 seconds. After installation and restarting only the development app, the connected probe passed at06:23:18:

- `SEALED_INBOX_CURSOR_REOPEN`: synchronization committed the private event cursor; reopening the same native namespace returned that exact cursor.
- `DENIED_PAGE_CURSOR_WITHOUT_PLAINTEXT`: after Circle removal, a scanned empty page advanced to the Circle event cursor while native history remained at one record.

All earlier labels also passed. Native Rust tests additionally verify cursor compare-and-swap, stale update rejection and archive exclusion. Mobile worker tests verify failed-receipt recovery and single-flight behavior. The full27 Rust and87 mobile tests pass, and mobile typecheck/lint pass. This probe reopens a native adapter within one Android process; a dedicated cursor process-restart test, runtime scheduling and full product UI connection remain pending.

## Sender coordinator extension — 2026-10-12

The ARM64 debug rebuild succeeded in34 seconds. The probe passed at06:30:30 after installing the APK and restarting the development app. `SENDER_ALLOCATES_ONLY_FIRST_SESSION` proves the coordinator performs one allocation when creating its session and performs none for the next message. `SENDER_EXACT_OUTBOX_RETRY` proves retrying the same saved native operation returns the same server event without another allocation. Both messages traversed the real relay/inbox and received delivery acknowledgements; native recipient history contained exactly two records. All prior labels passed, including the removed Circle recipient remaining Sent. This uses the sender coordinator with synthetic adapters/sessions in one emulator, not the full signed-in UI or separate devices. Host account-sender tests cover serialization, caller-input snapshotting, replacement rejection and continued work after failure. All100 mobile tests, typecheck/lint and28 Rust tests pass.

## Immutable draft extension — 2026-10-12

The ARM64 debug rebuild succeeded in34 seconds. The first device attempts stopped at authentication: sanitized boundary evidence showed RATE_LIMITED, matching the existing ten-per-network-per-hour rule after repeated synthetic probe runs. No rate limit was loosened or authentication history deleted. A task-owned schema `android_draft_fixture_20261012` was created and explicitly migrated in the local synthetic PostgreSQL database, and an isolated mock API was started on loopback8089; normal development API8088 remained unchanged. The development key-service harness now uses8089 and ADB reverse8089.

At06:35:18, all prior labels passed plus `CHANGED_DRAFT_REJECTED_NATIVE`: altered text and a different private destination each returned native OPERATION_CONFLICT before upload. Identical retry still returned the original event, and the next message reused the existing session. The fixture API/schema are retained for continuing local device validation. Host29 Rust and101 mobile tests, typecheck and lint pass. Native Rust tests cover reopening; the connected probe covers actual native draft rejection but not separate-device or complete product UI acceptance.

## Sender records extension — 2026-10-12

The ARM64 debug build succeeded in35 seconds and the isolated8089 connected probe passed at08:20:59. `LOCAL_SENDER_RECEIPT_REOPEN` verified local sent state after coordinator upload, committed delivered status from the sender-owned status endpoint, rejected status regression through monotonic storage, and read delivered state after reopening the native adapter. All previous sender/relay/inbox/receipt labels passed. Native tests also prove uncommitted confirmation rollback, changed server event rejection and rejecting read status. All30 Rust and102 mobile tests, typecheck and lint pass. Reopening is within one process; complete signed-in UI/process-restart acceptance and automatic receipt refresh remain pending.

## Automatic outbox recovery — 2026-10-12

At08:27:05 the isolated8089 probe passed `AUTOMATIC_RECEIPT_REFRESH` and `PENDING_OUTBOX_RECOVERY`, together with all prior labels. The worker advanced a native Sent record to Delivered through the actual sender-owned status endpoint. It also uploaded an operation that had only been encrypted/queued locally, persisted Sent, synchronized the recipient, and then persisted Delivered. Native recipient history contained exactly three records. This runs the real recovery worker with two synthetic accounts in one emulator, not full signed-in lifecycle/UI acceptance. No native changes required another APK build for this extension. All109 mobile tests, typecheck and lint pass.

## Native ordering and live text-chat route — 2026-10-12

The ARM64 metadata build succeeded in35 seconds. After installation, the connected probe passed at08:49:40 including `NATIVE_LOCAL_MESSAGE_ORDER`, which read recipient sequences1,2,3 from actual native history. All previous labels remained green. The `/chat?peer=...` signed-out gate was opened and visually inspected from an emulator screenshot; it requests sign-in and exposes no conversation plaintext. This does not prove signed-in text entry, keyboard behavior, TalkBack, theme acceptance or separate-device messaging. Those remain pending. Host117 mobile tests, typecheck and lint pass; the previously recorded31-test native suite covers ordering across reopen.


## Sent and received archive device verification — 2026-10-12

Installed the successfully rebuilt ARM64 debug APK on emulator-5554 without clearing product data. Ran the development-only full durable-crypto probe with synthetic namespaces. It reported PASS including SENT_RECEIVED_HISTORY_ARCHIVE and HISTORY_ONLY_RESTORE. The probe exported one incoming and one outgoing message, restored both as archival, retained outgoing direction, kept the destination identity unchanged, exposed no live outgoing operations, and rejected retry of a non-restored operation. Existing rollback, replay, identity quarantine and sealed-storage checks also passed.

Host verification: all33 Rust and123 mobile tests pass; TypeScript, Expo lint and Android assembleDebug pass. This is native archive foundation evidence, not full backup UI, Google Drive integration, scalable history or two-device product acceptance.


Repeated restore update (2026-10-12): importing identical archival records now skips them after validation and normalization, before capacity checks. This works across native reopening and at the combined 768-record limit. Different record contents remain distinct; this is exact-record deduplication, not conflict reconciliation or deduplication against live history. The regression test first failed with two messages instead of one. Supplemental tests cover duplicates within a batch and retries at full capacity. An initially oversized test request correctly hit INPUT_TOO_LARGE; the fixture was corrected without relaxing that guard. All36 Rust tests pass, with mobile typecheck/lint and Android assembleDebug. The updated connected full durability probe passed after importing the same archive twice and verifying exactly two restored messages. Full local/Drive backup workflows and scalable storage remain open.


Encrypted history service update (2026-10-12): the production backup controller and archive bridge adapter now connect durable sent/received history to native authenticated archive encryption. The destination receives encrypted bytes and the recovery key is returned separately. Restore validates the full archive before one native import; account changes prevent subsequent export/import work. The Android full synthetic durability probe passed wrong-key preservation and valid repeated restore through this service. All134 mobile tests, typecheck and Expo lint pass. Current native codec limits are enforced without partial exports. Local/Drive destinations, complete chunked archives, backup settings/recovery UX, media and replacement-phone acceptance remain required. See [history backup contract](../../../docs/technical/history-backup.md) for the implementation sequence and evidence limits.


Complete bounded-history update (2026-10-12): failing host Java, Rust and mobile tests demonstrated rejection above the former128-record/request bounds. The existing authenticated frame/manifest format now supports all768 records in the current durable store and escaped32KiB message payloads. Only native importHistory gains the8MiB request allowance; other live requests remain128KiB. Existing archives retain their format and decode normally; older app builds reject archives exceeding their smaller limits. Aggregate and frame limits remain finite. Android archiveCapacity probe passed COMPLETE_768_RECORD_NATIVE_ARCHIVE, ESCAPED_MAXIMUM_MESSAGE, TRUNCATION_PRESERVES_HISTORY and FULL_CAPACITY_REPEAT_RESTORE. Host JCA tests retain wrong-key/account, all-byte corruption/truncation, reorder/duplicate and capacity checks. All135 mobile tests, typecheck/lint and ARM64 build pass. This covers complete current bounded history, not scalable retention, local/Drive file destinations, media or production recovery UX.


Local backup update (2026-10-12): account runtime now exposes guarded encrypted local backup/import and the native backup/restore routes use that runtime. Unique SAF files contain ciphertext only; recovery keys stay separate in the recovery screen. Cancellation and write failures preserve history, failed writes clean up their owned file, and oversize imports are rejected before reading. All143 mobile tests, typecheck/lint pass. Android synthetic validation passed real private-file encrypted write/read/import/cleanup; the signed-out backup gate was visually inspected. Signed-in system picker/recovery/accessibility and replacement-phone acceptance, Drive, media and scheduled/persistent last-success features remain open.


Pending Drive recovery update (2026-10-12): coordinator and native pending vault preserve the exact encrypted archive, separately protected recovery key, generated Drive ID and upload URI across process restart. Uploaded keys remain until explicit saved-key acknowledgement. Conflict recovery compares exact remote bytes; immutable fields, account changes and corrupted files fail closed. All170 mobile tests, typecheck/lint pass. Android seed/force-stop/resume passed native file/SecureStore reopening and acknowledgement cleanup using simulated remote responses. Google OAuth, real upload/restore, expiry/offset handling, crash/power-loss/storage acceptance and product UI remain unfinished. Drive remains disabled.


Drive resumable update (2026-10-12): retry now queries the saved upload URI, resumes from confirmed bytes, handles committed status without retransmission and renews expired sessions with the original file ID/archive/key. Redirect handling was tested against installed Android Expo fetch's308 behavior. All180 mobile tests, typecheck/lint pass. The actual Android localhost fixture passed status/remaining-range/completion/expiry/redirect checks; a host HTTP interrupted-upload integration test verified one ID/encryption and exact resumed bytes. Drive remains disabled pending Google OAuth/session/UI wiring and real-provider acceptance.
