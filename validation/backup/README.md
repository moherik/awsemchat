# Encrypted backup contract and native gate

Date: 2026-10-10. Status: proposed format; export/import implementation and device SQLCipher validation **not run**. No host AES test is presented as native SQLite proof.

## Proposed archive v1

Use a reviewed native authenticated-encryption implementation. Default recovery material is a randomly generated 256-bit recovery key, never contact PIN, SMS or phone number. A password option requires reviewed Argon2id parameters benchmarked on lowest supported Android devices; do not choose guessable PIN or hardcode untuned KDF costs. Archive format/version and primitive suite must be reviewed before shipping.

Outer header contains magic, format version, suite ID, random archive ID, salt/KDF parameters if needed, and nonsecret lengths. Header is authenticated as associated data; reject unsupported suite, oversized lengths and excessive KDF parameters before allocation. Encrypted manifest contains account binding, source device generation (historical only), history schema version, creation time, original audiences/membership intervals, media inclusion policy, chunk order/count/length/hash and all recovery-required archival keys. Encrypt chunks with independent derived keys/nonces using reviewed domain separation, bind archive ID/index/length/manifest in authentication, and authenticate final completion so truncation/reordering/duplication fail. Random generation, KDF/HKDF/suite selection and streaming API remain native gates.

Include historical messages/Moments, decrypted-local history re-encrypted into archive, authorized media/thumbnail bytes, original audience metadata, personal stickers and own preferences if approved. Exclude auth tokens, OAuth refresh secrets, push tokens, pending sends, active sender sessions and current membership privileges. Backups increase exposure of archival decrypt keys; communicate that history recovery does not preserve disappearing past secrets. Nothing here permits new members to restore another user's history.

Drive uploads only completed encrypted archives, with generic filenames; commit a new immutable archive before replacing latest pointer. Retain previous valid archive until new upload acknowledgement. Local export uses user-selected destination with same ciphertext. Recovery-key loss is irreversible history loss; account phone verification cannot recover plaintext. Retention, limits, password option and media scope are owner decisions.

## Failure-safe restore

Authenticate account separately; verify archive account binding using authenticated manifest. Verify/decrypt into a private staged generation; no plaintext export/temp file on shared storage. Apply schema migration, verify record/media hashes, SQLCipher integrity and archive completion. Only after all checks, close readers, atomically switch the active generation with crash-recoverable journal and reopen. Keep previous working generation until successful startup confirmation. Any wrong key, corrupt/truncated archive, unsupported schema, full disk or interruption leaves prior history usable. Refresh current server authorization before any outbound action. Device replacement generates fresh live identity/session secrets; imported archival keys cannot become active keys.

## Required native assertions and evidence

1. Enable SDK57 SQLCipher config plugin, rebuild native app; record `PRAGMA cipher_version`, nonempty expected version, `PRAGMA cipher_integrity_check` and ordinary integrity result. SQLite silently ignores unsupported pragmas, so a successful key statement alone proves nothing.
2. Insert sentinel history, close DB. Opening a copy without key and with wrong key must fail actual `sqlite_master`/row read; valid key restores sentinel. Inspect DB/WAL/SHM/cache backups for sentinel plaintext. Do not print secrets or sentinel content from real user data.
3. Export closed/coherent snapshot; correct recovery key restores IDs, payloads/media hashes and historical boundaries into staging. Wrong key, bit flip, truncation, swapped chunks and wrong account fail before switch.
4. Kill process at each stage including final switch; restart selects one complete usable generation. Existing history survives failed migration, out-of-space and revoked Google OAuth.
5. Import old device backup after member removal/replacement; local history may restore but old token/session/outbox/membership must not authorize future communication. Exercise lost recovery key safe UX.
6. Google account cancellation/revocation, quotas, interrupted resumable upload and deletion of appdata folder report accurate retry/error state; last-success time updates only on completed verified upload.

