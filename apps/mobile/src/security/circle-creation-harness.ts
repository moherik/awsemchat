import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { authenticationRuntime } from '../features/auth/runtime';
import { createAuthAPI } from '../features/auth/api';
import { createSocialAPI } from '../features/social/api';
import { createCircleCreation } from '../features/social/circle-creation';
import { nativeCircleCreationVault } from '../features/social/circle-creation-storage';
import { selectCircleProfile } from '../features/social/circle-profile';

const origin = 'http://127.0.0.1:8090';
const fixtureKey = 'probe.circle.creation.20261012';
function assert(value: unknown): asserts value { if (!value) throw new Error('CIRCLE_CREATION_ASSERTION'); }
export async function runCircleCreationHarness(phase: string) {
  if (!__DEV__ || process.env.EXPO_PUBLIC_API_URL !== origin) throw new Error('PROBE_CONFIG_REQUIRED');
  const runtime = await authenticationRuntime();
  const auth = createAuthAPI(origin, true);
  if (phase === 'circleCreationLiveSeed') {
    assert(runtime.flow.getSnapshot().phase === 'phone');
    const run = Date.now().toString();
    const ownPhone = `+1998${run.slice(-8)}0`, peerPhone = `+1998${run.slice(-8)}1`, peerDevice = `circle-peer-${run}`;
    await runtime.flow.submitPhone(ownPhone);
    await runtime.flow.verify(await runtime.developmentCode(ownPhone));
    const challenge = await auth.start(peerPhone, peerDevice, `peer-login-${run}`);
    const peer = await auth.verify(challenge.challengeId, await auth.developmentCode(peerPhone), peerDevice);
    try {
      const request = await runtime.social.requestFriend(peer.account.pin);
      await createSocialAPI(origin, () => peer, true).respondFriend(request.id, true);
      await SecureStore.setItemAsync(fixtureKey, JSON.stringify({ peerPhone, peerDevice, peerId: peer.account.id, run }));
      const session = runtime.owner.requireSession();
      const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
        'awsemchat.pending-circle.v1', origin, session.account.id, session.deviceId, session.generation,
      ]));
      const vault = nativeCircleCreationVault(fingerprint);
      assert(await vault.read() === null);
      const controller = createCircleCreation({ vault, binding: () => fingerprint, operation: Crypto.randomUUID,
        api: { ...runtime.social, async createCircle(operation) { await runtime.social.createCircle(operation); throw new Error('SYNTHETIC_LOST_CREATE_REPLY'); } },
        sender: runtime.sender,
      });
      try { await controller.start({ name: 'Verified family Circle', description: 'Native interrupted-creation verification', avatar: null, invitees: [peer.account.id] }); throw new Error('FAULT_NOT_TRIGGERED'); }
      catch (error) { assert(error instanceof Error && error.message === 'SYNTHETIC_LOST_CREATE_REPLY'); }
      const saved = await controller.pending();
      assert(saved && !saved.circleId && !saved.completed && saved.invitees[0] === peer.account.id);
      assert((await runtime.social.circles()).items.length === 1);
      return ['SIGNED_IN_NATIVE_ACCOUNT_PREPARED', 'REAL_FRIENDSHIP_ACCEPTED', 'LOST_CREATE_RESPONSE_PENDING_DURABLE', 'ONE_REMOTE_CIRCLE_CREATED'];
    } finally { await auth.logout(peer.accessToken); }
  }
  assert(runtime.flow.getSnapshot().phase === 'ready');
  const fixture = JSON.parse(await SecureStore.getItemAsync(fixtureKey) ?? 'null');
  assert(fixture && typeof fixture.peerId === 'string');
  if (phase === 'circleCreationLiveCleanup') {
    await SecureStore.deleteItemAsync(fixtureKey);
    await runtime.flow.logout();
    return ['SYNTHETIC_CREATOR_SESSION_LOGGED_OUT'];
  }
  const session = runtime.owner.requireSession();
  const fingerprint = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify([
    'awsemchat.pending-circle.v1', origin, session.account.id, session.deviceId, session.generation,
  ]));
  const vault = nativeCircleCreationVault(fingerprint);
  if (phase === 'circleCreationLiveProfile') {
    const controller = createCircleCreation({ vault, binding: () => fingerprint, operation: Crypto.randomUUID, api: runtime.social,
      sender: { async send(draft) { await runtime.sender.send(draft); throw new Error('SYNTHETIC_LOST_PROFILE_REPLY'); } },
    });
    const before = await controller.pending();
    assert(before && !before.circleId);
    try { await controller.resume(); throw new Error('FAULT_NOT_TRIGGERED'); }
    catch (error) { assert(error instanceof Error && error.message === 'SYNTHETIC_LOST_PROFILE_REPLY'); }
    const after = await controller.pending();
    assert(after?.circleId && !after.profileSent && after.createOperation === before.createOperation && after.profileOperation === before.profileOperation);
    assert((await runtime.social.circles()).items.length === 1);
    const history = await runtime.encryption().outgoingHistory();
    assert(history.filter(item => item.operation === after.profileOperation && item.status === 'sent').length === 1);
    return ['ACCOUNT_AND_CREATION_REOPEN_AFTER_PROCESS_RESTART', 'EXACT_CREATE_RETRY_ONE_CIRCLE', 'LOST_PROFILE_REPLY_NATIVE_COMMIT_RETAINED'];
  }
  assert(phase === 'circleCreationLiveFinish');
  const controller = await runtime.circleCreation();
  const before = await controller.pending();
  assert(before?.circleId && !before.profileSent);
  const result = await controller.resume();
  assert(result.circleId === before.circleId);
  const saved = await controller.pending();
  assert(saved?.completed && saved.profileSent && saved.invitees[0] === fixture.peerId);
  assert((await controller.resume()).circleId === result.circleId);
  assert((await runtime.social.circles()).items.length === 1);
  const context = await runtime.messages.context({ circleId: result.circleId });
  assert(context.profileRevision === 1);
  await runtime.history.refresh();
  const profile = selectCircleProfile(runtime.history.getSnapshot(), result.circleId);
  assert(profile.state === 'ready' && profile.profile.name === 'Verified family Circle');
  const outgoing = await runtime.encryption().outgoingHistory();
  assert(outgoing.filter(item => item.operation === saved.profileOperation && item.event).length === 1);
  const challenge = await auth.start(fixture.peerPhone, fixture.peerDevice, `peer-resume-${fixture.run}`);
  const peer = await auth.verify(challenge.challengeId, await auth.developmentCode(fixture.peerPhone), fixture.peerDevice);
  try {
    const social = createSocialAPI(origin, () => peer, true);
    const invitations = await social.invitations();
    assert(invitations.items.length === 1 && invitations.items[0].circleId === result.circleId);
    assert((await runtime.social.circle(result.circleId)).memberCount === 1);
    await social.respondInvitation(invitations.items[0].id, true);
    assert((await runtime.social.circle(result.circleId)).memberCount === 2);
    await controller.acknowledge(result.circleId);
    assert(await controller.pending() === undefined);
    return ['PRODUCTION_CONTROLLER_EXACT_PROFILE_RETRY', 'ONE_ACCEPTED_PROFILE_REVISION', 'CREATOR_PROFILE_NAME_PROJECTED', 'COMPLETED_RESULT_REOPEN_NO_DUPLICATES', 'ONE_REAL_INVITATION', 'MEMBERSHIP_REQUIRES_ACCEPTANCE', 'CREATION_RESULT_ACKNOWLEDGED'];
  } finally { await auth.logout(peer.accessToken); }
}
