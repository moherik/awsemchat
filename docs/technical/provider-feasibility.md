# Provider feasibility

Checked 2026-10-10. These are documentation findings, not account-level integration tests.

## Spotify

[Official quota documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) limits development apps to five allowlisted authenticated users and requires a Premium account for the app owner. Public extended-quota applications are for organizations, with published requirements including an active launched service and at least 250,000 monthly active users. Therefore public Spotify access cannot be assumed for AwsemChat's initial launch. The approved UI handoff records the user decision to explore Android music-app integration; Spotify Web API public access is not the selected launch dependency. Do not remove the feature from the agreed spec silently.

## Encrypted SQLite

[Expo SDK 57 SQLite documentation](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) exposes SQLCipher through a config plugin. Runtime validation requires a native build, not just a JavaScript unit test. No successful encrypted device-database probe has been recorded yet.

## Signal

[Signal's library documentation](https://github.com/signalapp/libsignal) provides Java/Android and Swift bindings and a Node native addon. Use outside Signal is unsupported; APIs may change. The repository is AGPL licensed. This requires a deliberate integration and license decision; do not import the Node addon into Hermes and assume it works.

## Candidate protocol probe

An isolated probe uses vodozemac 0.11.1, an implementation of Olm/Megolm. [Official API docs](https://matrix-org.github.io/vodozemac/vodozemac/olm/index.html) describe pairwise sessions. [GroupSession docs](https://matrix-org.github.io/vodozemac/vodozemac/megolm/struct.GroupSession.html) describe sender sessions and distribution over a secure pairwise channel. Native mobile binding, secure key persistence, authenticated identity distribution, and protocol review remain unverified. A successful host test would prove only primitive behavior, not that AwsemChat is securely implemented.

Supabase authorization, Drive account integration, background scheduling, and background-removal runtime probes remain pending.

## Android music-session alternative (2026-10-10)

Android's MediaSessionManager.getActiveSessions can expose playback controllers from other music apps when the user enables AwsemChat's NotificationListenerService. Ordinary apps cannot assume the privileged MEDIA_CONTENT_CONTROL permission. Reference: https://developer.android.com/reference/android/media/session/MediaSessionManager

This is feasible to prototype without Spotify Web API quota access, but requires a custom native Expo development build and explicit notification-access consent. Android exposes a broad permission; the app must explain that scope honestly even if its implementation only consumes music metadata. Support depends on each player publishing an active media session; it is not a guarantee of compatibility with every player.

Proposed implementation contract:
- Disabled by default; separate permission grant from sharing consent.
- Choose allowed music apps; consume only active-playing session title, artist, and source package. Do not consume notification bodies, artwork URLs, or playback controls.
- Clear shared state on pause, permission revocation, sign-out, and expiry. Send short-lived encrypted updates only to accepted friends; keep circle bubbles unchanged.
- Offer a visible pause switch; never infer listening from unrelated notification contents.
- Validate grant/revocation, multiple players, missing metadata, background updates and offline expiry on Android before shipping.
- Keep an iOS provider interface separate: this Android permission route does not establish iOS compatibility.

The user selected exploration of this alternative; native feasibility and permission UX remain to be validated before calling the feature implemented.

## Task 1 evidence update (2026-10-10)

Evidence levels: **documentation verified** means the official page was consulted today; **repository observed** means source/config was inspected locally; **proposal/inference** is an application design derived from those capabilities; **unverified runtime** needs actual native/provider execution. Documentation does not establish account eligibility, APK compatibility or device behavior.

| Area | Documentation verified | Repository/runtime status and decision |
| --- | --- | --- |
| Protocol | [vodozemac](https://github.com/matrix-org/vodozemac) Apache-2.0; [libsignal](https://github.com/signalapp/libsignal) AGPL-3.0 and unsupported external use; [OpenMLS](https://github.com/openmls/openmls) MIT with Android/iOS built but untested in upstream CI | Host vodozemac tests pass only for primitives. Candidate pairwise fanout and review gates are in [E2E design](e2e-design.md). No Expo bridge or production identity authentication exists. |
| SQLite | [Expo57 SQLCipher](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) supports Android/iOS native builds, requires `useSQLCipher` config and key immediately on opening; absent in Expo Go | App uses Expo ~57.0.27; no expo-sqlite dependency/plugin. Native key protection, DB wrong-key tests and restore are unverified. |
| Expo native modules | [Official module workflow](https://docs.expo.dev/modules/get-started/) scaffolds a local module, prebuilds and rebuilds native code | Kotlin/Rust binding next slice is specified in validation/e2e/README.md. No Hermes/JS substitute. |
| Supabase | [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) uses RLS on storage.objects; service keys bypass RLS | Proposed private ciphertext bucket, server-side grants and immutable audiences. No bucket, RLS or account-level test configured; never bundle service keys. |
| Drive | [Appdata folder](https://developers.google.com/workspace/drive/api/guides/appdata) uses non-sensitive drive.appdata scope; app-specific hidden space; user can delete data; it cannot be shared/moved/trashed like normal Drive files. [Scope documentation](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) lists drive.file as narrower per-file access | Prefer appdata for automatic archives; local export stays separate. No OAuth app/credentials or account test; consent/publishing verification must be checked for actual requested scopes. Hidden folder is not E2E encryption. |
| Backup scheduling | [Expo57 BackgroundTask](https://docs.expo.dev/versions/v57.0.0/sdk/background-task/) uses WorkManager on Android (minimum15min; execution after interval subject to conditions); iOS BGTaskScheduler chooses execution time | Backup schedule is best effort, with manual Backup now and last completed timestamp. Never promise exact clock time or continuous background music polling. No scheduler device probe. |
| Music | [MediaSessionManager](https://developer.android.com/reference/android/media/session/MediaSessionManager) requires privileged media permission or enabled notification listener for getActiveSessions; [listener service](https://developer.android.com/reference/android/service/notification/NotificationListenerService) documents service integration | User chose Android exploration. Native service, separate sharing consent, metadata minimization, TTL/revocation and player compatibility unverified. Broad permission scope must be explained; no iOS parity claim. |
| Background removal | Repository observed optional `ExpoBackgroundRemoval`, declared package ^0.1.0, local-output adapter | No dependency installed in this worktree; implementation/model license and network/privacy inspection pending. Device output quality and offline behavior unverified; never call crop a cutout. |

Spotify quota page checked today still states five allowlisted development users/Premium owner and organizational extended-quota eligibility including launched service and at least250k MAUs. Existing feature sample is not public-release authorization. No provider account purchases, new credentials or external deployments occurred.

The handoff's Android music alternative supersedes Task10's former Spotify-only interface. The approved UI remains unchanged. Technical implementation may proceed only through the native security harness while Task1 stays BLOCKED; dependent identity/messaging/media/backup production slices await verified contracts. Provider-specific permission/access blockers must be evaluated independently so an optional music provider does not justify weakening E2E.
