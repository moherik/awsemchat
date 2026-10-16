# Native push notifications

AwsemChat push notifications are optional and deliberately generic. Expo Push sends only the device token, title `AwsemChat`, body `You have a new message`, a generic event type, and a short TTL. Message text, sender names, Circle names, photos, and conversation IDs are never sent to Expo. Users can disable notifications for this phone, and per-chat mute preferences are mirrored to the API so muted conversations are filtered before push delivery.

## Native flow

The Android Settings screen requests the operating system's notification permission only after the user chooses **Turn on notifications**. On Android it creates the `messages` channel before requesting permission, obtains an Expo push token for the configured EAS project, and registers the token with the authenticated API session. Registration is bound to the account's current device generation; the service retains one active push device per account. The UI stays disabled until an EAS project ID is configured. Android emulators can be used when they include Google Play services. Turning alerts off removes the server registration.

The client stores chat mute preferences in its encrypted local database and sends the normalized muted conversation IDs to the authenticated notification preferences endpoint. On foreground resume it reconciles the current local mute list. The server also removes queued notifications for conversations muted after queueing.

## API and delivery

- `GET /v1/notifications/device`: check whether this account generation is registered.
- `POST /v1/notifications/device`: register an Expo token and initial muted conversation IDs.
- `PUT /v1/notifications/preferences`: replace this phone's muted conversation IDs.
- `DELETE /v1/notifications/device`: unregister this phone.

Message creation adds recipient notification jobs to a durable PostgreSQL outbox in the same transaction. The API worker leases and retries jobs, discards jobs for revoked generations, muted conversations, or expired Expo tokens, and limits retries. Only ordinary text, Ping, and Pong events enqueue alerts; control events and media-only events do not. Push payloads remain generic even when the underlying event is encrypted content.

## Deployment still required

This integration is implemented locally, but live push delivery is not configured or verified. Before using it on a device:

1. Link the mobile app to an EAS project so `Constants.expoConfig.extra.eas.projectId` resolves, or provide `EXPO_PUBLIC_EAS_PROJECT_ID` in the native build environment.
2. Configure Android FCM credentials for the EAS project and create a development build. Install it on a physical Android phone or an emulator with Google Play services. Expo Go is not the acceptance target for remote push.
3. Apply migration `018_notifications.sql` to the hosted PostgreSQL database and deploy the API worker with outbound HTTPS access to Expo Push.
4. Test opt-in, OS denial, delivery, mute/unmute, sign-out/account replacement, and unregister on Android hardware or a Google Play emulator.

The repository test suite covers payload minimization, device API authorization and validation, registration, mute filtering, outbox behavior, retry policy, native opt-in UI, and native route wiring. PostgreSQL-backed integration tests require `AWSEM_TEST_DATABASE_URL`; emulator/device acceptance was skipped at the owner's direction.
