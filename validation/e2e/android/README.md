# Android Olm bridge probe

Experimental integration, not production protocol adoption. `apps/mobile/modules/awsemchat-crypto` is an Android local module scaffolded with official `create-expo-module@57.0.1`; Kotlin calls a Rust JNI library using pinned Apache-2.0 vodozemac 0.11.1. Its upstream audit does not audit this bridge, current dependency graph, or application protocol. Expo's scaffold license remains alongside the module; Cargo.lock records all transitive versions.

## Reproduce

Host adapter tests (from repository root):

```sh
CARGO_TARGET_DIR=/private/tmp/awsemchat-native-crypto-target cargo +1.90.0 test --locked --manifest-path apps/mobile/modules/awsemchat-crypto/rust/Cargo.toml
```

Build on the validated macOS host (from `apps/mobile`):

```sh
rustup target add aarch64-linux-android --toolchain 1.90.0
npx expo prebuild --platform android --no-install
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/erik/Library/Android/sdk ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
```

The local module's Gradle task builds the Rust library from source with `--locked --release`, packages `arm64-v8a`, and requests 16 KiB ELF alignment. No binary is committed. The current build task selects the macOS NDK host toolchain explicitly; Linux/Windows hosts and other ABIs are unvalidated. SDK 57 generates compile/target SDK36, NDK27.1 and Kotlin2.1.20. Do not hand-edit generated `apps/mobile/android`.

With the dedicated debug app installed and Metro on 8081:

```sh
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d 'awsemchat://native-crypto-probe?run=1' com.moherik.awsemchat
adb -s emulator-5554 logcat -d -s ReactNativeJS:I | rg AWSEM_NATIVE_CRYPTO_PROBE
```

The route requires `__DEV__` and `run=1`. It runs once per mount, with a module-level in-flight guard. No production screen links to it. It emits START and then PASS with verified fixed labels, or FAIL with a single sanitized code. Neither logs nor screen expose handles, keys, content or namespace. Storage probe remains separate.

## What is proved

All device checks run the TypeScript facade → Expo Kotlin → JNI → Rust/vodozemac path. Four isolated synthetic accounts exist in one process. Their identities are fixtures trusted by construction, not supplied by a server.

- `BIDIRECTIONAL`: Alice-to-Bob initial ciphertext and Bob reply recover exact fixtures.
- `OUTSIDER_REJECTED`: outsider account cannot create inbound session from Bob ciphertext.
- `WRONG_IDENTITY_REJECTED`: Bob rejects initial ciphertext under Carol's supplied identity.
- `TAMPER_REJECTED`: a flipped MAC byte fails; intact original still decrypts.
- `REPLAY_REJECTED`: repeated ciphertext fails within the live session (not restart durability).
- `PREJOIN_EXCLUDED`: exact initial envelope set is Bob; Carol cannot create an inbound session from it.
- `JOIN_FANOUT`: exact subsequent set is Bob and Carol, each with separate Olm encryption; both recover their fixture and Carol replies.
- `REMOVED_FUTURE_EXCLUDED`: exact future set is Carol; Bob has no envelope and cannot decrypt Carol's ciphertext with his cached session; Carol can decrypt.
- `DISPOSED_REJECTED`: using a disposed session fails. Finally all accounts and owned sessions are disposed.

These are native primitive and fixture fanout proofs. The fixture explicitly chooses authorized sets. They do not prove server membership authorization, fetching rules, outbox reconciliation, generation revocation, original-audience promotion, rejoin policy, or prevention of a malicious sender sending to a removed member. Pairwise sessions themselves do not encode Circle membership.

## Ownership, failure and concurrency

An Expo module instance owns a native engine context stored in a Rust registry. JNI receives integer registry IDs, never dereferences caller pointers. Kotlin serializes execution against teardown; Rust's registry mutex serializes all engine operations. A disposed account drops every owned session. Module destruction drops its engine. A process restart loses all state. Native accounts and sessions never serialize through JavaScript. Handles use a process-wide monotonic allocator so references cannot alias objects from another live engine or a recreated engine. They are process-local references, not authentication capabilities.

Each engine admits at most 128 combined account/session handles; the process admits at most eight engines. JSON input is capped at 128 KiB in Rust and 128 Ki Java characters before JNI conversion. Outbound text is capped at 32 KiB UTF-8. Unknown fields, malformed keys/ciphertext and invalid handles fail closed. Kotlin/Rust error envelopes contain only fixed codes; the facade converts unavailable/unsupported modules to sanitized errors. Release Rust panics abort the process rather than unwinding across JNI; the library installs a no-output panic hook to suppress panic payload formatting. Allocation failure/process death is not recoverable via this interface.

