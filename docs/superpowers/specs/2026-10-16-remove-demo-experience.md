# Remove the Demo Experience

**Status:** Draft for review  
**Date:** 2026-10-16

## Goal

AwsemChat should open as the real mobile application on Android, using the existing authenticated production screens and services. The web build is not a sample application or a second product surface. Remove its demo conversations, sample accounts, and simulated actions so nobody can mistake local sample data for real AwsemChat data.

Keep the production native routes and their current behavior. When someone opens AwsemChat in a web browser, show a small, deliberate page explaining that AwsemChat is available in the mobile app. That page must not load production native modules or initialize sample data.

## Current evidence

- Android already selects the production home and chat screens, while web selects `DemoChatApp` from `src/app/index.tsx` and `src/app/chat.tsx`.
- The `/flow` route selects `NativeFlows` on native platforms but renders `DemoFlows` on web. The sticker route likewise contains a demo-backed web implementation.
- Demo state is centralized in `features/demo-store.ts`; sample conversations and identities are in `features/sample-data.ts`. Demo-only consumers include the old chat app, demo flows, GIF and sticker pickers, and web palette preference.
- A successful Android export currently contains the demo chat, demo flows, sample data, demo store, and web-oriented picker/viewer modules in its source map, even though Android chooses native screens at runtime.
- A web export currently fails while resolving the SQLite web WASM dependency pulled in by a production chat dependency. Platform-specific route modules can prevent web from importing those native modules.

## Design

### Route ownership

- Keep Expo Router's generic route files so existing paths and deep links remain stable.
- Move platform selection behind platform-resolved feature modules outside the route directory. Native modules own `/`, `/chat`, `/flow`, and `/stickers` and render the existing production screens. Web modules for those paths render the same lightweight unsupported-platform page.
- The web page gives a clear next step to use the Android or iOS app. It does not expose demo data, mock sign-in, fake SMS, or simulated messaging controls.
- Keep the existing native route parameters and navigation behavior, including private chat, Circle, flow, and sticker maker links.

### Demo removal

- Remove the demo chat app, demo flow implementation, in-memory demo store, sample conversation data, and demo-only web pickers/viewers once their remaining imports are removed.
- Remove demo-only UI branches and exports from shared features. Keep shared production components only when a native route still uses them.
- Remove tests that assert the deleted demo behavior. Keep and extend native production tests; do not weaken production behavior or coverage to make deletion easier.
- Remove any demo-specific package scripts or documentation that imply the sample app remains a supported product surface.

### Production behavior and boundaries

- Do not change API contracts, encryption, persistence, message delivery, Circle behavior, media handling, or authentication as part of this work.
- Do not introduce a web client or backend connection for the browser page.
- Android is the primary verification target. Existing native iOS resolution should continue to compile through the same production screens.
- This change does not claim that backend services, Google Drive, Supabase, or SMS credentials are configured; their existing runtime gates remain authoritative.

## Acceptance criteria

1. Android opens the production home, chat, flow, and sticker screens with no demo route selection.
2. An Android export succeeds, and its source map contains none of the removed demo implementation modules or sample data.
3. A web export succeeds and renders only the unsupported-platform page for app routes; it does not bundle the demo store, sample data, production native messaging screen, or native SQLite/GIF dependencies.
4. Existing native route paths and route parameters continue to work for home, private chat, Circle chat, account flows, and sticker management/maker.
5. No production test is deleted or reduced merely because a demo counterpart is removed. Obsolete demo tests are replaced, where needed, by route-boundary or bundle-content regression tests.
6. The mobile unit/UI suite, TypeScript check, Expo lint, Android export, web export, and Android native build pass.

## Risks and responses

- **A route may still reach a demo helper through a shared component.** Use dependency/bundle checks to find residual imports, then split or remove the demo branch at the shared boundary.
- **A platform-specific route may break direct links on web.** Preserve generic Expo Router route files and route parameters; make only their imported surface platform-specific.
- **A browser page could accidentally import native dependencies.** Keep the web entry module independent and make web export part of the acceptance checks.
- **Demo tests may contain useful behavior coverage.** Preserve equivalent tests for production behavior before deleting demo-only test files.

## Verification evidence to record

Record the exact commands and results for the mobile tests, TypeScript, lint, Android export/source-map audit, web export, and Android native build. Also record a concise source-map check showing that demo modules and native-only modules are absent from their respective platform bundles.
