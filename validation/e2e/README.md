# E2E validation gate

Date: 2026-10-10. Existing crate is a host primitive probe; **not a production encryption adapter**. Native gate BLOCKED pending binding implementation, build environment and device results.

## Reproduce host evidence

From this directory:

```sh
CARGO_TARGET_DIR=/private/tmp/awsemchat-e2e-validation-target cargo test --locked --offline
```

Rust 1.90.0, vodozemac 0.11.1, committed Cargo.lock. Initial run: 3 passed. Expanded run adds independent private/group tamper rejection; actual output is recorded below. No dependencies/credentials downloaded or created. The group tests use Megolm solely to inspect primitives, not to select it for production.

## Smallest next implementation slice: native security harness

Keep this inside Task 1, before identity/messaging production slices. Do not modify approved product screens or demo store. The absence of a native module is achievable implementation work, not an immutable external blocker.

Proposed files:

- `apps/mobile/modules/awsemchat-crypto/`: generated local Expo module config, Kotlin bridge, Rust crate with pinned vodozemac and generated JNI/FFI bindings; isolate native ownership of accounts, sessions and secret wrapping. Future Swift wrapper uses the same Rust API; no claim of iOS validation.
- `apps/mobile/src/security/encryption-adapter.ts`: narrow typed facade for opaque account/session handles and encrypt/decrypt; no JS/native fallback crypto, no plaintext logging, stable error codes. Candidate calls are application interfaces, not upstream API names.
- `apps/mobile/src/storage/encrypted-history.ts`: SDK57 `expo-sqlite` SQLCipher store with native-protected random key, migration/import staging and atomic history generation switch.
- `validation/e2e/android/`: instrumentation/harness scenarios and machine-readable result capture. `validation/backup/android/`: SQLite/export/import failure injection. `validation/media/android/`: cutout/output inspection.
- App config plugin enabling `expo-sqlite` `useSQLCipher: true`; package/lockfile adds SDK-resolved SQLite and secure key bridge only in this slice. Generated `android/` remains CNG output, never handcrafted.

Prerequisites: review/approve candidate E2E design including key-directory trust, identity-change verification, primitive version and license inventory. Inventory actual generated SDK57 Gradle/AGP/JDK/compileSdk/NDK requirements; current controller inventory is Corretto11 + platform34, which must not be assumed sufficient. Official libsignal alternative requires JDK21; that is not an asserted vodozemac or Expo requirement. Read matching Expo57 docs and module generator instructions before scaffolding. Native tooling install/download remains scoped separately; no EAS deployment or credentials required for local debug build.

Build recipe once harness exists (these commands have **not** been executed as successful build evidence):

```sh
cd apps/mobile
npx expo install expo-sqlite
npx expo prebuild --platform android
npx expo run:android --device
```

Use Bun equivalent if a bun.lock is introduced. Set actual generated application ID explicitly before build. Record resolved package versions, Gradle/JDK/NDK, ABIs and SQLCipher version. Do not call `expo start --android` or a Hermes bundle export proof of native compilation. Scaffold local module with the supported generator rather than guessing JNI paths. Exact Gradle instrumentation task/runner will be recorded after scaffolding (none exists now).

## Device acceptance matrix

Use isolated Alice, Bob, Carol and outsider native accounts on device; a single instrumentation device can hold isolated accounts for primitive bridge proof, but transport/device-replacement acceptance later requires distinct devices. Each step emits pass/fail IDs without keys/content.

1. Register trusted identity keys via the review-approved verification path. Alice sends authenticated ciphertext; Bob decrypts and replies; outsider fails. Spoofed server key/identity change must be detected, not silently accepted.
2. Create Circle with Alice/Bob, send event E1; accept Carol and send E2. Carol fails to fetch/decrypt E1 even via direct object/key request; decrypts E2. Rejoin Carol after absence cannot decrypt absence events.
3. Remove Bob, reconcile all outboxes and device generations, send E3. Bob cannot fetch/decrypt E3 with old session/cache/socket/grant; remaining members decrypt. Acquire a ciphertext proxy URL/grant before removal, then retry the identical URL/grant and ranged/resumed/thumbnail reads after removal: reject them using current authorization. A direct Storage signed URL must never be returned to the client; an exposed preissued bearer URL that works until expiry fails this gate. Race removal against streaming and prove no post-commit chunk admission, while recording already admitted/in-flight bytes separately. Reject stale membership revision and concurrent send/join without broadening retry audience.
4. Flip ciphertext bytes and protected header/outer route fields; reject before persistence/render. Replay after process restart must create one event. Native crash/restart must not reuse send keys or roll back ratchet state.
5. Promote E1 by Alice. Bob can access according to current authorization; Carol cannot see Moment/thumbnail/quote/reaction/push metadata. Reject promotion by Bob. Mixed-audience reply cannot leak.
6. Replace Alice phone generation; revoke old token/socket/proxy grant authority at the documented admission boundary. Retry a preissued proxy URL and stale download/upload grants on the old device after replacement, including range/resume: reject without refresh. Verify direct Storage signed URLs are absent from client responses; do not claim app revocation invalidates them. Restore an old backup cannot restore active sessions or revoked membership.
7. Attempt PING and PONG in a Circle, before private friendship acceptance, after unfriend/block and via stale offline retry: server rejects declared kinds and receiving clients reject protected-kind/context mismatch. Accepted private friendship permits explicit PING/PONG; PONG is never automatic or a read receipt.
8. Complete SQLCipher and backup matrix in adjacent directory. Test process kill, migration failure and filesystem pressure. Redact key/OTP/phone/token values from test output.

Capture `adb devices -l`, Android/API/ABI, build git revision, package versions, harness exact command, unedited sanitized test output and failure details. An AVD `flutter_emulator` is listed locally, with sandbox crashpad warnings; no connected target or native test run was observed. Emulator evidence can establish integration feasibility; approved handoff requires real-device checks before release and background/Keystore behavior cannot be established by host tests.

## Recorded expanded host result

Command above completed on 2026-10-10 with exit0. Sanitized output:

```text
Finished test profile [unoptimized + debuginfo] target(s) in 1.29s
running 5 tests
test group_ciphertext_tampering_is_rejected ... ok
test joining_at_current_ratchet_cannot_decrypt_history ... ok
test removal_requires_rotating_the_sender_session ... ok
test private_exchange_rejects_outsider ... ok
test private_ciphertext_tampering_is_rejected ... ok
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

`git diff --check` also passed. No mobile files changed; mobile lint/typecheck was not used as security evidence. Initial worktree-default Cargo target failed sandbox writes; using the writable temporary target produced the result above. Sandbox `adb devices -l` failed socket startup; authorized escalated retry returned `List of devices attached` with an empty list. Neither result establishes native security integration.

### Identity-verification policy approved 2026-10-10

Accepted friends may chat without manually comparing safety codes. QR/safety-code comparison remains optional. Clients must persist the first pinned identity and its history; key changes reset verification, warn clearly and stop sending until acknowledged. Pending messages must never silently be re-encrypted to changed keys. Unverified trust-on-first-use does not protect against active server key substitution. This product decision does not validate the native crypto bridge or remove the native gate.
