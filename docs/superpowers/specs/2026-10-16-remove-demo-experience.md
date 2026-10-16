# Remove Web and Demo Support

**Status:** Implemented; verification complete
**Date:** 2026-10-16

## Goal

AwsemChat is a mobile app for Android and iOS. Remove browser support and the demo experience entirely so nobody can mistake local sample data for real AwsemChat data. The supported products are the native Android and iOS apps, using the existing production screens and services.

Keep the production native routes and their current behavior. Do not provide a browser app, web fallback screen, or web demo.

## Current evidence

- Android and iOS already select the production home and chat screens, while web selects `DemoChatApp` from `src/app/index.tsx` and `src/app/chat.tsx`.
- The `/flow` route selects `NativeFlows` on native platforms but renders `DemoFlows` on web. The sticker route likewise contains a demo-backed web implementation.
- Demo state is centralized in `features/demo-store.ts`; sample conversations and identities are in `features/sample-data.ts`. Demo-only consumers include the old chat app, demo flows, GIF and sticker pickers, and web palette preference.
- A successful Android export currently contains the demo chat, demo flows, sample data, demo store, and web-oriented picker modules in its source map, even though Android chooses native screens at runtime. `features/photos/viewer.tsx` is also bundled, but the production chat uses it and it must remain.
- The Expo app config contains web output settings, the mobile package has a `web` start script and web runtime packages, and the default platform set can include web when `react-dom` is installed.

## Design

### Native route ownership

- Keep Expo Router route files and existing paths/deep links for Android and iOS.
- Route `/`, `/chat`, `/flow`, and `/stickers` directly to the existing production screens. Remove platform checks whose only purpose is choosing demo UI.
- Preserve existing native route parameters and navigation behavior, including private chat, Circle, account flows, and sticker maker links.
- Explicitly configure Expo to support only `ios` and `android`. Remove web-only app config, the `web` start/preview workflow, and direct web runtime/type packages. Keep any Expo transitive packages required by native Expo modules. Expo SDK 57 documents that supported platforms can be set explicitly ([Expo app config](https://docs.expo.dev/versions/v57.0.0/config/app/)).
- Remove web-specific modules and branches, including `*.web.*` source modules, web-only palette preference, web demo pickers, and the browser demo route behavior. Remove unreferenced web-only starter components and assets as well. Do not replace them with an unsupported-platform page.
- Keep native features that open external browser views, such as OAuth, when they are used by Android or iOS; removing web support does not remove native browser APIs.

### Demo removal

- Remove the demo chat app, demo flow implementation, in-memory demo store, sample conversation data, and demo-only web pickers/viewers once their remaining imports are removed.
- Remove demo-only UI branches and exports from shared features, including the unused demo media sheet and React DOM popup. Route chat actions through the existing native popup component. Keep shared production components, including `features/photos/viewer.tsx`, when a native route uses them.
- Remove tests that assert the deleted demo behavior. Keep and extend native production tests; do not weaken production behavior or coverage to make deletion easier.
- Remove the web demo preview script and demo-specific documentation. Preserve the existing mobile test suite; rename any misleading test command such as `test:demo` rather than deleting tests that cover production behavior.

### Production behavior and boundaries

- Do not change API contracts, encryption, persistence, message delivery, Circle behavior, media handling, or authentication as part of this work.
- Android and iOS are the only supported platforms. Verify both platform bundles; do not require or generate a web export.
- This change does not claim that backend services, Google Drive, Supabase, or SMS credentials are configured; their existing runtime gates remain authoritative.

## Acceptance criteria

1. Android opens the production home, chat, flow, and sticker screens with no demo route selection.
2. Android and iOS exports succeed, and their source maps contain none of the removed demo implementation modules or sample data; shared production modules such as `features/photos/viewer.tsx` remain available.
3. Expo's resolved configuration and project scripts expose only Android and iOS; no web export target, web preview script, direct web runtime dependency, or web-only app surface remains.
4. Existing native route paths and route parameters continue to work for home, private chat, Circle chat, account flows, and sticker management/maker.
5. No production test is deleted or reduced merely because a demo counterpart is removed. The general mobile test suite remains runnable under a name that does not imply it only tests demo code.
6. The mobile unit/UI suite, TypeScript check, Expo lint, Android/iOS exports, and Android native build pass. Run an iOS native build when the available Xcode toolchain permits it.

## Risks and responses

- **A route may still reach a demo helper through a shared component.** Use dependency/bundle checks to find residual imports, then split or remove the demo branch at the shared boundary.
- **Removing web dependencies could expose a native feature that accidentally imports them.** Audit resolved imports and keep dependencies used by native features, even if their names mention web (for example, a native browser/auth module).
- **Expo could continue treating web as supported through defaults.** Set the app's supported platform list explicitly and remove packages that activate default web support.
- **Demo tests may contain useful behavior coverage.** Preserve equivalent tests for production behavior before deleting demo-only test files.

## Verification evidence to record

Record the exact commands and results for the mobile tests, TypeScript, lint, Android and iOS export/source-map audits, and Android native build. Also record a concise source-map check showing that demo modules are absent from both native bundles and that web is not among the configured platforms.
