# GIF provider setup

The picker uses GIPHY client-side trending and search, with 24-result pages and a G rating. Search text is sent to GIPHY; chat content and account identity are not included in API requests. Selecting a GIF opens the existing caption preview before sending.

Create separate keys per platform in https://developers.giphy.com/dashboard/ and set these in apps/mobile/.env.local:

```
EXPO_PUBLIC_GIPHY_ANDROID_KEY=your_android_key
EXPO_PUBLIC_GIPHY_IOS_KEY=your_ios_key
EXPO_PUBLIC_GIPHY_WEB_KEY=your_web_key
```

Expo public variables are included in the client bundle. Rebuild/export after changing them. Without a key the picker explains configuration instead of pretending to return live results. Live provider behavior has not yet been verified with account keys.

Before public release, obtain appropriate production access and use GIPHY's approved attribution artwork per https://developers.giphy.com/docs/api/quick-start-guide/. Current demo displays textual attribution.
