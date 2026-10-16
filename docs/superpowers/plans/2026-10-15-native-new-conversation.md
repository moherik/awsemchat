# Native new-conversation picker implementation plan

> Inline TDD implementation. Preserve all existing staged and unstaged shared work.

**Goal:** Replace the native demo-backed New conversation picker with accepted friends from the authenticated paginated friends controller.

**Behavior:** Keep Create a Circle first; provide search over loaded accepted friends, rounded-square avatar icons, compact accepted-friend identity, loading/empty/error/retry and pagination states, and route selected friend to the production private chat route. Current friend DTOs expose PINs but not encrypted profile display names or text status; show the PIN honestly and do not invent profile data. Keep web demo unchanged.

**Verification:** Failing-first native UI tests, full mobile behavior/UI suites, TypeScript, Expo lint and diff check. Device testing remains skipped by request.

## Steps

- [x] Add failing UI tests for auth gate, accepted friends/search, Circle creation navigation, private chat navigation, empty/error/pagination states.
- [x] Implement `NativeNewConversation` with existing authenticated friends controller and real chat routes.
- [x] Route native `new-chat` flow to the new screen while preserving web demo.
- [x] Run full verification and update project status / UI-backend handoff.
