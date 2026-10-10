# Encrypted backup contract and native gate

Date: 2026-10-10. Status: proposed format; export/import implementation and device SQLCipher validation **not run**. No host AES test is presented as native SQLite proof.

## Proposed archive v1

Use a reviewed native authenticated-encryption implementation. Default recovery material is a randomly generated 256-bit recovery key, never contact PIN, SMS or phone number. A password option requires reviewed Argon2id parameters benchmarked on lowest supported Android devices; do not choose guessable PIN or hardcode untuned KDF costs. Archive format/version and primitive suite must be reviewed before shipping.

Outer header contains magic, format version, suite ID, random archive ID, salt/KDF parameters if needed, and nonsecret lengths. Header is authenticated as associated data; reject unsupported suite, oversized lengths and excessive KDF parameters before allocation. Encrypted manifest contains account binding, source device generation (historical only), history schema version, creation time, original audiences/membership intervals, media inclusion policy, chunk order/count/length/hash and all recovery-required archival keys. Encrypt chunks with independent derived keys/nonces using reviewed domain separation, bind archive ID/index/length/manifest in authentication, and authenticate final completion so truncation/reordering/duplication fail. Random generation, KDF/HKDF/suite selection and streaming API remain native gates.

Include historical messages/Moments, decrypted-local history re-encrypted into archive, authorized media/thumbnail bytes, original audience metadata, personal stickers and own preferences if approved. Exclude auth tokens, OAuth refresh secrets, push tokens, pending sends, active sender sessions and current membership privileges. Backups increase exposure of archival decrypt keys; communicate that history recovery does not preserve disappearing past secrets. Nothing here permits new members to restore another user's history.

Drive uploads only completed encrypted archives, with generic filenames; commit a new immutable archive before replacing latest pointer. Retain previous valid archive until new upload acknowledgement. Local export uses user-selected destination with same ciphertext. Recovery-key loss is irreversible history loss; account phone verification cannot recover plaintext. Retention, limits, password option and media scope are owner decisions.

## Failure-safe restore

Authenticate account separately; verify archive account binding using authenticated manifest. Verify/decrypt into a private staged generation; no plaintext export/temp file on shared storage. Apply schema migration, verify record/media hashes, SQLCipher integrity and archive completion. Only after all checks, close readers, atomically switch the active generation with crash-recoverable journal and reopen. Keep previous working generation until successful startup confirmation. Any wrong key, corrupt/truncated archive, unsupported schema, full disk or interruption leaves prior history usable. Refresh current server authorization before any outbound action. Device replacement generates fresh live identity/session secrets; imported archival keys cannot become active keys.

## Required native assertions and evidence

1. Enable SDK57 SQLCipher config plugin, rebuild native app; record `PRAGMA cipher_version`, nonempty expected version, `PRAGMA cipher_integrity_check` and ordinary integrity result. SQLite silently ignores unsupported pragmas, so a successful key statement alone proves nothing.
2. Insert sentinel history, close DB. Opening a copy without key and with wrong key must fail actual `sqlite_master`/row read; valid key restores sentinel. Inspect DB/WAL/SHM/cache backups for sentinel plaintext. Do not print secrets or sentinel content from real user data.
3. Export closed/coherent snapshot; correct recovery key restores IDs, payloads/media hashes and historical boundaries into staging. Wrong key, bit flip, truncation, swapped chunks and wrong account fail before switch.
4. Kill process at each stage including final switch; restart selects one complete usable generation. Existing history survives failed migration, out-of-space and revoked Google OAuth.
5. Import old device backup after member removal/replacement; local history may restore but old token/session/outbox/membership must not authorize future communication. Exercise lost recovery key safe UX.
6. Google account cancellation/revocation, quotas, interrupted resumable upload and deletion of appdata folder report accurate retry/error state; last-success time updates only on completed verified upload.

No native instrumentation runner/package exists yet. Implement the harness in the next Task1 slice described in `validation/e2e/README.md`, then record exact generated Gradle task and outputs. Public source: [Expo57 SQLCipher](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/), [Drive appdata](https://developers.google.com/workspace/drive/api/guides/appdata), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth). Provider access and native encryption are independent gates.
