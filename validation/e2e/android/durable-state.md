# Durable native state contract

Implementation design recorded before coding, 2026-10-10; native verification completed 2026-10-11. Production transport/UI activation remains blocked.

One native SQLite owner holds a single sealed snapshot per local account namespace in Android noBackupFilesDir. This dedicated database contains only AES-GCM ciphertext, IV and format byte in one BLOB; it never opens the existing Expo SQLCipher history database. Android Keystore generates a non-exportable AES-256 key and fresh randomized GCM IV for every commit. AAD binds format and the namespace digest. The snapshot owns account/session pickles, peer pins/history, exact outbox bytes, received event replay records, and decrypted history together. Vodozemac 0.11.1 source verifies Account::pickle/from_pickle and Session::pickle/from_pickle return serde-capable AccountPickle/SessionPickle. Their plaintext serialization stays in Rust/JVM memory, never in JS or files.

## Prepare, commit and recovery

1. Validate namespace, request and bounded storage. Serialize native calls across module instances. Open this dedicated database, begin a SQLite transaction, and read/decrypt the one committed snapshot with its existing Keystore key. Missing key, missing row, corrupt seal or unknown format fails closed. Initialization is explicit and refuses any existing key/file, including an empty/incomplete file. No automatic replacement identity.
2. Deserialize into a temporary Rust candidate. Apply a request to that candidate only. Outgoing fanout records stable operation ID, original recipient key identities, audience, input and exact serialized envelope bytes while advancing all associated ratchets. Duplicate operation with differing input/audience fails. Incoming decrypt, UTF-8/protected context validation, replay insertion and history append happen within that same candidate. No output is delivered yet.
3. Seal the entire candidate with fresh IV; update the BLOB; commit SQLite with synchronous FULL. Only after endTransaction confirms success may the public result cross JS. Any error discards the candidate and no ciphertext/plaintext result escapes. No live ratchet survives a call.
4. After restart or an ambiguous return, reload committed authority. Either old state is intact and unexposed encryption may safely be retried, or new state plus exact ciphertext is committed and retries return those bytes. Never reuse committed operation IDs for other payloads. SQLite journal recovery owns torn/interrupted transaction recovery, with no fallback to older valid snapshots on authentication error.

Peer pins use TOFU. Observing different encryption OR signing keys records a pending change and resets manual verification. Sends and outbox retries for that peer are blocked. Acknowledgment must repeat the exact pending keys and retires the old active session; old operations retain old recipient keys and remain quarantined after acknowledgment. New operation IDs and new sessions are required. Future transport must revalidate through retry at send admission instead of blindly sending previously cached bytes; no transport is connected in this slice. Optional verification must identify the exact current keys and cannot clear an unacknowledged change.

History export/import has a strict records-only schema, no generic state import. Imports are quarantined archival records and never hydrate peers, live account/session keys, auth, replay authority or outbox. Authentication/account binding of a backup remains the external backup gate. Native receive history is canonical within this foundation; integration with production history/SQLCipher requires a deliberate single-owner migration, not dual writes.

Each operation ID is also the authenticated event ID in this foundation (one event per operation). Protected content repeats conversation ID, audience revision identifier, sender encryption/signing keys and the full recipient key set. Incoming calls must supply matching event/conversation/audience values and include this account in the authenticated recipients. Production device generations and server-authorized membership snapshots remain an integration gate. Pinning signing-key continuity is not prekey signature verification.

Bounded foundation: at most8 namespaces, request128KiB, payload32KiB, peers/sessions64, pin transitions16 per peer, outbox256, received history512, archive512, sealed snapshot8MiB, recipients19. Receive history and imported archives are available through the history facade; outgoing plaintext remains in the sealed outbox. Production history aggregation and backup completeness need integration before activation. Capacity fails before commit without state advancement. No automatic eviction of replay/outbox records. This is not a production retention/scalability policy.

Threat/claim limits: no anti-rollback against privileged restoration of an older authenticated database; OS backup excluded, live state is never exported. A rooted/unlocked process can access plaintext. Rust/JVM serialization copies cannot all be reliably erased. First-contact TOFU does not authenticate a server key directory. Signed prekey publication, actual server generation/membership authorization, full production protected headers, transferable provenance, media, backup auth, iOS and physical-device testing remain gates.


## Android evidence and reproduction

SDK57 / Android API33 ARM64 emulator-5554, Kotlin2.1.20 / JDK17 / vodozemac0.11.1 / Rust1.90. Native incremental build: 15s, 385 tasks (35 executed). All calls use the real Expo → Kotlin → JNI → Rust path. No backend, real-account content or product UI activation.

From `apps/mobile`, run `npx tsc --noEmit`, `npx expo lint`, and `node --experimental-strip-types --test tests/dispose-accounts.test.mjs`. From the repository root run:

```sh
CARGO_TARGET_DIR=/private/tmp/awsemchat-native-crypto-target cargo +1.90.0 test --locked --offline --manifest-path apps/mobile/modules/awsemchat-crypto/rust/Cargo.toml
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/erik/Library/Android/sdk apps/mobile/android/gradlew -p apps/mobile/android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am force-stop com.moherik.awsemchat
adb -s emulator-5554 shell "am start -a android.intent.action.VIEW -d 'awsemchat://durable-crypto-probe?run=1&phase=full' com.moherik.awsemchat"
adb -s emulator-5554 logcat -d -s ReactNativeJS:I | rg AWSEM_DURABLE_CRYPTO_PROBE
```

