# Current implementation workspace

Updated2026-10-12 following the owner’s instruction to work in the original project folder.

The canonical checkout is `/Users/erik/Developer/projects/awsemchat`, branch `codex/awsemchat-mvp`. Production commits through `e4f8e70` were integrated by a fast-forward merge from the isolated worktree. Both checkouts were clean before integration; no newer source changes were overwritten. All subsequent implementation belongs in this original checkout. Earlier validation documents mentioning the production-foundation worktree describe historical evidence, not the current execution location.

The committed mobile lockfile was installed in the original folder from cached packages. All64 mobile tests, TypeScript and Expo lint with --no-cache pass here. The first sandboxed HTTP test run failed with localhost EPERM, and the initial lint cache retained errors from missing packages; rerunning with localhost access and a fresh lint pass resolved both. Full backend tests against the isolated local PostgreSQL17 database pass with race detection, followed by go vet.

The task-owned Android Metro server on8081 and mock-SMS Go API on loopback8088 were moved to this checkout. The separate8099 web demo was not deliberately restarted. Verify current process ownership and listeners before further lifecycle actions; recorded process IDs are not permanent evidence. No remote push or deployment was performed during integration.

The old managed worktree is retained temporarily because ignored native build artifacts may still be needed for reproducibility. It is no longer the implementation checkout. The entire MVP objective remains active; this integration does not complete encrypted messaging, profiles, media, backup integration or the final device acceptance gates.