No native instrumentation runner/package exists yet. Implement the harness in the next Task1 slice described in `validation/e2e/README.md`, then record exact generated Gradle task and outputs. Public source: [Expo57 SQLCipher](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [Drive appdata](https://developers.google.com/workspace/drive/api/guides/appdata), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). Provider access and native encryption are independent gates.

## Implemented native storage foundation (2026-10-10)

`apps/mobile/src/storage/encrypted-history.native.ts` owns SQLCipher history generations. SDK57 `expo-sqlite` has `useSQLCipher: true`; Android OS backup is disabled. Random 256-bit raw database keys come from native `getRandomBytesAsync` and live in SecureStore with device-only unlocked Keychain accessibility on iOS (Android Keystore wrapping). No JS encryption adapter or plaintext storage fallback exists. Web entry throws explicitly. SQLCipher version and keyed schema reads must succeed before writing. The demo remains in memory and does not call this adapter.

Operations are serialized through one owner per namespace. Transactions use the keyed connection: SDK57 `withExclusiveTransactionAsync` creates a new unkeyed connection and is unsuitable here. Invalid/duplicate batch insertion rolls back. Import creates a fresh encrypted generation, verifies caller-supplied completion and both integrity checks, closes active readers, then persists one SecureStore journal value containing active and previous descriptors. The previous database remains until successful startup confirmation. First creation records a `creating` state before file writes; interruption can resume initialization. An invalid new generation falls back to the retained previous generation. Failed staging leaves prior history active. Abrupt interruption may leave orphan encrypted staging files; automatic orphan cleanup is not yet implemented.

`stageImport` is a storage boundary for already authenticated archival records, **not** an implemented backup decryptor. The required callback must authenticate archive account binding, all chunks, hashes and final completion before it resolves. The current narrow adapter carries event ID, conversation ID, original audience, membership interval, receipt time and archival payload only. It has no API for live sender sessions, bearer tokens or pending sends. Archive algorithms, export, Drive and native crypto remain gated.

Run host checks with `cd apps/mobile && npm run test:demo`. The history tests use real host SQLite but stub SQLCipher, SecureStore and randomness boundaries; they prove transaction/import ownership behavior only. They do not prove native confidentiality, native SecureStore durability or power-loss recovery.

For native checks, rebuild with `npx expo prebuild --platform android --no-install` and `npx expo run:android`. Open the development-only `/native-storage-probe` route (scheme `awsemchat://native-storage-probe`) and run synthetic checks. It reports SQLCipher version/integrity, close/reopen persistence, wrong-key rejection, transaction rollback, failed staging preservation and generation-switch reopen/confirmation. It uses temporary synthetic namespaces, retains those encrypted probe databases for inspection, and emits no key or private content. Close/reopen is not a process-kill or physical power-loss test; the numbered native assertions above remain binding. Do not use Expo Go, which lacks SQLCipher.

Native results are **pending**. iOS database backup exclusion, process-kill/power-loss windows, full-disk failure, WAL/file plaintext inspection, SecureStore deletion behavior and device replacement still require device evidence. The current foundation must not be activated for production history until those gates pass.

Sources: [SDK57 SQLite](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [SDK57 native random bytes](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/), installed `expo-secure-store` SDK57 source/API and config plugin. The version-pinned SecureStore web page was inaccessible to the research tool during this session.

### Follow-up native build evidence (2026-10-10)

The controller repaired official NDK 27.1 preparation and resumed local `./gradlew assembleDebug --no-daemon`. Gradle also installed the SQLite dependency's required NDK 27.0. The build ran for 23m59s and failed while downloading Hermes, fbjni and AVIF dependencies with **`No space left on device`**; available disk space was about 1.9 GiB afterward. This is a disk-capacity/dependency-acquisition failure, not a compiler error or SQLCipher failure. No APK or native SQLCipher runtime result was produced. The emulator had become authorized before this attempt; authorization alone is not runtime validation.

After sufficient disk space is made available, retry from `apps/mobile/android` with `./gradlew assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a` for the ARM64 emulator. The synthetic storage harness and all device acceptance assertions remain pending until the APK builds and runs. This evidence update performed no cleanup or source changes.

### Explicit automatic development probe

The existing synthetic probe accepts `run=1` for one automatic run per mounted route. The `__DEV__` guard blocks both automatic and manual execution in a production bundle; an in-flight guard prevents overlap, and a ref prevents StrictMode effect replay from starting a second automatic run. Manual reruns remain available. This is a validation runner, with no navigation entry added to the product UI.

With the development build installed and its Metro session connected, invoke on the intended ARM64 emulator:

```sh
adb -s emulator-5554 shell am start -W -a android.intent.action.VIEW -d 'awsemchat://native-storage-probe?run=1' com.moherik.awsemchat
adb -s emulator-5554 logcat -d -v brief ReactNativeJS:I '*:S' | rg 'AWSEM_NATIVE_STORAGE_PROBE'
```

Metro output also includes `AWSEM_NATIVE_STORAGE_PROBE` followed by JSON. Expect `status: START`, then `PASS` with the sanitized SQLCipher version and fixed check labels, or `FAIL` with a fixed `NATIVE_STORAGE_<stage>_FAILED` code. An unexpected runner/platform failure uses `NATIVE_STORAGE_RUNNER_FAILED`. Only fixed stage labels/status, a synthetic flag and a validated version string are logged; no database namespace, keys, payload, native exception message or stack is logged by this runner. `UNRECOGNIZED_VERSION` means the returned version did not match the log allowlist and requires inspection before accepting version evidence. Compare fresh START/final entries from the same invocation; historical log entries are not proof of a new run. No device success is asserted by adding the runner.

### Successful Android synthetic runtime evidence (2026-10-10)

The controller's subsequent ARM64 build, `./gradlew assembleDebug --no-daemon -PreactNativeArchitectures=arm64-v8a`, completed **BUILD SUCCESSFUL** in 6m30s with 488 tasks. Its APK was installed on emulator-5554 (Android API33). This successful build supersedes the earlier disk-capacity failure as the current build status; that historical failure remains recorded above.

The development app's default `10.0.2.2` Metro connection failed. The controller configured only this app's debug SharedPreferences `debug_http_host=localhost:8081`, with ADB reverse using the same port8081. Metro8081 loaded 1,936 Android modules in 10.127s. From fresh app PID5572, the synthetic runner emitted `AWSEM_NATIVE_STORAGE_PROBE` START followed by PASS, reporting `cipherVersion: "4.7.0 community"` and fixed checks `INTEGRITY`, `REOPEN`, `WRONG_KEY`, `ROLLBACK`, `FAILED_IMPORT`, `GENERATION_SWITCH`. Controller log artifact: `/private/tmp/awsemchat-native-metro-8081.log`.

This is actual Android emulator evidence for the runnable SQLCipher storage harness. `REOPEN` closes and reopens database connections; it is not a process-kill, physical crash or power-loss test. PASS does not validate backup archive encryption/account binding/chunks, full-disk recovery, OS backup exclusions, native E2E crypto/identity authentication, real-device security or provider integration. Those gates remain pending; no full E2E or production-readiness claim follows from this result.
