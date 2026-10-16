# Drive backup transport

Status: API adapter implemented on2026-10-12. OAuth, product UI and real-provider acceptance remain unfinished; Drive backup is not enabled in the app yet.

The adapter is `apps/mobile/src/features/backup/drive-api.ts`. It consumes a separately managed Google OAuth session tied to both the selected Google account and current AwsemChat account/session. That binding must be stable across a logical operation and must change when either account changes. The adapter rejects changed bindings or access tokens across a network request. AwsemChat bearer tokens and recovery keys are never arguments to this adapter.

The supported operations are:

- Generate an appDataFolder file ID before upload. The caller must retain that ID with the exact encrypted archive and separate recovery material for retry.
- Begin a resumable upload with that ID, generic filename, application/octet-stream and only a format marker in appProperties. The archive is the same base64 ciphertext file used for local export; no message text, account profile, recovery key or recipient list belongs in Drive metadata.
- Send the encrypted file to a validated resumable URL. URLs must stay on the Google API origin and upload path. Redirects are rejected. The returned ID and size must match the requested file and bytes.
- List paginated backups from appDataFolder using the format marker. Duplicate IDs, malformed metadata and stalled cursors are rejected.
- Download after validating appDataFolder membership, format marker, ID and bounded declared size. Downloaded bytes must match the declared size and base64 shape. These checks do not authenticate the archive; native decode with the separate recovery key remains mandatory before any history import.

Each request has a45-second deadline spanning body consumption. Unauthorized responses request renewed Google authorization, rate limits remain retryable, and other failures expose fixed codes rather than raw provider diagnostics. Production origin is www.googleapis.com over HTTPS; localhost overrides require an explicit development flag. Upload conflicts are surfaced distinctly for recovery by the caller. Interrupted/partial uploads now query confirmed byte ranges before resuming, and expired sessions are renewed with the original file ID.

The current adapter accepts ciphertext files up to24MiB, matching local backup import limits. Whole-file PUT is used within a resumable upload session. Streaming downloads and complete OAuth/UI/provider acceptance are still required. Upload status/offset queries and durable pending-operation retention are implemented. Recovery must preserve the same generated ID and exact bytes after a lost response, verify an existing file on conflict, and retain recovery material securely outside the cloud archive. It must not report success or discard the recovery key on an uncertain commit.

Next steps:

1. Pending vault and upload coordinator foundations implemented; complete injected crash checkpoints and physical-device/power-loss/storage acceptance.
2. Resumable status/offset/expiry recovery and exact-byte conflict verification are implemented; complete real-provider acceptance and deadline/chunking/progress UX.
3. Add native Google authorization with drive.appdata scope, token storage/refresh/revocation and explicit account choice. Configure a real OAuth application without client secrets in the mobile bundle.
4. Connect upload/list/restore to the approved backup screen with progress, retries, key-save UX and truthful last-success state.
5. Verify real Google account, replacement-phone restoration, provider/account revocation, interrupted uploads and local/Drive file compatibility. Complete media aggregation and scalable history requirements separately.

Eleven local HTTP fixture tests cover the actual fetch adapter and wire contract: encrypted-only body and generic appdata metadata, generated IDs, resumable-origin validation, redirects without credential forwarding, paginated listing, malformed/duplicate/stalled results, metadata-first bounded download, byte-size mismatch, changed account binding and sanitized authorization failure. Fixtures use synthetic tokens and receive no real provider requests. This does not prove Google OAuth, device networking or provider acceptance.

