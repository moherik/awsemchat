# Remove Web and Demo Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not delegate subtasks. Steps use checkbox syntax for tracking.

**Goal:** Support AwsemChat only on Android and iOS, with production-native routes and no browser/demo app.

**Architecture:** Keep the existing Expo Router route paths, but make them resolve directly to production native screens. Explicitly limit Expo platforms to Android and iOS, remove web-only dependencies and demo modules after their callers are gone, and keep shared production features such as the photo viewer.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, TypeScript, Node test runner, Jest, Android Gradle.

**Spec:** `docs/superpowers/specs/2026-10-16-remove-demo-experience.md`

**Execution result (2026-10-16):** All four tasks completed. Unit/UI tests, TypeScript, lint, Android/iOS exports, source-map audits, Expo platform config, and Android debug build pass. Xcode is unavailable, so an iOS native build was not run.

## Global Constraints

- Android and iOS are the only supported platforms.
- Preserve production route paths and parameters for private chat, Circle chat, account flows, stickers, and sticker maker.
- Do not change API contracts, encryption, persistence, message delivery, Circle behavior, media handling, or authentication.
- Preserve shared production components such as `features/photos/viewer.tsx`.
- Keep the mobile behavior and UI test suites; remove only tests whose behavior is demo-only and preserve their production coverage.
- Do not run emulator interaction tests; the user previously asked to skip emulator testing.

## Review Focus

- **Expo defaults re-enable web:** Test the explicit platform list and absence of web runtime packages, app config, and scripts.
- **Routes still import demo code:** Assert the native route entry modules point to production screens and inspect both native source maps for removed demo modules.
- **Session routing bypass remains web-specific:** Test that only native authentication and development-probe exceptions bypass session gating.
- **Sticker maker loses native save behavior during demo cleanup:** Retain UI tests for personal encrypted save and Circle collection save paths.
- **Shared production UI is accidentally deleted:** Keep `PhotoViewer` and verify the production message screen still bundles and imports it.

---

### Task 1: Lock the project to Android and iOS

