# Provider feasibility

Checked 2026-10-10. These are documentation findings, not account-level integration tests.

## Spotify

[Official quota documentation](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) limits development apps to five allowlisted authenticated users and requires a Premium account for the app owner. Public extended-quota applications are for organizations, with published requirements including an active launched service and at least 250,000 monthly active users. Therefore public Spotify access cannot be assumed for AwsemChat's initial launch. A user decision is pending: retain limited testing and defer public availability, or investigate Android music integration. Do not remove the feature from the agreed spec silently.

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