The debug probe is explicitly gated by `__DEV__`, native ApplicationInfo.FLAG_DEBUGGABLE, and reserved synthetic `probe-` namespaces for fault/reset controls. No production screen links to it. Production calls cannot reset keys or inject faults. Its checkpoint file contains only a digest of synthetic ciphertext to compare exact bytes across process death; never a snapshot or secret. All native store exceptions map to fixed codes.

Run the URL with phase `seed`, force-stop the app, then launch phase `resume`. Seed saves committed ciphertext digest and one received event; resume validates exact bytes, persisted identity and replay/history in a different PID. Every normal call already opens/closes the DB, so ordinary retries prove reopen, not process death.

For actual interruption boundaries, launch `crashBefore` and confirm the app process exits (`adb shell pidof com.moherik.awsemchat` returns none). Native Process.killProcess executes after writing the sealed candidate but before marking the SQL transaction successful. Launch `recoverBefore`: the operation is absent, then a new send decrypts correctly. Repeat with `crashAfter` then `recoverAfter`: native death occurs after endTransaction commits and before a result crosses Expo; recovery retrieves committed ciphertext, decrypts it, and compares the prior operation to its saved digest. These are actual process deaths, not simulated handle disposal. They do not emulate power loss or faulty storage hardware.

A separate inspection read the synthetic database from Android `no_backup/durable-crypto-v1`. The only application table is `sealed(slot,payload)`; Android also creates `android_metadata(locale)`. Payload is an AEAD sealed BLOB; known synthetic plaintext/private-pickle field names are absent from the file. noBackupFilesDir is excluded by Android backup policy; a full OEM cloud/device-transfer backup was not performed. There is no plaintext SQLite connection to the Expo SQLCipher store.

Initial red tests failed on unimplemented transactions, protected-conversation support, and the existing cleanup loop stopping at the first rejection. The first device run failed before native persistence existed. Device diagnosis then found `execSQL` cannot execute the row-returning journal-mode PRAGMA; `rawQuery` now checks that DELETE mode was applied. Temporary diagnostics were removed. Disposal now awaits all accounts and reports one fixed failure afterward.

Primary sources: pinned local `vodozemac-0.11.1/src/olm/account/mod.rs` (pickle APIs around405/606) and `session/mod.rs` (463/640), [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/), [Expo module API](https://docs.expo.dev/modules/module-api/), [Android Keystore parameters](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec), [SQLiteDatabase](https://developer.android.com/reference/android/database/sqlite/SQLiteDatabase), [noBackupFilesDir](https://developer.android.com/reference/android/content/Context#getNoBackupFilesDir()).

## Recorded synthetic device results

```text
{"phase": "full", "pid": "12926"}
10-11 06:19:31.268 12926 12972 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-11 06:19:32.139 12926 12972 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["ROLLBACK_OUTBOX","COMMIT_LOST_REPLY","EXACT_RETRY_REOPEN","ATOMIC_RECEIVE_REPLAY_HISTORY","DURABLE_BIDIRECTIONAL","IMMUTABLE_AUDIENCE","HISTORY_ONLY_RESTORE","PIN_CHANGE_QUARANTINE","CORRUPT_SEAL","WRONG_KEY","KEY_LOSS","MISSING_ROW","FORMAT_VERSION"]}'
{"phase": "seed", "pid": "13043"}
10-11 06:19:35.646 13043 13084 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-11 06:19:36.366 13043 13084 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["RESTART_SEED_COMMITTED"]}'
{"phase": "resume", "pid": "13153"}
10-11 06:19:39.892 13153 13197 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-11 06:19:40.143 13153 13197 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["PROCESS_RESTART_EXACT_RETRY","PROCESS_RESTART_IDENTITY","PROCESS_RESTART_REPLAY_HISTORY"]}'
{"phase": "crashBefore", "processDead": true}
{"phase": "recoverBefore", "pid": "13367"}
10-11 06:19:47.449 13367 13408 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-11 06:19:47.603 13367 13408 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["PROCESS_DEATH_BEFORE_COMMIT_ROLLBACK","RECOVERED_SEND_RECEIVE"]}'
{"phase": "crashAfter", "processDead": true}
{"phase": "recoverAfter", "pid": "13581"}
10-11 06:19:55.145 13581 13621 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-11 06:19:55.358 13581 13621 I ReactNativeJS: 'AWSEM_DURABLE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["PROCESS_DEATH_AFTER_COMMIT_RECOVERY","COMMITTED_RATCHET_CIPHERTEXT","PRIOR_CIPHERTEXT_UNCHANGED"]}'
```

Host result: 11 tests passed (7 durable,4 original adapter); cleanup regression1/1 passed. Typecheck and Expo lint exited0. Node emitted the existing module-type warning for stripping TypeScript; Gradle emitted its deprecation summary. No warning was treated as proof of correctness.
