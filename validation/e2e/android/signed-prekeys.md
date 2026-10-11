# Signed prekey foundation

Design before implementation, 2026-10-11. vodozemac pinned to 0.11.1; production transport stays gated.

## Exact contract

`SignedPublicBundle` has exactly `version: 1`, `context: "awsemchat.olm.signed-prekey"`, `publication` (1..128 ASCII alphanumeric or `._:-`), `keyId` (upstream 8-byte key ID), `identity` (Curve25519), `signingIdentity` (Ed25519), `prekey` (Curve25519), `issuedAt` and `expiresAt` (Unix seconds, unsigned integers), and `signature` (Ed25519). All binary JSON fields use canonical standard unpadded base64; reject alternate encodings, unknown fields, unknown version/context, malformed keys/signature. Expiry is exactly issuedAt + 604800 seconds (7 days).

Signature input is these bytes, in order: ASCII `awsemchat.olm.signed-prekey` followed by NUL; version as 4-byte big-endian integer; raw identity (32 bytes); raw signingIdentity (32); raw keyId (8); raw prekey (32); issuedAt and expiresAt as 8-byte big-endian integers each; publication byte length as 2-byte big-endian integer; publication ASCII bytes. JSON order/whitespace never enters the signature. Native Account::sign creates signatures; pinned Ed25519PublicKey::verify uses upstream strict verification.

Durable outbound checks the existing pin quarantine, matches BOTH bundle identities against that pin, validates encoding/version/context/time, and verifies the signature before creating a session. It rejects a previously used encryption-identity/prekey pair even after a pin revision changes. The outbound replay ledger retains at most512 entries and never evicts. An existing session is not replaced. TOFU still does not authenticate the first server identity; this signature prevents key substitution against an already trusted pin, not first-contact server impersonation.

## Publication and consumption

Initialize/bundle return identity keys only. `preparePublication(operation)` saves an immutable signed batch before exposing it, generating enough real one-time keys to bring the retained private-key count to20. Each fresh batch needs at least one vacant slot. Only one unconfirmed batch is allowed; generation never evicts a retained private key. `confirmPublication(operation)` acknowledges exactly that saved batch and calls upstream mark_keys_as_published only when it is the current pending batch. Replaying an older confirmed acknowledgement is a no-op, so it cannot mark a newer batch's keys. Retry of any saved operation returns the identical batch (including original timestamps) before and after confirmation or consumption. The ledger holds64 batches, then fails closed.

Confirmation must be called only after future authenticated transport proves the server accepted exactly that batch. It is a local acknowledgement, not server proof. There is no pretend server allocator/count endpoint. Private keys retained locally include keys already allocated by a server whose initial messages have not arrived. They are NOT server available inventory. Replenishment here replaces locally consumed keys only. A real server must atomically allocate once, deduplicate publication by account/device/operation, compare exact batch bytes, and retain allocation tombstones so a retry never resurrects consumed keys. A client cannot prove a malicious server never reissues a key. Two different senders can create sessions from a reissued public key, but only one new inbound session can consume the local private key.

Inbound uses the library's authenticated create_inbound_session, which removes the private key. Account pickle, session, replay marker and history commit together; invalid protected content discards the entire candidate including removal. Receive may finish after bundle expiry (delayed delivery); expiry only limits outbound initiation. Existing sessions decrypt later prekey-format messages without consuming another key. Fallback keys are not generated.

A lost publication response retries the same operation. Before-commit death exposes no batch; after-commit death preserves the batch. Consumption before-commit death leaves the key and event retryable; after-commit death leaves one session/history/replay record and the key removed. Native Android clock supplies issue/validation time; no JS clock or time override. Wall-clock rollback, privileged database rollback, server allocation correctness, future authenticated directory/device binding and controlled retirement of expired undelivered keys remain gates. Expired retained keys are not automatically removed or republished with new lifetimes: exhaustion stops publication until a separately designed retirement/recovery policy.

Snapshot version2 explicitly rejects version1 with STATE_VERSION. This synthetic foundation does not silently reset or reuse existing unsigned sessions. A production migration/re-enrollment policy remains required. The ephemeral native primitive probe stays separate and experimental.

## Primary API evidence

Pinned local Cargo source `vodozemac-0.11.1/src/olm/account/mod.rs`: sign169, max_number_of_one_time_keys180, create_inbound_session251..328 (verify then remove324), generate_one_time_keys338, stored_one_time_key_count349, one_time_keys358 (unpublished only), mark_keys_as_published398. `src/types/ed25519.rs`: verify389 uses verify_strict; signature from_base64437/to_base64442. `src/olm/account/one_time_keys.rs`: generation can evict at upstream capacity, so this adapter enforces its own lower bound before generation. Native source is authoritative for this pinned build; docs.rs fetch was unavailable. API links: https://docs.rs/vodozemac/0.11.1/vodozemac/olm/struct.Account.html and https://docs.rs/vodozemac/0.11.1/vodozemac/struct.Ed25519PublicKey.html. Expo module API checked against https://docs.expo.dev/modules/module-api/ and SDK57 https://docs.expo.dev/versions/v57.0.0/.

