# Android authentication session evidence

2026-10-11, authorized ARM64 Android API33 emulator `emulator-5554`, installed development app `com.moherik.awsemchat`, Expo57, local Go API on port8088 with mock SMS and PostgreSQL17. Synthetic phone, account and token only. No real SMS is sent.

The development-only `native-auth-probe` route uses the production API client, serialized session owner and native SecureStore adapter. Tokens and codes are never emitted in probe logs. `run` is an eight-digit synthetic fixture identifier, not account data. The vault scope is separate from normal application authentication.

## Observed run

- `awsemchat://native-auth-probe?run=10112201&phase=start`, PID25722: PASS at21:07:06. Native HTTP challenge/verification, SecureStore write and device binding succeeded.
- Force-stop PID25722 with `adb shell am force-stop com.moherik.awsemchat`; subsequent `pidof` returned no PID.
- `awsemchat://native-auth-probe?run=10112201&phase=resume`, new PID26176: PASS at21:07:57. Persisted installation ID matched, native SecureStore reopened the session, Go revalidated account/device/generation, and logout removed the session.
- The `am start -W` observation reported a timeout, but the new process and sanitized probe log independently proved completion. No duplicate restart was launched.
- Metro was already listening on IPv6 `::1:8081` (PID58739); an IPv4 status check missed it. A duplicate startup attempt exited with EADDRINUSE. The original process was retained.

## Reproduce

Run the explicit local API migration and server from `services/api/README.md`. Use the ARM64 development APK and connect Metro. For a new test, choose a fresh eight-digit `run`; reusing a completed fixture intentionally fails because its OTP has been consumed.

```sh
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 reverse tcp:8088 tcp:8088
adb -s emulator-5554 shell "am start -a android.intent.action.VIEW -d 'awsemchat://native-auth-probe?run=10112202&phase=start' com.moherik.awsemchat"
adb -s emulator-5554 logcat -d -s ReactNativeJS:I
```

Wait for the matching sanitized `AWSEM_NATIVE_AUTH_PROBE` PASS before force-stop. Confirm no app PID, then launch the same fixture with `phase=resume`. Do not clear app data or unrelated vault entries.

## Limits and remaining work

This proves native storage restart and the actual Android-to-Go-to-PostgreSQL authentication boundary. It does not prove a real SMS provider, physical-device biometric behavior, iOS execution, production TLS deployment, login-screen navigation, full session-to-native-crypto generation binding, or server transports not yet implemented. User-approved mock SMS is development only. SecureStore is encrypted OS storage; host tests with boundary doubles are not encryption proof. Mobile regression suite:36passed; TypeScript and Expo lint passed. Host Node module-format and experimental-SQLite warnings remain classified baseline warnings.

## Account-bound native encryption

Fresh fixture `10112203` authenticated on PID26281 at21:13:10, then survived a force-stop. The new `bind` phase first failed as expected against an unavailable wrapper (PID26398,21:13:50). An initial implementation then exposed `STATE_UNAVAILABLE`: native storage deliberately does not distinguish an absent namespace from damaged existing state on a bundle read. The corrected wrapper requests initialize first and reopens only on `ALREADY_EXISTS`; it never resets corrupt state or lost keys.

PID26678 passed the corrected native binding phase at21:16:38: account-scoped crypto initialized, reopening retained the same native public keys, and a retained adapter rejected access after logout. No account keys, codes, phone numbers or tokens were logged. This proves the wrapper against the actual Android native bridge; it does not yet prove replacement-generation messaging through the future server transport.

Namespace derivation hashes a canonical tuple of backend origin, account ID, installation device ID and server session generation. A 128-bit digest prefix produces `acct-` plus32hex characters within the native40-character namespace bound. The binding is immutable. Every operation checks the current authenticated session before native work and before returning its result, so a retained adapter cannot serve another account or generation. Existing native corruption/key-loss failures remain terminal; no automatic reset is introduced. Native storage currently has an eight-namespace capacity limit; generation retirement and archival-history retention must be resolved before declaring the full production lifecycle complete.

Updated mobile regression suite:39passed, TypeScript and Expo lint passed.