Official references checked on2026-10-12: [application data](https://developers.google.com/workspace/drive/api/guides/appdata), [resumable upload and pre-generated-ID retries](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [generateIds](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds), and [download](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Google documents appDataFolder IDs and conflict-safe retries; the live provider behavior still needs acceptance in our configured app.


Verification for this change: all154 mobile tests pass, TypeScript and Expo lint exit0, and git diff --check is clean. Node's existing module-type warning remains a baseline toolchain warning. No Android native code changed in this transport slice; no new Android/provider acceptance is claimed.


Pending recovery implementation (2026-10-12): `drive-backup.ts` prepares and durably records the exact encrypted archive and recovery key before any upload. It saves the pre-generated Drive ID before resumable initiation, then saves the upload URI before transferring bytes. Retries use the existing job. A409 conflict is accepted only after downloading and comparing the exact original ciphertext. The uploaded job retains its separate recovery key until the user explicitly acknowledges saving it; unfinished jobs cannot be acknowledged away. Account binding is checked around asynchronous work. Coordinator calls share a serialized queue for each vault owner.

`pending-backup-vault.ts` stores an immutable archive digest, record count, recovery key, account/device/Google binding, Drive ID, resumable URI and phase in protected metadata. Once present, archive/key/record count and assigned file ID cannot change; uploaded phase cannot regress. Ciphertext is checksum-verified on read and before metadata updates. Missing/corrupt files fail closed without resetting the job. A failed or lost metadata-write reply retains the referenced file because commit may already have occurred. Orphan ciphertext cleanup remains a follow-up requirement.

`pending-vault-storage.native.ts` implements the ports using a private document-directory ciphertext file and Expo SecureStore protected metadata. The factory requires a64-character SHA256 fingerprint derived from public account/device/generation/Google identity context; no bearer or OAuth token belongs in the persisted binding. File names are constrained to that fingerprint's namespace and a random UUID. Ciphertext writes are exclusive and read back before publishing the metadata pointer. Native vault instances are shared per fingerprint for coordinator ownership. SecureStore is device-local; copying/restoring ciphertext files without their protected metadata does not revive a pending upload. The separate user-saved recovery key remains required after replacement/uninstall.

Verification: sixteen added tests cover preparation before transmission, restart retry without new encryption/IDs, metadata failure, exact conflict verification, account change, retained uploaded key/acknowledgement, reopening protected metadata/ciphertext, lost commit response, tamper rejection, account isolation, owned-file cleanup and immutable-job enforcement. All170 mobile tests, typecheck and Expo lint pass. Real emulator process was force-stopped after NATIVE_PENDING_BACKUP_SEED; PID10795 disappeared. A fresh PID10899 passed NATIVE_PENDING_BACKUP_PROCESS_RESTART, ORIGINAL_FILE_BYTES_KEY_RETAINED and KEY_ACKNOWLEDGEMENT_CLEANUP. The test used real native private files/SecureStore with a simulated Drive service and synthetic key/bytes. It proves process reopening, not provider OAuth/upload or power-loss guarantees. No secrets were logged.

Remaining: OAuth/session/UI wiring, persistent progress/last-success, crash injection during each file/metadata write, explicit filesystem fsync/power-loss guarantees, orphan ciphertext cleanup, large SecureStore platform limits and physical-device/provider acceptance. Drive remains disabled in the product until its complete workflow is connected and tested.

SDK57 references verified before native changes: [SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/), [Crypto](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/) and the FileSystem references in the history backup contract.


Resumable recovery update (2026-10-12): API uploadStatus sends an empty PUT with Content-Range bytes */total. HTTP308 without a redirect location returns the validated server-confirmed offset, with no Range meaning zero bytes. Malformed/nonzero-start/out-of-bounds/full-length incomplete ranges fail closed.200/201 metadata must identify the expected file and total size;404/410 expires the session. Upload accepts a validated offset and sends only archive.slice(offset) with its absolute Content-Range. Incomplete/expired replies remain pending retryable outcomes.

The coordinator queries any saved session before resending. Completed uploads are durably marked uploaded without retransmission. Expired URIs are durably cleared before requesting a fresh session under the same generated file ID; recovery key and exact archive stay unchanged. A conflict still requires downloading and comparing exact bytes. Errors preserve pending state and never trigger fresh encryption or a replacement file ID.

Transport discovery: fetch redirect:error rejects Drive's legitimate308. Manual mode avoids following redirects while allowing status inspection. The installed Android Expo57 transport marks an unfollowed308 as redirected via OkHttp's isRedirect flag, so only a308 without Location is allowed through that flag guard.308 with Location and other redirect responses are rejected. Production native integration must supply expo/fetch via the adapter fetcher option, which honors manual redirect configuration; the legacy React Native global-fetch redirect behavior is not claimed safe or verified. The native probe supplies the real Expo transport.

Verification: ten additional tests bring the full mobile suite to180 passing tests; typecheck, Expo lint and git diff --check pass. Test-first failures covered missing status/offset/expiry handling and the installed native308 redirect flag. A real HTTP fixture terminated the first upload after two bytes; a new coordinator queried progress and sent only the final two original ciphertext bytes while preserving file ID/key and encrypting once. Supplemental tests cover wire Content-Range,308 redirect rejection and malformed ranges.

Actual Android Expo fetch against the localhost synthetic fixture passed NATIVE_EXPO_FETCH_HTTP308_STATUS, NATIVE_REMAINING_CIPHERTEXT_RANGE, NATIVE_UPLOAD_COMPLETE_EXPIRED and NATIVE_REDIRECT_REJECTED. Reproduce with node validation/e2e/android/drive-resume-server.mjs, ADB reverse8087, and the development probe phase driveResumeTransport. The fixture accepts only synthetic bearer data, stores no real account data and makes no real Google calls. This proves native HTTP behavior against controlled responses, not OAuth or Google provider acceptance.


Authorization state and trusted identity lookup are implemented separately; see [Google authorization contract](google-drive-authorization.md). The native SDK consent bridge and complete runtime/UI workflow are still required. All192 mobile tests, typecheck/lint pass; no real Google account authorization has been attempted.


Native consent bridge and Drive runtime/UI wiring were added on2026-10-12. See the Google authorization contract for the implementation, default-disabled configuration gate and outstanding provider/device acceptance. All196 mobile tests, typecheck/lint and the rebuilt APK registration/full-native regression checks pass. Actual Google consent/upload/restore is still unproven; Drive stays gated until registration is confirmed and acceptance is completed.
