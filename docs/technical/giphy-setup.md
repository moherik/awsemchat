# GIF provider setup

Android and iOS production chat use a client-side GIPHY picker for trending GIFs, search, category pills and favorites. Requests are sent directly from the app to GIPHY with a G rating and 24-result pages. Search sends only the exact search text and API key; it does not include AwsemChat account IDs, chat text, or recipient data. Favorites are local SQLite records containing only the GIPHY ID and title; the picker reloads current media URLs from GIPHY when Favorites opens. GIPHY media previews use `expo-image` with caching disabled.

Selecting a result opens an in-app preview and caption field. On send, the app downloads the `downsized` GIF rendition from GIPHY, checks HTTPS/provider host, `image/gif` content type, and the existing 2 MiB encrypted-media limit, then sends the bytes through the production private or Circle photo-message editor. The editor encrypts the media, uploads only ciphertext, records a durable operation for retry, and sends an encrypted message whose media descriptor uses `image/gif`. The existing shared-media gallery and full-screen viewer recognize and animate these GIF messages. No Go API schema change is needed; the server continues to store/relay opaque encrypted message data and ciphertext media.

Create separate keys per platform in https://developers.giphy.com/dashboard/ and set these in `apps/mobile/.env.local`:

```
EXPO_PUBLIC_GIPHY_ANDROID_KEY=your_android_key
EXPO_PUBLIC_GIPHY_IOS_KEY=your_ios_key
```

Expo public variables are included in the client bundle, so these are public provider keys and must not be treated as secrets. Rebuild/export after changing them. If a key is missing the picker shows an unavailable message; it does not fabricate sample results. UI and API behavior are covered by local tests, but live key/provider acceptance and Android device acceptance have not been performed.

GIPHY requires a conspicuous Powered by GIPHY attribution wherever the provider is used, requires client-side Search and Trending requests, and prohibits caching its media URLs or assets without explicit approval. The picker shows textual attribution and disables its image cache; obtain/verify approved attribution artwork and appropriate production API access before public release. See the [GIPHY quickstart](https://developers.giphy.com/docs/api/quick-start-guide/), [Search endpoint](https://developers.giphy.com/docs/api/endpoint/search/), [Get GIFs by ID endpoint](https://developers.giphy.com/docs/api/endpoint/), and [rendition guide](https://developers.giphy.com/docs/optional-settings/).
