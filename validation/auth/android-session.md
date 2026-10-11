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
