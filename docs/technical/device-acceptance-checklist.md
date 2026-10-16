# Device acceptance checklist

Updated 2026-10-16. Android is the current test target; iOS has a separate release gate below. This tracks device acceptance, not implementation completion or automated-test coverage.

## Progress

| Result | Android cases |
| --- | ---: |
| PASS | 6 |
| NOT RUN | 82 |
| FAIL | 8 |
| INVESTIGATE | 0 |
| BLOCKED | 5 |
| Total | 101 |

**6/101 Android cases passed (5.9%).** A successful screen render does not pass its mutations, persistence, recipient behavior, or error handling. Provider-backed tests remain separate from local mock acceptance.

**Executed: 14/101 cases (6 passed, 8 failed).** Failed cases count as tests performed and remain recorded for future fixing. Investigations are incomplete observations; blocked cases still need their named dependency.

| Feature | Passed / total | Needs attention |
| --- | ---: | --- |
| [Account and sign-in](#auth) | 2 / 7 | AUTH-07 (blocked) |
| [Startup, navigation, and UI behavior](#nav) | 2 / 8 | NAV-01 (fail), NAV-06 (fail) |
| [Profile and PIN](#prof) | 0 / 5 | PROF-01 (fail) |
| [Friends and new conversations](#fri) | 2 / 5 | FRI-04 (fail) |
| [Chat list and local preferences](#list) | 0 / 6 | LIST-01 (fail) |
| [Private and Circle messaging](#msg) | 0 / 7 | MSG-01 (fail), MSG-07 (fail) |
| [Identity, deletion, and privacy boundaries](#sec) | 0 / 5 | — |
| [Circles, invitations, and membership](#cir) | 0 / 10 | — |
| [Photos, preview, and shared media](#media) | 0 / 7 | MEDIA-07 (blocked) |
| [Private and Circle Moments](#mom) | 0 / 6 | — |
| [Sticker maker, libraries, and Circle sharing](#stk) | 0 / 7 | — |
| [GIPHY and favorites](#gif) | 0 / 4 | GIF-03 (fail) |
| [Android Now Playing](#play) | 0 / 5 | — |
| [Notifications](#notif) | 0 / 4 | NOTIF-02 (blocked) |
| [Backup and restore](#back) | 0 / 6 | BACK-04 (blocked), BACK-05 (blocked) |
| [Privacy, reporting, and sign-out](#safe) | 0 / 4 | — |
| [Offline, interruptions, and recovery](#res) | 0 / 5 | — |

## Testing task queue

Use this queue to follow the work in order. The feature cases below hold the individual results; these tasks do not add to the 101-case total. Check a task only after every referenced case has been executed and its outcome recorded. A finished testing task can still contain failures that need fixing before release. Blocked cases keep their task open.

| Done | Task | Cases | Current progress |
| --- | --- | --- | --- |
| [ ] | 1. Account access and session recovery | AUTH-01–06 | 2/6 executed |
| [ ] | 2. Navigation, accessibility, layouts, and feedback | NAV-01–08 | 4/8 executed; failed: NAV-01, NAV-06 |
| [ ] | 3. Profile, PIN, friends, and new conversations | PROF-01–05; FRI-01–05 | 4/10 executed; failed: PROF-01, FRI-04 |
| [ ] | 4. Chat list, filters, pinning, muting, and archives | LIST-01–06 | 1/6 executed; failed: LIST-01 |
| [ ] | 5. Private and Circle messages, replies, reactions, and delivery | MSG-01–07 | 2/7 executed; failed: MSG-01, MSG-07 |
| [ ] | 6. Circle creation, invitations, details, roles, and leaving | CIR-01–10 | 0/10 executed |
| [ ] | 7. Photos, editing, preview, download, and shared media | MEDIA-01–06 | 0/6 executed |
| [ ] | 8. Private and Circle Moments | MOM-01–06 | 0/6 executed |
| [ ] | 9. Sticker maker, libraries, Circle sharing, and GIFs | STK-01–07; GIF-01–04 | 1/11 executed; failed: GIF-03 |
| [ ] | 10. Now Playing and local notification controls | PLAY-01–05; NOTIF-01, 03–04 | 0/8 executed |
| [ ] | 11. Identity verification, deletion, privacy, and reporting | SEC-01–05; SAFE-01–04 | 0/9 executed |
| [ ] | 12. Local backup, restore, and replacement-phone recovery | BACK-01–03, 06 | 0/4 executed |
| [ ] | 13. Offline use, interrupted operations, and restart recovery | RES-01–05 | 0/5 executed |
| [ ] | 14. Provider and media-backup acceptance | AUTH-07; MEDIA-07; NOTIF-02; BACK-04–05 | All 5 blocked; see case dependencies |
| [ ] | 15. Physical Android, iOS, and release acceptance | Separate release gates below | Not run; outside the Android case count |

After each task, report the cases executed, passes, failures, blockers, and next task. Link any failure to its observation below. Retesting a failure updates its case result and keeps the earlier observation as history.

## Updating this checklist

- Current run instruction from the owner: complete the device tests and record issues for future fixing. Do not change application code or repair failed features during this acceptance run. Reversible emulator configuration and isolated synthetic test fixtures are test setup; provider credentials, native builds, and production deployment remain outside this run.
- Check a box only when the whole case passes on the named device against the named environment. Use NOT RUN, PASS, FAIL, INVESTIGATE, or BLOCKED explicitly; implementation and unit/UI tests alone cannot mark a device case PASS.
- After each testing task, update the case, dashboard counts, evidence note, and relevant open observation; report the new status to the owner. Record date, device/OS, app/API revision or dirty-checkout state, environment/provider mode, expected result, actual result, and a sanitized evidence reference.
- Give failures a reproducible observation ID. Use INVESTIGATE when the cause or accepted result is not yet established. BLOCKED needs a named dependency; a missing feature discovered during testing is a failure, not a silent pass.
- Retest affected passed cases after relevant changes. Keep iOS and physical-device results separate; an Android emulator pass never implies an iOS or physical-device pass.
- Use dedicated test accounts and synthetic content. Do not put phone numbers, OTPs, access tokens, private messages, recovery keys, or unredacted archives in this checklist or screenshots.

## Test setup and order

Current observed environment: macOS ARM64 with 8 GB RAM; about 22 GiB free after owner cleanup. The installed development app is `com.moherik.awsemchat` on `Small_Phone_API_33` / `emulator-5554` (Android 13/API 33, ARM64, 720×1280). The emulator was restarted with 2 GB RAM, 2 CPU cores, software graphics, Vulkan disabled, and no saved-state loading. Guest Bluetooth is off to stop the confirmed Android LE Audio crash loop; Mac Bluetooth was not changed. Metro is on 8081; local API forwarding uses 8088. These describe the last session, so recheck availability before each run.

Recorded passes apply to the 2026-10-16 development checkout on branch `codex/awsemchat-mvp`, HEAD `0ae7d34` plus uncommitted changes. Exact release-build and physical-device acceptance are still outstanding. The owner asked to use the existing development environment without rebuilding; a required native rebuild must be reported before changing that testing setup.

1. Test LIST-01 and record any failure; establish the app/API/storage baseline and confirm the local API schema and installed native-module version match the code under test. Continue independent cases without fixing defects.
2. Prepare isolated accounts A (author/admin), B (accepted friend), C (new/removable Circle member), and an outsider; use capacity fixtures for the 20-member boundary. Prefer a second test phone over running two emulators on this 8 GB Mac. Reset/destructive scenarios use disposable test data.
3. Finish profile, friendship, conversation-list, and private text/reply/reaction journeys before Circle membership and content tests.
4. Exercise local encrypted media, Moments, sticker maker/collections, live GIPHY, Now Playing, permission handling, and local backup.
5. Run process-death/offline/deletion/identity/account-replacement cases. Use controlled dropped-response and storage-failure fixtures rather than filling the Mac's disk or interrupting unrelated data.
6. Run the real SMS/Supabase/Google/FCM cases after configuration; complete physical Android and iOS release gates. Mark local service, synthetic provider, and real provider evidence distinctly.

Suggested assets: portrait and landscape photos, a subject with a visible background, transparent PNG, animated GIF, long Unicode names/statuses/captions, and files near/over the configured size limit. Every enabled control must produce the intended local or backend effect, reconcile after restart, and show an honest failure state when its dependency is unavailable.

## Android feature cases

<a id="auth"></a>

### Account and sign-in

- [x] **AUTH-01 · PASS** — Sign in using a dedicated test phone number and the mock development code; complete native key setup and reach Chats. Evidence: earlier Android dev session on 2026-10-16; account-bound key publication was observed.
- [x] **AUTH-02 · PASS** — Force-stop and reopen the signed-in app; restore the existing account session without another OTP. Evidence: cold launches on 2026-10-16 returned to Chats.
- [ ] **AUTH-03 · NOT RUN** — Exercise invalid/expired codes, resend, repeated submission, interrupted verification, and retry; show accurate feedback without duplicate account creation. **Latest run:** Partial Android 13 emulator evidence on 2026-10-16: expired and incorrect mock codes showed the appropriate feedback; resend stayed on verification; interruption returned to phone entry. Two rapid valid submissions led to a recoverable encryption-setup screen; one visible Retry encryption setup reached Chats. No private account content appeared while verification was incomplete. Resent-code completion and authoritative duplicate-account/key checks remain open. Evidence: auth03-invalid-fresh-code, auth03-resend, auth03-interruption-ready, resume-account, auth03-key-retry.
- [ ] **AUTH-04 · NOT RUN** — Activate the same account on a replacement test phone; the previous phone loses authenticated access and private screens clear after session revalidation.
- [ ] **AUTH-05 · NOT RUN** — Verify SMS-only replacement access keeps the original contact PIN and friendships; old message history requires its encrypted backup and recovery key.
- [ ] **AUTH-06 · NOT RUN** — Open a protected route while signed out, offline, or rechecking a session; account gating prevents private content flashing before authentication is established.
- [ ] **AUTH-07 · BLOCKED** — Verify real SMS delivery, resend limits, expiry, and abuse controls through the configured provider. Blocker: SMS is currently mocked; no provider account is configured.

<a id="nav"></a>

### Startup, navigation, and UI behavior

- [ ] **NAV-01 · FAIL** — Cold-launch the installed dev app without the React state-update-before-mount warning; reach the native Chats screen. Evidence: 2026-10-16 startup log and screen inspection after the session-gate fix. **Latest run:** Regression on 2026-10-16 after creating the A/B friendship and sending a private message: recipient restored to native Chats but displayed the React state-update-before-mount warning again. Earlier cold-start checks had passed; this new real-data startup contradicts that acceptance result. Evidence: b-message-root. OBS-07; no fix applied.
- [x] **NAV-02 · PASS** — Navigate from Chats to Settings and Appearance using the actual screen controls. Evidence: Android accessibility hierarchy on 2026-10-16; navigation worked after disabling the guest Bluetooth crash loop.
- [x] **NAV-03 · PASS** — Select Dark, verify the native screen changes, restart the app, and verify Dark remains selected; restore the original Use device theme setting. Evidence: Android screenshots, radio-button state, and process restart on 2026-10-16.
- [ ] **NAV-04 · NOT RUN** — Open every supported native destination from its visible entry point, including all three home tabs; verify Android Back, header Back, and return-to-list behavior.
- [ ] **NAV-05 · NOT RUN** — Exercise screen-reader labels/focus, large text, reduced motion, and long names/statuses; controls remain readable and reachable.
- [ ] **NAV-06 · FAIL** — Check small-screen layouts, keyboard opening/dismissal, safe areas, scroll-to-last-item behavior, and rounded-square avatars across the feature screens. **Latest run:** 2026-10-16 720x1280 Android emulator: private composer reserves four adjacent media/PING controls and leaves a very narrow message field; even the Message placeholder wraps onto two lines. Screenshot confirms the layout. Other safe-area/keyboard/avatar permutations remain open. Evidence: message-bubble-redacted.png. OBS-06.
- [ ] **NAV-07 · NOT RUN** — Trigger success, progress, and error snackbars on tabbed pages, pages without tabs, chat, and sheets; verify bottom placement, dismissal, and keyboard/sheet handling.
- [ ] **NAV-08 · NOT RUN** — Exercise long-press chat menus and message/Moment menus; correct actions, dismissal, placement, and own-message action spacing remain usable on touch.

<a id="prof"></a>

### Profile and PIN

- [ ] **PROF-01 · FAIL** — View, copy, and share the original contact PIN; it remains stable after profile changes and restart, and contact exchange does not disclose the phone number. **Latest run:** 2026-10-16: PIN is visible on You, but no copy/share action is exposed and two long presses on the PIN (including directly over its glyphs) produced no Android selection menu. Screen records: prof-persist-home and pin-selection-retry. OBS-02; remaining PIN stability permutations are not yet covered.
- [ ] **PROF-02 · NOT RUN** — Save display name and text status; reload the screen and restart the app to verify local persistence and accurate failure/retry feedback. **Latest run:** Partial device evidence on 2026-10-16: saved synthetic display name/status, observed Profile saved, and saw both exact values after cold restart. Failure/retry branch remains to be exercised before passing the whole case.
- [ ] **PROF-03 · NOT RUN** — Choose, crop, replace, and remove a profile avatar; verify the rendered asset and permission/cancellation behavior.
- [ ] **PROF-04 · NOT RUN** — Change profile name/status/avatar and verify accepted friends receive the current values in lists and private chat; unauthorized accounts cannot fetch the private profile.
- [ ] **PROF-05 · NOT RUN** — Verify the private header combines latest status and authorized Now Playing into one line; long content scrolls only when needed and reduced motion uses static truncation.

<a id="fri"></a>

### Friends and new conversations

- [ ] **FRI-01 · NOT RUN** — Search a valid PIN and send a request; exercise invalid, own, duplicate, and already-connected PINs with accurate outgoing state.
- [x] **FRI-02 · PASS** — Use two accounts to verify pending requests cannot open an accepted private chat; accept on the recipient and reconcile both Friends lists and chat access. **Latest run:** 2026-10-16 Android 13 emulator: while pending, New conversation showed no accepted friend/private entry. Recipient accepted through Friend requests; server has exactly one accepted A/B link. Both isolated Android accounts then displayed the peer in New conversation and opened its private chat. Friends-tab rendering is a separate failed FRI-04 case. Evidence: new-conversation-retry, fri02-accepted, fri05-accepted-friend-entry, b-new-conversation-after-accept, b-private-first-receive.
- [x] **FRI-03 · PASS** — Decline a request and exercise available pending-request controls; identity/avatar and empty states update without leaving a friendship behind. **Latest run:** 2026-10-16, Android 13 emulator, isolated A/B accounts: recipient request displayed the sender PIN identity; Decline produced the empty state and success snackbar. Server recorded one declined link; sender Friends showed no pending or accepted friend after re-entry. A fresh request could then be sent. Evidence: a-incoming-request, fri03-declined, fri03-sender-after-decline; aggregate DB assertion against awsemchat_device_acceptance.
- [ ] **FRI-04 · FAIL** — Verify compact accepted-friend rows show current avatar/status/PIN; search and pagination can find friends beyond the first loaded page. **Latest run:** 2026-10-16 Android 13 emulator: after accepting the A/B friendship, Friends showed the controls/search but no reachable accepted-friend row. Two upward swipes did not reveal it. New conversation did show the same accepted friend and opened its chat, and the DB had one accepted link. Evidence: fri02-recipient-friends, fri02-recipient-friend-row, friends-scroll-retry, fri05-accepted-friend-entry. Search/pagination permutations remain to be checked. OBS-03.
- [ ] **FRI-05 · NOT RUN** — Open New conversation; verify the Create a Circle icon, accepted-friend identity rows, name/PIN search, and selection of the intended private peer.

<a id="list"></a>

### Chat list and local preferences

- [ ] **LIST-01 · FAIL** — Test preference loading and usability across cold launches; reproduce and record any 'Could not load chat settings. Please retry.' snackbar with sanitized evidence for future fixing. Observation OBS-01 below; a later restart did not reproduce it. **Latest run:** 2026-10-16, API ready and guest Bluetooth off: cold start after saving a profile returned to Chats and displayed the same chat-settings error. Sanitized screen record: 20261016-102804-prof-cold-persist.json. Recorded as OBS-01; no code changed.
- [ ] **LIST-02 · NOT RUN** — Verify All/Private/Circles filters, search, pagination, latest previews, and opening the correct private conversation or Circle using real account data.
- [ ] **LIST-03 · NOT RUN** — Long-press a chat to pin/unpin; pinned ordering and indicators update and survive restart.
- [ ] **LIST-04 · NOT RUN** — Mute/unmute private and Circle chats; indicators, local preference persistence, and authenticated notification-preference synchronization agree.
- [ ] **LIST-05 · NOT RUN** — Archive a chat; it disappears from the main list, remains accessible only through Settings → Archived chats, and incoming messages keep it archived until explicitly unarchived.
- [ ] **LIST-06 · NOT RUN** — Verify unread/time/delivery and latest-message previews against actual received events; internal profile, reaction, and collection controls do not become ordinary chat previews.

<a id="msg"></a>

### Private and Circle messaging

- [ ] **MSG-01 · FAIL** — Exchange private text messages between two accounts; text/order match, outgoing states advance from Sent to Delivered, and no read receipt, typing, or online indicator appears. **Latest run:** 2026-10-16 Android 13 emulator: entered and sent synthetic text through the private composer. The UI changed to Sent but the outgoing text/bubble is visually absent; this is confirmed by a header-redacted screenshot, not only the accessibility tree. Recipient delivery and remaining permutations are still to be exercised. Evidence: msg01-a-first-send, msg01-sent-settled, message-bubble-redacted.png. OBS-05.
- [ ] **MSG-02 · NOT RUN** — Send a Circle message to its fixed original recipients; Delivered requires their acknowledgements, including when a recipient leaves before acknowledging.
- [ ] **MSG-03 · NOT RUN** — Reply to incoming and own messages in private and Circle chats; verify draft quote, cancel, explicit send, and tapping the sent quote to locate the original.
- [ ] **MSG-04 · NOT RUN** — Add/remove standard emoji reactions on private and Circle messages; reconcile sender/recipient state and own-message menu actions without duplicate controls.
- [ ] **MSG-05 · NOT RUN** — Send PING and answer PONG in private chat; verify chat-specific PING mute, retry, and absence of PING/PONG controls in Circle chat.
- [ ] **MSG-06 · NOT RUN** — Receive incoming messages while foregrounded and after returning from background; ordering and delivery state remain correct without duplicate bubbles.
- [ ] **MSG-07 · FAIL** — Load earlier encrypted chat history beyond local records; verify ordering, redaction checks, exhausted-history state, and retry after a failed page. **Latest run:** 2026-10-16 Android 13 emulator: recipient private chat showed an empty conversation plus Retry loading earlier messages. Pressing Retry repeated Could not load earlier messages. API readiness was 200, running API started after history-route sources, and sender relay events/delivery rows exist with zero acknowledgements. Older-page ordering/exhaustion still need retesting after repair. Evidence: b-private-first-receive, b-history-retry; aggregate relay assertion. OBS-08.

<a id="sec"></a>

### Identity, deletion, and privacy boundaries

- [ ] **SEC-01 · NOT RUN** — Chat before optional identity verification, then compare the safety code or supported QR flow; the UI reflects the verification result without making verification mandatory. **Latest run:** Partial Android evidence 2026-10-16: unverified private sending is allowed; Security details exposes local/friend public keys and an optional comparison acknowledgement. Acknowledgement changes the UI to marked as compared. No actual two-account value comparison, safety-code/QR acceptance, or persistence proof yet. Evidence: security-details, security-comparison-confirmed.
- [ ] **SEC-02 · NOT RUN** — Change a test peer's identity; sending stops with a clear warning until the user explicitly acknowledges the change, and verification state updates.
- [ ] **SEC-03 · NOT RUN** — Delete selected messages authored by the current user in private and Circle chats; fixed original recipients remove them on reconnect, other authors cannot delete them, and later Circle members cannot inspect earlier redactions.
- [ ] **SEC-04 · NOT RUN** — Restore a backup containing deleted messages; require the online redaction check before exposing restored history, including offline/error and pending-deletion cases.
- [ ] **SEC-05 · NOT RUN** — Inspect test API/media payloads, local persistence, logs, and notification data for unauthorized plaintext or secrets; validate conversation/account isolation. This is application acceptance, not an independent cryptographic audit.

<a id="cir"></a>

### Circles, invitations, and membership

- [ ] **CIR-01 · NOT RUN** — Create a Circle with name/avatar and accepted-friend checkbox selection; show friend avatars/PINs and count the creator toward the 20-member limit.
- [ ] **CIR-02 · NOT RUN** — Send and accept/decline Circle invitations using separate accounts; membership changes only after acceptance and both sides reconcile the result.
- [ ] **CIR-03 · NOT RUN** — As admin, change Circle name, description, and avatar; recipients see the current metadata and the conversation/collection identity stays unchanged.
- [ ] **CIR-04 · NOT RUN** — Open Circle details; verify compact member rows, identities, roles, pagination, current count, and the direct Manage Group stickers entry.
- [ ] **CIR-05 · NOT RUN** — Use the separate searchable Invite friends checkbox page; exclude ineligible/current members and reject additions that would exceed 20 active members, including competing accepts.
- [ ] **CIR-06 · NOT RUN** — As admin, remove a member and transfer admin rights; non-admin controls and direct API operations enforce the same permissions.
- [ ] **CIR-07 · NOT RUN** — Try to leave as the last admin of a multi-member Circle; require choosing another member first. Cancel and confirm paths produce the correct membership result.
- [ ] **CIR-08 · NOT RUN** — Leave as the Circle's sole remaining member; the Circle closes, and repeated/retried leave does not create another operation.
- [ ] **CIR-09 · NOT RUN** — Join, leave, and rejoin with distinct membership intervals; new members cannot see old messages/Moments, while authorized current profile/collection snapshots remain available.
- [ ] **CIR-10 · NOT RUN** — Exchange Circle messages and profile updates; other senders show their latest name/status, own bubbles omit You/status, and song metadata does not appear in Circle bubbles.

<a id="media"></a>

### Photos, preview, and shared media

- [ ] **MEDIA-01 · NOT RUN** — Open the approved photo/camera media controls; test Android permission grant/deny, picker cancellation, and returning without sending.
- [ ] **MEDIA-02 · NOT RUN** — Before sending, crop freely, flip, rotate, reset, and apply filters; add a caption and verify the recipient receives the edited pixels and caption in private and Circle chat.
- [ ] **MEDIA-03 · NOT RUN** — Tap chat and Moment images into fullscreen preview; verify caption, close/back, animated GIF playback, download action, and Android save permissions.
- [ ] **MEDIA-04 · NOT RUN** — Open Shared media for each conversation type; display actual authorized photos/GIFs, counts and empty states, exclude stickers, and load/retry older history pages.
- [ ] **MEDIA-05 · NOT RUN** — Send/download encrypted media through the controlled local storage service; intended recipients decrypt it and an unrelated account cannot retrieve usable content.
- [ ] **MEDIA-06 · NOT RUN** — Exercise oversized/unsupported assets, failed photo access, interrupted editor navigation, and download failures; retain safe drafts and show actionable snackbar feedback.
- [ ] **MEDIA-07 · BLOCKED** — Repeat upload, authorized download, expiry/error, and operation cleanup against the private Supabase bucket. Blocker: the real Supabase project/bucket/service configuration is not set up.

<a id="mom"></a>

### Private and Circle Moments

- [ ] **MOM-01 · NOT RUN** — Open Moments in a private chat and a Circle; each has its own collection, and the top post entry opens a draft that posts only on explicit confirmation. **Latest run:** Partial Android evidence 2026-10-16: private Moments starts empty, text draft remains unsent until Share Moment, and an explicit post appears locally. Circle collection and navigation remain untested. Evidence: b-moments-empty, moment-text-draft, moment-text-shared.
- [ ] **MOM-02 · NOT RUN** — Post text and edited-photo Moments with captions; recipients see the intended content and Moment controls do not render as ordinary Chat bubbles. **Latest run:** Partial Android evidence 2026-10-16: private text Moment posts and appears locally after explicit Share. Edited photos, recipient rendering, and Circle parity remain untested. Evidence: moment-text-shared.
- [ ] **MOM-03 · NOT RUN** — Promote the author's accepted chat text/photo to Moments; other senders cannot promote it and the original audience is not broadened.
- [ ] **MOM-04 · NOT RUN** — React/unreact directly on a Moment; author and recipient views reconcile the aggregate and viewer state. **Latest run:** Partial Android evidence 2026-10-16: own private Moment heart reaction changes Add to Remove and displays count 1. Recipient reconciliation, removal/restart, and Circle parity remain untested. Evidence: moment-reacted.
- [ ] **MOM-05 · NOT RUN** — Reply to a Moment; navigate to Chat with an embedded draft without sending, support cancel and explicit send, and return to the source Moment by tapping the quote. **Latest run:** Partial Android evidence 2026-10-16: Reply to Moment in Chat switches to Chat with an embedded Moment draft and disabled empty Send; Cancel Moment reply clears it. Sent reply, return-to-Moment navigation, recipient and Circle parity remain untested. Evidence: moment-reply-chat-draft, moment-reply-cancelled.
- [ ] **MOM-06 · NOT RUN** — Delete an owned Moment within its authorized audience; propagate its encrypted tombstone and reject another author's deletion or a mismatched audience/epoch. Confirm removed/unavailable reply targets are handled clearly.

<a id="stk"></a>

### Sticker maker, libraries, and Circle sharing

- [ ] **STK-01 · NOT RUN** — Create a sticker from a device photo; drag and resize the unrestricted rectangular crop and verify the saved crop matches the editor.
- [ ] **STK-02 · NOT RUN** — Remove the background on-device; inspect actual transparent pixels/subject edges and test offline processing. A rectangular crop alone is a failure.
- [ ] **STK-03 · NOT RUN** — Add multiple text boxes, edit them, drag them independently, and delete selected boxes; exported text positions match the editor.
- [ ] **STK-04 · NOT RUN** — Manage personal stickers and available pack/recent controls; create/edit/remove through real local storage and verify persistence after restart.
- [ ] **STK-05 · NOT RUN** — Use Personal/Circle picker tabs; contribute to a Circle collection, copy an independent personal sticker, and enforce admin-only collection removal without recalling saved copies.
- [ ] **STK-06 · NOT RUN** — Send a personal sticker one-off into a Circle; deliver it encrypted without mutating the shared Circle collection, including retry after interruption.
- [ ] **STK-07 · NOT RUN** — Send personal/shared stickers in private and Circle chat; render transparency and saved copies correctly, and let new members load the current authorized sticker collection.

<a id="gif"></a>

### GIPHY and favorites

- [ ] **GIF-01 · NOT RUN** — Load live Trending/search/category pills, pagination, provider attribution, and the full grid with correct right/bottom spacing on Android. **Latest run:** Partial Android evidence 2026-10-16: live Trending results, Happy category search, explicit nonsense search empty state, attribution, and a selected GIF preview work. Additional pagination/category overflow and provider/network errors remain untested. Evidence: gif-trending-result, gif-happy-category, gif-search-no-results, gif-preview-before-send.
- [ ] **GIF-02 · NOT RUN** — Favorite/unfavorite GIFs, restart, and reload Favorites; persist IDs/titles and resolve fresh provider URLs rather than saving provider URLs/media as favorite records. **Latest run:** Partial Android evidence 2026-10-16: saving a live GIF shows it in Favorites and it survives category/search switching. Cold-start/account-isolation and removal still need testing. Evidence: gif-favorites-after-save, gif-favorite-retained.
- [ ] **GIF-03 · FAIL** — Send a GIF in private and Circle chat; verify encrypted media delivery, animation, caption/preview behavior, and Shared media inclusion. **Latest run:** 2026-10-16 Android 13 emulator: selected a live GIPHY favorite, previewed it, added a caption and sent once. Backend sender event count advanced by one and picker returned to chat after an asynchronous delay, but chat renders only its timestamp/Sent label with no visible GIF bubble/caption. Recipient playback and Circle parity remain open. Evidence: gif-preview-before-send, gif-send-settled, gif-event-final-ui; aggregate relay count. Same rendering defect as OBS-05.
- [ ] **GIF-04 · NOT RUN** — Exercise loading, empty search, network/provider failure, and retry; only the intentional search query reaches GIPHY, without chat/account content.

<a id="play"></a>

### Android Now Playing

- [ ] **PLAY-01 · NOT RUN** — Open Now Playing with sharing off; present the notification-access warning and require separate, explicit permission and sharing consent.
- [ ] **PLAY-02 · NOT RUN** — Grant, cancel, and revoke Android notification access; return from system settings and reconcile access/sharing controls.
- [ ] **PLAY-03 · NOT RUN** — Play music in a supported Android music app; filter notifications locally and extract music metadata without sharing unrelated notifications.
- [ ] **PLAY-04 · NOT RUN** — Share only with accepted friends; update the private header and verify outsiders receive no track update and Circle bubbles show no song.
- [ ] **PLAY-05 · NOT RUN** — Pause/stop playback, background/foreground the app, revoke permission, and disable sharing; publish stop/clear updates and expire stale tracks after the defined 15-minute TTL.

<a id="notif"></a>

### Notifications

- [ ] **NOTIF-01 · NOT RUN** — Exercise notification opt-in, Android permission grant/deny, system revocation, and returning to the app; state and retry feedback remain accurate.
- [ ] **NOTIF-02 · BLOCKED** — Deliver real push notifications with the app foregrounded, backgrounded, and stopped; tap to Chats, deduplicate response IDs, and verify payload privacy. Blocker: EAS/FCM push-provider configuration and real delivery acceptance remain open.
- [ ] **NOTIF-03 · NOT RUN** — Change private/Circle mute settings and inspect authenticated registration/preference updates; verify current server state before the separate live push-delivery test.
- [ ] **NOTIF-04 · NOT RUN** — Verify notification authorization after friendship removal, Circle removal, sign-out, and account replacement; stale registrations cannot disclose private content.

<a id="back"></a>

### Backup and restore

- [ ] **BACK-01 · NOT RUN** — Create a local encrypted backup through the Android save UI; inspect the recovery-key presentation, cancel/failure behavior, and successful-backup timestamp after reopening.
- [ ] **BACK-02 · NOT RUN** — Restore a local archive into the intended test account; reconcile permitted history, personal stickers, and chat preferences without rolling back live cryptographic sessions.
- [ ] **BACK-03 · NOT RUN** — Try a wrong key, corrupt/truncated archive, wrong-account archive, and interrupted restore; reject safely without exposing or partially overwriting valid history.
- [ ] **BACK-04 · BLOCKED** — Connect Google Drive, handle cancellation/revocation, upload/resume, and restore an encrypted backup through the real provider. Blocker: Google authorization is not configured.
- [ ] **BACK-05 · BLOCKED** — Verify complete photo/GIF/sticker/Moment media availability after backup restoration and relevant Circle access changes. Blocker: encrypted media backup/access-after-leaving policy remains unresolved; implementation tests cannot establish a product decision.
- [ ] **BACK-06 · NOT RUN** — On a replacement test phone, use SMS access plus the recovery key to restore an archive; check redactions online before display and keep recovery keys/private archive data out of logs.

<a id="safe"></a>

### Privacy, reporting, and sign-out

- [ ] **SAFE-01 · NOT RUN** — Block/unblock a test contact; reconcile lists, requests, future messages, private profile access, and Now Playing according to current friendship authorization.
- [ ] **SAFE-02 · NOT RUN** — Report only explicitly selected message excerpts/details; verify the confirmation and API payload, access rejection, and the server's 90-day expiry using a controlled test-clock/data fixture.
- [ ] **SAFE-03 · NOT RUN** — Deny/revoke photo, camera, media-save, notification, and notification-listener permissions; each affected feature recovers through understandable feedback and retry/settings controls.
- [ ] **SAFE-04 · NOT RUN** — Cancel and confirm Sign out; confirmed sign-out clears account-bound private UI/data access and server session revocation is accurately reported.

<a id="res"></a>

### Offline, interruptions, and recovery

- [ ] **RES-01 · NOT RUN** — Queue private/Circle sends offline, restore connectivity, and reconcile the original operation once; no duplicate message or delivery acknowledgement appears.
- [ ] **RES-02 · NOT RUN** — Lose the server response after a committed send; retry the exact saved operation/ciphertext and retain the original recipient set.
- [ ] **RES-03 · NOT RUN** — Force-stop during media upload, Moment posting, Circle metadata/membership updates, and sticker contribution; exercise each saved-operation retry/discard path and preserve server-committed results.
- [ ] **RES-04 · NOT RUN** — Inject API failures and local storage-write failures using isolated test fixtures; display honest retryable state without lost drafts, false success, or leaked private data.
- [ ] **RES-05 · NOT RUN** — Repeat foreground/background and cold-start flows during synchronization, session revalidation, and account replacement; hide private data promptly and avoid app exceptions or input stalls.

## Open observations

| ID | Case | Observation | Current position |
| --- | --- | --- | --- |
| OBS-08 | MSG-01, MSG-06, MSG-07 | Recipient private conversation remains empty; loading earlier messages and the visible Retry both fail while API is ready. Isolated relay contains sender events and delivery rows but no delivery acknowledgements. | History acceptance failure; fix deferred. Investigate receive/sync/history boundaries during later repair; no root cause established. |
| OBS-07 | NAV-01, RES-05 | Recipient startup after friendship acceptance/private-message send displayed Can’t perform a React state update on a component that hasn’t mounted yet. Earlier empty-account startup had passed. | Confirmed regression in device acceptance; fix deferred. Retest populated-account startup and synchronization after future repair. |
| OBS-06 | NAV-06 | Private composer on a 360dp-wide Android device gives the input so little width that the Message placeholder wraps over two lines beside four action buttons. | Layout acceptance failure; fix deferred. Retest keyboard and media/composer layouts after future repair. |
| OBS-05 | MSG-01, MSG-03, MSG-04 | After sending private text, the timestamp/Sent label appears but the outgoing bubble and text are visually missing. Confirmed with header-redacted screenshot. | Acceptance failure; fix deferred. Check native message/menu wrapper rendering during repair. Recipient delivery and reply/reaction access are being tested separately. |
| OBS-04 | LIST-04, MSG-05 | Opening the accepted private chat showed Could not load chat notification settings; Mute PING alerts was disabled. API was ready. | Recorded for further acceptance tests; no fix. Confirm preference storage and mute controls before assigning whole-case results. |
| OBS-03 | FRI-04 | Accepted friend is absent/unreachable in Friends after acceptance, although New conversation displays it and the backend records one accepted friendship. Repeated scrolling did not reveal a row. | Acceptance failure; fix deferred. Inspect native accepted-row layout/menu wrapper and refresh behavior during repair; root cause is not established. |
| OBS-02 | PROF-01 | You displays the contact PIN, but native long presses did not open Copy/Share and no dedicated copy/share action was visible. Profile name/status did survive restart. | Acceptance failure for PIN copy/share; fix deferred. Source declares selectable PIN text, so verify native selection behavior during future repair rather than assuming a dedicated button is required. |
| OBS-01 | LIST-01 | Reproduced signed-in cold-start snackbar: Could not load chat settings. Please retry. API /health/ready returned 200 and guest Bluetooth was off. | Confirmed acceptance failure; fix deferred by owner. Check preference-store initialization/platform resolution later. A missing snackbar on a later screen capture is not proof of preference success. |

The earlier Settings → Appearance non-navigation observation was covered by Android Bluetooth crash dialogs. After guest Bluetooth was disabled, the same screen controls worked. Treat that as an environment workaround, not an established app-navigation defect. The React startup warning was fixed separately and did not recur in the recorded cold-start checks.

## Physical Android and iOS release gates

These gates do not inflate the Android feature-case completion count.

- [ ] **ANDROID-DEVICE** — Repeat permission, photo/camera, download/save, background/notification, actual music-app integration, backup, and interruption journeys on a physical Android phone; record device/OS and repeat the remaining applicable cases against the release candidate.
- [ ] **ANDROID-RELEASE** — Run a complete startup-to-chat/media/backup smoke on the signed release candidate against a representative deployed API/storage setup; development-client success is insufficient for release acceptance.
- [ ] **IOS-SETUP** — Obtain an iOS native test environment/device and verify crypto, protected storage, media tools, and required native-module support. Xcode/iOS native acceptance has not been available on this Mac; JavaScript export is not native execution proof.
- [ ] **IOS-FEATURES** — Record a separate iOS result for every applicable stable case ID above; exercise platform-specific navigation, safe areas, keyboard, permissions, image editing, file save/restore, and process recovery. Mark Android-only notification-listener music capture explicitly not applicable; do not invent an iOS replacement flow.
- [ ] **IOS-PROVIDERS** — Verify iOS GIPHY/provider keys, APNs/push delivery, Google authorization/Drive return flows, and the release-signed app on device.
- [ ] **FINAL-ACCEPTANCE** — Resolve failed/investigated required cases, unblock configured-provider checks, and obtain owner acceptance of the completed feature/device matrix. Custom Circle emoji and web support are outside this MVP checklist.

## References

- [Project status](project-status.md)
- [Approved UI/backend requirements](ui-backend-handoff.md) — some historical implementation notes predate the native-only conversion; current source and newer contracts resolve those notes.
- [Private Moments](private-moments.md), [Circle Moments](circle-moments.md), [Circle membership](circle-membership.md), and [Circle collections](circle-collections.md)
- [Encrypted media](encrypted-media.md), [history backup](history-backup.md), and [Now Playing](now-playing-android.md)
- [Android native crypto probe evidence](../../validation/e2e/android/README.md) — primitive/protocol evidence is separate from the product journeys above.