**Files:**
- Create: `apps/mobile/tests/native-platform-scope.test.mjs`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/package-lock.json`
- Delete: `apps/mobile/scripts/preview.mjs`
- Delete: `docs/technical/demo-preview.png`

**Interfaces:**
- Produces: package scripts `test:unit` and `test:ui`; Expo config `platforms: ["ios", "android"]`.

- [x] **Step 1: Write failing platform-scope tests**

Assert that `app.json` explicitly lists only `ios` and `android` and has no `web` config; `package.json` has no `web` or `demo:preview` command and no direct `react-dom`, `react-native-web`, or `@types/react-dom` dependency; `test:unit` exists; and the demo preview script and screenshot are absent.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `node --test tests/native-platform-scope.test.mjs` from `apps/mobile`  
Expected: FAIL because the current app config, package scripts/dependencies, and preview artifacts still expose web/demo support.

- [x] **Step 3: Implement the platform boundary**

Set Expo `platforms` to `ios` and `android`; remove the `web` app config; remove the web and demo-preview scripts; rename `test:demo` to `test:unit` without changing its test glob; remove only web runtime/type packages; update the lockfile; remove the demo preview server and screenshot.

- [x] **Step 4: Run focused tests and verify platform config**

Run: `node --test tests/native-platform-scope.test.mjs` and `npx expo config --json` from `apps/mobile`.  
Expected: tests pass and resolved config lists only `ios` and `android`.

### Task 2: Route every mobile entry to production screens

**Files:**
- Create: `apps/mobile/tests/native-route-boundary.test.mjs`
- Modify: `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/src/app/chat.tsx`
- Modify: `apps/mobile/src/features/flows.tsx`
- Modify: `apps/mobile/src/features/stickers/screen.tsx`
- Modify: `apps/mobile/src/features/auth/session-route-policy.ts`
- Modify: `apps/mobile/tests/native-flow-routes.test.mjs`
- Modify: `apps/mobile/tests/native-sticker-route.test.mjs`
- Modify: `apps/mobile/tests/native-palette.ui.test.tsx`
- Delete: `apps/mobile/src/features/app-home-policy.ts`
- Delete: `apps/mobile/src/features/chat-route-policy.ts`
- Delete: `apps/mobile/tests/chat-route-policy.test.mjs`
- Delete: `apps/mobile/tests/app-home-policy.test.mjs`

**Interfaces:**
- Consumes: `NativeHome`, `ProductionChat`, `resolveNativeFlow`, `resolveNativeStickerRoute`, and the existing session gate.
- Produces: route entry files that render the production screens without checking for web or falling back to demo UI.

- [x] **Step 1: Add failing route-boundary tests**

Assert that `/` imports and renders `NativeHome`; `/chat` imports and renders `ProductionChat` while preserving `peer`/`circle` params; `/flow` only renders `NativeFlows`; `/stickers` only renders native sticker screens; and no route entry references `Platform.OS === 'web'`, `DemoChatApp`, `DemoFlows`, or `WebStickerScreen`. Update the session-route test so web is no longer an allowed bypass.

- [x] **Step 2: Run focused route tests and confirm they fail**

Run: `node --test tests/native-route-boundary.test.mjs tests/native-flow-routes.test.mjs tests/native-sticker-route.test.mjs tests/session-route-policy.test.mjs` from `apps/mobile`.  
Expected: FAIL on existing demo branches and the web session bypass.

- [x] **Step 3: Point route files directly at production screens**

Simplify index and chat route selection, keep route parameters intact, make `/flow` use `NativeFlows` only, and make the sticker route use native storage and routes only. Remove the web bypass from `sessionRouteDecision` and update its input type/tests as needed. Remove the now-unused home/chat route policies and their web-specific tests.

- [x] **Step 4: Run focused route tests and native route UI tests**

Run: `node --test tests/native-route-boundary.test.mjs tests/native-flow-routes.test.mjs tests/native-sticker-route.test.mjs tests/session-route-policy.test.mjs` and the focused Jest suites for native home, chat list, appearance, and sticker maker.  
Expected: all current production route destinations still resolve and the route boundary tests pass.

### Task 3: Remove demo state and demo-only UI modules

**Files:**
- Modify: `apps/mobile/src/features/flows.tsx`
- Modify: `apps/mobile/src/features/stickers/screen.tsx`
- Modify: `apps/mobile/tests/sticker-maker-native.ui.test.tsx`
- Modify: `apps/mobile/tests/native-palette-demo-isolation.ui.test.tsx`
- Delete: `apps/mobile/src/components/animated-icon.web.tsx`
- Delete: `apps/mobile/src/components/app-tabs.web.tsx`
- Delete: `apps/mobile/src/components/web-badge.tsx`
- Delete: `apps/mobile/src/features/appearance-runtime.web.ts`
- Delete: `apps/mobile/src/features/feedback/overlay.web.tsx`
- Delete: `apps/mobile/src/features/photos/download.web.ts`
- Delete: `apps/mobile/src/hooks/use-color-scheme.web.ts`
- Delete: `apps/mobile/src/components/animated-icon.module.css`
- Delete: `apps/mobile/assets/images/tutorial-web.png`
- Delete: `apps/mobile/src/features/chat-app.tsx`
- Delete: `apps/mobile/src/features/demo-store.ts`
- Delete: `apps/mobile/src/features/sample-data.ts`
- Delete: `apps/mobile/src/features/gif-picker.tsx`
- Delete: `apps/mobile/src/features/stickers/picker.tsx`
- Delete: `apps/mobile/src/features/palette-preference.web.ts`
- Delete: `apps/mobile/src/features/popup-menu.tsx` (React DOM implementation; native menu remains)
- Delete: `apps/mobile/src/features/media-sheet.tsx` (unreferenced demo GIF picker wrapper)
- Delete: `apps/mobile/tests/demo-store.test.mjs`
- Delete: remaining web-only starter modules/assets listed in the implementation diff

**Interfaces:**
- Consumes: native appearance store, native GIF picker, production personal/Circle sticker stores, and existing `NativeFlows` routes.
- Produces: no imports or runtime state for sample conversations, fake profiles, demo backups, or simulated messaging.

- [x] **Step 1: Add failing checks for the demo-free dependency graph**

Extend `native-route-boundary.test.mjs` to assert removed modules are not referenced by production route or feature sources. Retain and strengthen tests proving the native palette reads the appearance store and sticker maker saves to encrypted personal storage or the authenticated Circle collection.

- [x] **Step 2: Run the tests and confirm they fail**

Run: `node --test tests/native-route-boundary.test.mjs` and Jest suites for native palette, sticker maker, Circle sticker library, and GIF picker.  
Expected: FAIL while demo imports and `updateDemo` fallbacks remain.

- [x] **Step 3: Remove demo branches and then delete unreferenced files**

Keep `NativeFlows` and remove `DemoFlows`; make sticker editor save only through native stores; remove demo-backed GIF/sticker pickers, every `*.web.*` module, and web-only starter UI/assets; remove demo app/store/sample data and demo-only tests. Preserve `features/photos/viewer.tsx`, `features/giphy/picker.tsx`, native sticker libraries, and native OAuth browser support.

- [x] **Step 4: Run the mobile suites and search for residual demo imports**

Run: `npm run test:unit`, `npm run test:ui`, `npx tsc --noEmit`, and `npx expo lint` from `apps/mobile`; then search tracked mobile source/config/docs for imports or commands referencing removed demo files and browser routes.  
Expected: all production tests pass, with no unresolved imports or demo UI references in shipped app code.

### Task 4: Verify native bundles and record the project status

**Files:**
- Modify: `docs/technical/project-status.md`
- Verify: Android and iOS Expo exports, Android Gradle build, mobile tests, TypeScript, and lint.

**Interfaces:**
- Consumes: the native-only project configuration and demo-free route graph.
- Produces: recorded platform export evidence and an updated Android conversion status.

- [x] **Step 1: Export Android and iOS bundles with source maps**

Run `npx expo export --platform android --source-maps --output-dir /tmp/awsemchat-android-native-only` and `npx expo export --platform ios --source-maps --output-dir /tmp/awsemchat-ios-native-only` from `apps/mobile`.

- [x] **Step 2: Audit both source maps**

Confirm neither map contains `chat-app.tsx`, `flows.tsx` demo symbols, `demo-store.ts`, `sample-data.ts`, `gif-picker.tsx`, or `stickers/picker.tsx`. Confirm `photos/viewer.tsx` remains because production chat uses it. Confirm `npx expo config --json` lists only Android and iOS.

- [x] **Step 3: Build Android and run all completion checks**

Run `./gradlew :app:assembleDebug` from `apps/mobile/android`, all tests, TypeScript, Expo lint, and `git diff --check` on changed files. Do not run emulator interaction tests. An iOS native build is conditional on Xcode being available; Expo iOS export is required regardless.

- [x] **Step 4: Update project status with evidence and limitations**

Record exact export, test, lint, typecheck, and Android build results; state that web support is removed; preserve open provider configuration, deployment, and device-acceptance items.