Secret structures are native-owned and dropped through upstream destructors. This does not promise erasure of all heap copies. Plaintext necessarily crosses JavaScript/JVM/Rust for this experimental string API; immutable JS/JVM strings and serialization buffers are not reliably zeroizable. No private key/pickle/export API exists. No cryptographic primitives or plaintext fallback are implemented in JavaScript. Web and iOS explicitly reject on use.

One fresh one-time key is generated per synthetic account. The public bundle exposes it until consumed by inbound establishment; exhaustion fails rather than silently replenishing/publishing. Production key upload, signatures, atomic consumption, replenishment, authenticated identity binding and delivery retries require a separate reviewed protocol.

## Production gates remain open

Do not wire this adapter into real or demo chat sends. Ratchets are mutated only in memory. A malformed UTF-8 plaintext rejection may already have advanced native receive state; validation and ratchet commits are not transactional in this prototype. A successful encrypt/decrypt result is not a durable transaction and cannot be retried safely after process death. Before production, protect identity/session snapshots with native Keystore wrapping and SQLCipher; commit ratchet state plus outbox/inbox/event deduplication atomically before exposing successful send/receive. Define rollback/recovery behavior and prove crash safety, no send-key reuse, secure restoration and replay handling across restart. Existing encrypted-history storage is not coupled to these handles.

Persist trusted first-contact identity/history, implement the approved optional safety-code policy and stop sending on changed identity until acknowledgement. The probe's wrong-identity check is not key-directory authentication and does not defeat active server substitution on unverified first contact. Signed/prekey bundles, protected-header serialization/authentication, transferable provenance, media AEAD, native secret persistence, backup, transport authorization, real-device behavior and iOS remain unvalidated.

References used: [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/), [Expo Modules API](https://docs.expo.dev/modules/module-api/), [Expo documentation index](https://docs.expo.dev/llms.txt), installed vodozemac 0.11.1 Rust source/API and existing locked host tests.

## Recorded evidence — 2026-10-10

Source baseline `c0c14b16593aa2de38601b459c4a3da6c42e7c00` plus the bridge changes committed with this document. Expo 57.0.27 / React Native 0.86.3 / create-expo-module 57.0.1; Rust/Cargo 1.90.0; vodozemac 0.11.1; JNI 0.21.1; JDK17; Gradle9.3.1; compile/target SDK36 / build-tools36.0.0 / NDK27.1.12297006 / Kotlin2.1.20. ARM64 only. The module ELF LOAD segments have 0x4000 alignment; this is not whole-app 16 KiB device certification.

Full CNG Android debug build: `BUILD SUCCESSFUL in 4m 51s`, 385 actionable tasks. Final incremental build after handle/panic hardening: `BUILD SUCCESSFUL in 13s`, 28 executed / 357 up-to-date. APK installed successfully on the dedicated emulator; Metro8081 and adb reverse8081 were used. No native generated project files are committed.

```text
List of devices attached
emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1
ro.product.cpu.abi: arm64-v8a
ro.build.version.sdk: 33

10-10 17:04:19.080  6253  6337 I ReactNativeJS: 'AWSEM_NATIVE_CRYPTO_PROBE', '{"status":"START","synthetic":true}'
10-10 17:04:19.128  6253  6337 I ReactNativeJS: 'AWSEM_NATIVE_CRYPTO_PROBE', '{"status":"PASS","synthetic":true,"checks":["BIDIRECTIONAL","OUTSIDER_REJECTED","WRONG_IDENTITY_REJECTED","TAMPER_REJECTED","REPLAY_REJECTED","PREJOIN_EXCLUDED","JOIN_FANOUT","REMOVED_FUTURE_EXCLUDED","DISPOSED_REJECTED"]}'
```

Locked offline host adapter test output:

```text
running 4 tests
test handles_do_not_alias_between_engines ... ok
test invalid_crypto_input_and_plaintext_limit ... ok
test exchange_rejection_and_lifecycle ... ok
test malformed_oversized_and_exhausted_inputs ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
```

Mobile `npx tsc --noEmit` and `npx expo lint` both exited 0. The host tests cover the same native core plus malformed/unknown-field input, size/capacity limits, prekey exhaustion, account-cascade disposal and engine handle isolation. No physical device, iOS, process-death durability, backend authorization or real-account data was exercised.
