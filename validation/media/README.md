# Media and native provider validation

Date: 2026-10-10. Status: native runs not recorded.

Existing `apps/mobile/src/features/stickers/background-removal.ts` calls optional `ExpoBackgroundRemoval` with `cropToSubject: false`, `maxDimension: 1600`; package `@rbayuokt/expo-background-removal` is declared at ^0.1.0. Module availability is not evidence of segmentation quality or privacy. Preserve approved crop/text-layer UI.

## Device matrix

- Development build resolves module; a missing module reports unsupported capability and never pretends cropping removes background. Record resolved native dependency/model version and license before adopting.
- Test human, hair, pet, object, low contrast, multiple subjects and no-subject images; visually inspect alpha edges and transparency. Compare output dimensions/orientation to edited input; rendered sticker must include all text layers and preserve appearance after composition edits/deletion.
- Run offline/airplane mode after model provisioning; inspect implementation and network behavior for photo upload, telemetry or model download. Local source photos must remain local; encrypt only intended rendered output and thumbnail before upload. If model provisioning requires network, disclose and measure it separately; do not infer offline capability from API naming.
- Cancel/revoke picker/camera permissions; test large photos, memory pressure, slow device, background/resume and native failure. Clean temporary original/edited files and avoid plaintext shared media cache.
- Tampered encrypted photo/GIF/sticker/thumbnail fails native authentication before renderer. Native gallery save requires explicit user action and appropriate permissions; exported copy cannot be recalled.

## Android Now Playing

Native NotificationListenerService + MediaSessionManager harness is separate from this optional cutout module. Permission grant and sharing opt-in are separate; grant alone never sends a track. Allowlist selected player packages; consume title/artist/source package from active-playing session only, no notification body/artwork URL/control invocation. Test missing metadata, multiple players, pause/stop, permission revocation, sign-out, force-stop, Doze, network loss and reconnect. Use short encrypted friend-only TTL; clear stale state locally even without receiving a stop update. TTL value and foreground/background delivery behavior require device evidence and policy review. No music in Circle bubbles; no implication of iOS parity.

## Supabase

Private bucket only. The proposed Go ciphertext proxy is the client download path, including thumbnails/ranges; issue opaque proxy URLs/grant IDs, never direct Supabase signed download URLs. Proxy checks current device generation, session, immutable audience and current membership/tombstone state on every read/range and synchronizes chunk admission/cancellation with revocation. Already admitted bytes may arrive after revocation and cannot be recalled; no newly admitted bytes are allowed after commit. Upload grant use must likewise recheck current actor generation, size/object/type restrictions at the proxy; stale grants cannot create new upload authority. Service-role key remains server-only and bypasses RLS; Storage cannot validate audience encryption.

Acceptance must obtain a proxy URL/grant before Bob's removal and before Alice's device replacement, then retry that exact URL/grant without refresh after revocation, including range/resume and thumbnail requests: all fail authorization. Race revocation with an active stream and verify cancellation and no post-commit chunk admission, distinguishing previously admitted/in-flight bytes. Check clients/bundle/network responses never contain direct Storage signed URLs and private object listing/direct reads fail without upstream credentials. A deliberately issued direct signed URL fixture illustrates the risk: it remains usable until expiry, so any client exposure fails immediate-revocation acceptance and must not be reported as revocable by app auth. Also test expired grants, failed upload cleanup, tamper and thumbnail parity; never expose reusable plaintext keys or public bucket URLs.

No credentials, bucket setup or provider account was created in Task1. Native/photo and account-level Storage/Drive evidence remain outstanding. Official capability sources are recorded in `docs/technical/provider-feasibility.md`.
