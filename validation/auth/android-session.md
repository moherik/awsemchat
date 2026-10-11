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

## Native login controller and screen

2026-10-11, fixture10112204, PID26967: the `flow` phase passed at21:32:35 against the real local Go/PostgreSQL server, native SecureStore and native durable encryption. It exercised phone-to-code, verification-to-native-crypto, persistence-before-ready and logout-to-phone using the same login controller as the screen. This exercises the controller boundary; it is not a direct tap-through of every screen control.

The `/auth` screen and native `/flow?view=phone` / `/flow?view=verify` now use real authentication rather than the constant demo code. Screenshot `android-phone-entry.png` shows the rendered phone entry screen with empty input and readable status-bar icons. Phone/code keyboards and length bounds were added without changing default shared fields. Feedback uses the existing snackbar. A local-only development-code action avoids exposing endpoint instructions in the product flow. There is no development-code action in a release build, and the API helper rejects non-loopback or nondevelopment use.

The first new-route launch produced Unmatched Route because the previous task-owned Metro instance retained a cached route manifest. Its cwd and listener were verified before restarting it. The refreshed Metro process is PID16264/session28003 on IPv6localhost8081; cold Android bundling completed successfully. No unrelated server or account data was removed. ReactNativeJS error logs were empty after the rendered screen check.

Full mobile suite47passed; TypeScript and Expo lint passed. Login logic rejects concurrent submissions, preserves an operation ID after ambiguous requests/resends, keeps incorrect-code input on the verification step, and prevents ready state until native encryption setup succeeds. Failed preparation can be retried without replaying OTP verification.

Remaining acceptance includes direct screen interaction across themes/keyboards, application-wide auth gating and real social/chat data, foreground replacement-session revalidation, archival generation retirement, and real SMS provider configuration when the owner selects one. The current successful sign-in view explicitly labels chat/Circle sync as still under development. It does not route a live account into sample conversations or claim the full MVP is complete.
