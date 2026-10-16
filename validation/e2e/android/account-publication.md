# Native account publication signing

Recorded 2026-10-12 in the canonical project workspace. This verifies native signing on the Android emulator; it does not verify a live server publication endpoint or complete encrypted messaging.

The ARM64 debug APK built successfully in 1m55s (385 tasks, 186 executed). The original attempt exhausted disk space. After interruption, the previous process and APK were absent; the resumed build used two workers and in-process Kotlin compilation. Generated Android files remain ignored. Gradle and dependency deprecation warnings remain.

The APK was installed on emulator-5554, using Metro on port8081. The development-only durable probe was opened with `awsemchat:///durable-crypto-probe?run=1&phase=prekeyProof`.

Checks passed through TypeScript, Kotlin, JNI and Rust:

- `ACCOUNT_PUBLICATION_PROOF_NATIVE`: the saved twenty-key batch returns a public registration and signature.
- `PROOF_RETRY_EXACT`: repeated signing returns identical registration bytes.
- `SIGNING_DOES_NOT_CONFIRM_KEYS`: signing leaves prekey publication status unchanged.
- `INVALID_PROOF_REQUEST_REJECTED`: unknown operation and zero generation reject with the expected fixed codes.

After force-stopping the app and reopening with phase `prekeyProofResume`, `ACCOUNT_PUBLICATION_PROOF_EXACT_PROCESS_RESTART` passed in a new process. The persisted checkpoint matches the newly signed registration exactly. No private keys or public bundle values were logged; console evidence contains only fixed check labels.

The earlier full durable harness also passed on this APK. All66 mobile tests, TypeScript and lint checks passed. The previous host Rust suite and Go native-fixture verification are separate evidence of signature interoperability; this device probe checks native execution and persistence, not independent cryptographic verification by a running Go server.

Remaining: authenticated registration persistence, publication acknowledgement/retry, authorized allocation, native account-session integration walkthrough and complete two-device encrypted messaging.