## Verification, 2026-10-11

Host Rust:23/23 (2 canonical/expiry/transaction-bound tests,4 ephemeral adapter tests,9 durable regressions,8 signed lifecycle tests). The seven initial signed lifecycle tests all failed on the baseline's missing publication API/version rejection before implementation. Coverage includes exact canonical bytes independently verified by upstream Ed25519; tampered prekey/identities/signature/publication/keyId, malformed/alternate base64, unknown version/domain, expiry boundaries, unsigned outbound rejection, pin quarantine, outbound reuse after identity roundtrip, real64-batch capacity, exact publication retries, stale acknowledgement isolation, unacknowledged-publication consumption, transaction rollback, reissued consumed keys, and prior snapshot rejection. A full use-ledger fixture exercises fail-closed capacity at the transaction boundary.

Mobile typecheck and Expo lint exited0; all17 mobile Node tests passed. Existing Node module-type and experimental SQLite warnings remain in the broad suite. Native ARM64 debug build succeeded in39s (385 tasks;28 executed), with the existing Gradle10 deprecation summary and no Rust/Kotlin compiler warnings. Formatting used installed stable rustfmt because the pinned1.90 toolchain lacks rustfmt; compilation/tests still use1.90.

Commands from repo root (mobile checks run in `apps/mobile`):

```sh
CARGO_TARGET_DIR=/private/tmp/awsemchat-native-crypto-target cargo +1.90.0 test --locked --offline --manifest-path apps/mobile/modules/awsemchat-crypto/rust/Cargo.toml
cargo +stable fmt --manifest-path apps/mobile/modules/awsemchat-crypto/rust/Cargo.toml --check
cd apps/mobile
npx --no-install tsc --noEmit
npx --no-install expo lint
node --experimental-strip-types --test tests/*.test.mjs
```

Build from repo root:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/Users/erik/Library/Android/sdk apps/mobile/android/gradlew -p apps/mobile/android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
adb -s emulator-5554 install -r apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 shell am force-stop com.moherik.awsemchat
adb -s emulator-5554 shell "am start -a android.intent.action.VIEW -d 'awsemchat://durable-crypto-probe?run=1&phase=prekeyFull' com.moherik.awsemchat"
adb -s emulator-5554 logcat -d -s ReactNativeJS:I
```

Run `prekeyResume` in a new process immediately after `prekeyFull`. For each crash pair below, substitute its phase in the quoted URL, verify `adb shell pidof com.moherik.awsemchat` returns empty after the crash phase, then launch its recovery phase. The new harness uses the same4 reserved synthetic probe namespaces as the old harness, so run each crash/recovery pair consecutively. No ADB UI input is used. Fixed logs contain checks only; the checkpoint contains a digest of the public batch, never private state.

| Phase | Observed result / PID |
| --- | --- |
| prekeyFull | PASS19687: valid signatures, tamper/unsigned rejection, publication rollback/lost reply, exact retry, stale ack isolation, consumption rollback/lost reply, consumed-key reissue rejection, replenishment |
| prekeyResume | PASS19795: exact signed batch digest, consumed event replay/history and replenishment persisted across process death |
| prekeyCrashPublicationBefore | Process dead |
| prekeyRecoverPublicationBefore | PASS20003: zero retained keys/pending batch after rollback, fresh publication verifies |
| prekeyCrashPublicationAfter | Process dead |
| prekeyRecoverPublicationAfter | PASS20223:20 retained keys and pending initial batch committed; retry/confirmation/signature valid |
| prekeyCrashConsumptionBefore | Process dead |
| prekeyRecoverConsumptionBefore | PASS20443:20 keys/no history initially, retry consumes one and appends one history record, replenish one |
| prekeyCrashConsumptionAfter | Process dead |
| prekeyRecoverConsumptionAfter | PASS20648:19 keys/one history already committed, replay rejected, replenish one |

These are real Android process kills through the existing native transaction fault controls, not handle disposal or simulated restarts. They do not prove power-loss durability, hardware/OEM backup behavior, server authentication/allocation, iOS or physical-device behavior. Production transport remains gated.

Existing durable probes also passed through the signed API: `full` PID20752, `pinResume`20869, `seed`20977, `resume`21095, `recoverBefore`21480 and `recoverAfter`21792. Both old send crash phases were observed dead. This retains the earlier outbox/ratchet, identity quarantine/exhaustion, history-only restore, corrupt seal/key loss and version checks. The separate ephemeral primitive adapter was unchanged and its4 host tests passed.

The strengthened consumption recovery probe also sent a reply from the recovered inbound session and decrypted it at the original sender. Both repeated crash pairs passed: before-commit recovery PID22010 and after-commit recovery PID22210, each reporting `RECOVERED_SESSION_BIDIRECTIONAL` alongside the key-count/history/replay/replenishment checks. Final mobile typecheck/lint exited0 after this harness addition.
