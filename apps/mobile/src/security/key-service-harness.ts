import { AuthError, createAuthAPI, type Session } from '../features/auth/api';
import { createSocialAPI } from '../features/social/api';
import { createMessageAPI } from '../features/messages/api';
import { receiveDelivery } from '../features/messages/receive';
import { createInboxSynchronizer } from '../features/messages/inbox-sync';
import { sendMessage } from '../features/messages/send';
import { createOutboxSynchronizer } from '../features/messages/outbox-sync';
import * as Crypto from 'expo-crypto';
import { createKeyAPI, KeyPublicationError, publishAccountKeys } from './key-publication';
import { durableEncryption, DurableEncryptionError, type DurableEnvelope } from './durable-encryption';
import { signAccountPublication } from './account-encryption';
import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';

function assert(value: boolean): asserts value { if (!value) throw new Error('KEY_SERVICE_ASSERTION'); }
async function denied(work: () => Promise<unknown>) {
  try { await work(); } catch (error) { if (error instanceof KeyPublicationError && error.code === 'DENIED') return; throw error; }
  throw new Error('KEY_SERVICE_AUTHORIZATION_FAILED');
}

export async function runKeyServiceHarness() {
  if (!__DEV__) throw new Error('UNAVAILABLE');
  const origin = 'http://127.0.0.1:8089';
  const auth = createAuthAPI(origin, true), sessions: Session[] = [];
  const run = Date.now().toString();
  try {
    for (let i = 0; i < 2; i++) {
      const phone = `+1999${run.slice(-8)}${i}`, device = `synthetic-device-${run}-${i}`;
      const challenge = await auth.start(phone, device, `login-${run}-${i}`);
      sessions.push(await auth.verify(challenge.challengeId, await auth.developmentCode(phone), device));
    }
    const adapters = [];
    for (let i = 0; i < 2; i++) {
      const namespace = ['probe-durable-a', 'probe-durable-b'][i];
      const reset = JSON.parse(await nativeCrypto().durableProbe(namespace, 'reset', ''));
      assert(reset.ok === true);
      const native = durableEncryption(namespace), session = sessions[i];
      await native.initialize();
      const bound = { ...native, signPublication: (operation: string) =>
        signAccountPublication(() => session, session, operation, native.signPublication) };
      adapters.push(bound);
      const keys = createKeyAPI(origin, () => session, true);
      await publishAccountKeys(() => session, bound, keys.publish, () => `publication-${run}-${i}`);
      const status = await native.prekeyStatus();
      assert(status.pending === null && status.unpublished === 0 && status.stored === 20);
    }
    const [alice, bob] = sessions, [a, b] = adapters;
    const keys = createKeyAPI(origin, () => alice, true);
    const input = { operationId: `private-${run}`, targetId: bob.account.id };
    await denied(() => keys.allocate(input));
    const socialA = createSocialAPI(origin, () => alice, true), socialB = createSocialAPI(origin, () => bob, true);
    const request = await socialA.requestFriend(bob.account.pin);
    await socialB.respondFriend(request.id, true);
    const allocated = await keys.allocate(input);
    assert(JSON.stringify(await keys.allocate(input)) === JSON.stringify(allocated));
    const bobKeys = await b.bundle();
    assert(allocated.generation === bob.generation && allocated.bundle.identity === bobKeys.identity && allocated.bundle.signingIdentity === bobKeys.signingIdentity);
    await a.observePeer(bob.account.id, bobKeys);
    await b.observePeer(alice.account.id, await a.bundle());
    const messageA = createMessageAPI(origin, () => alice, true), messageB = createMessageAPI(origin, () => bob, true);
    const current = await messageA.context({ targetId: bob.account.id });
    const operation = `native-message-${run}`, { conversation, audience } = current;
    let senderAllocations = 0;
    const senderKeys = { allocate: async (request: Parameters<typeof keys.allocate>[0]) => { senderAllocations++; return keys.allocate(request); } };
    const allocationID = (operation: string, peer: string) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,
      JSON.stringify(['awsemchat.allocation.v1', operation, peer]));
    const draft = { operation, targetId: bob.account.id, plaintext: 'synthetic server-allocated session' };
    const event = await sendMessage(a, messageA, senderKeys, draft, allocationID);
    assert((await a.outgoingHistory()).find(record => record.operation === operation)?.status === 'sent');
    assert((await sendMessage(a, messageA, senderKeys, draft, allocationID)).id === event.id && senderAllocations === 1);
    for (const changed of [{ ...draft, plaintext: 'changed' }, { ...draft, targetId: alice.account.id }]) {
      try { await sendMessage(a, messageA, senderKeys, changed, allocationID); throw new Error('CHANGED_DRAFT_ACCEPTED'); }
      catch (error) { if (!(error instanceof DurableEncryptionError) || error.code !== 'OPERATION_CONFLICT') throw error; }
    }
    assert((await messageA.status(event.id)).status === 'sent');
    const page = await messageB.inbox();
    assert(page.items.length === 1 && page.items[0].id === event.id);
    const delivery = page.items[0];
    const received = await b.receive({ peer: delivery.senderId, operation, conversation, audience, message: delivery.message });
    assert(received.plaintext === 'synthetic server-allocated session');
    assert((await messageA.status(event.id)).status === 'sent');
    await receiveDelivery(b, messageB, delivery);
    await receiveDelivery(b, messageB, delivery);
    assert((await b.history()).length === 1 && (await messageA.status(event.id)).status === 'delivered');
    const receipt = await messageA.status(event.id);
    await a.confirmSend({ operation: receipt.operation, event: receipt.id, status: receipt.status });
    await a.confirmSend({ operation, event: event.id, status: 'sent' });
    assert((await durableEncryption('probe-durable-a').outgoingHistory()).find(record => record.operation === operation)?.status === 'delivered');
    const inbox = createInboxSynchronizer(b, messageB);
    await inbox.run();
    assert(await b.inboxCursor() === event.id);
    assert(await durableEncryption('probe-durable-b').inboxCursor() === event.id);
    const nextEvent = await sendMessage(a, messageA, senderKeys, { ...draft, operation: `second-message-${run}`, plaintext: 'synthetic reused session' }, allocationID);
    assert(senderAllocations === 1);
    await inbox.run();
    assert((await b.history()).length === 2 && (await messageA.status(nextEvent.id)).status === 'delivered');
    const outbox = createOutboxSynchronizer(a, messageA);
    await outbox.run();
    assert((await a.outgoingHistory()).find(record => record.operation === nextEvent.operation)?.status === 'delivered');
    const pendingOperation = `pending-${run}`;
    await a.send({ operation: pendingOperation, conversation, audience, target: bob.account.id, recipients: [bob.account.id], plaintext: 'synthetic offline queue' });
    await outbox.run();
    assert((await a.outgoingHistory()).find(record => record.operation === pendingOperation)?.status === 'sent');
    await inbox.run();
    await outbox.run();
    assert((await a.outgoingHistory()).find(record => record.operation === pendingOperation)?.status === 'delivered');
    assert(JSON.stringify((await b.history()).map(record => record.sequence)) === JSON.stringify([1, 2, 3]));
    const circle = await socialA.createCircle(`circle-${run}`);
    const invite = await socialA.invite(circle.id, bob.account.id);
    await socialB.respondInvitation(invite.id, true);
    const details = await socialA.circle(circle.id);
    const circleInput = { operationId: `circle-allocation-${run}`, targetId: bob.account.id, circleId: circle.id, epoch: details.epoch };
    await keys.allocate(circleInput);
    const circleContext = await messageA.context({ circleId: circle.id });
    const circleWire: DurableEnvelope = JSON.parse(await a.send({ operation: `circle-message-${run}`, conversation: circleContext.conversation,
      audience: circleContext.audience, recipients: [bob.account.id], plaintext: 'synthetic fixed Circle audience' }));
    const circleEvent = await messageA.send(JSON.stringify(circleWire));
    await socialA.removeMember(circle.id, bob.account.id);
    assert((await messageA.status(circleEvent.id)).status === 'sent');
    assert(!(await messageB.inbox(await b.inboxCursor() ?? '')).items.some(item => item.id === circleEvent.id));
    await inbox.run();
    assert(await b.inboxCursor() === circleEvent.id);
    assert((await b.history()).length === 3);
    await denied(() => keys.allocate(circleInput));
    await socialA.leave(circle.id);
    await socialA.blockAccount(bob.account.id, true);
    await denied(() => keys.allocate(input));
    return ['NATIVE_PUBLICATION_TO_GO_POSTGRES', 'NATIVE_ACK_AFTER_SERVER_COMMIT', 'PRIVATE_CONSENT_ENFORCED',
      'SERVER_ALLOCATION_EXACT_RETRY', 'NATIVE_SESSION_FROM_SERVER_ALLOCATION', 'CIRCLE_ALLOCATION_CURRENT_AUDIENCE', 'REMOVED_AND_BLOCKED_ALLOCATION_REJECTED',
      'NATIVE_MESSAGE_RELAY_INBOX', 'LOST_ACK_EXACT_RECEIVE_RECOVERY', 'RECEIPT_RETRY_WITHOUT_DUPLICATE_PLAINTEXT', 'FIXED_CIRCLE_RECIPIENT_DELIVERY',
      'SEALED_INBOX_CURSOR_REOPEN', 'DENIED_PAGE_CURSOR_WITHOUT_PLAINTEXT', 'SENDER_ALLOCATES_ONLY_FIRST_SESSION', 'SENDER_EXACT_OUTBOX_RETRY', 'CHANGED_DRAFT_REJECTED_NATIVE', 'LOCAL_SENDER_RECEIPT_REOPEN',
      'AUTOMATIC_RECEIPT_REFRESH', 'PENDING_OUTBOX_RECOVERY', 'NATIVE_LOCAL_MESSAGE_ORDER'];
  } catch (error) {
    if (error instanceof AuthError || error instanceof KeyPublicationError) console.info('AWSEM_KEY_SERVICE_BOUNDARY', error.code);
    throw error;
  } finally {
    await Promise.all(sessions.map(session => auth.logout(session.accessToken).catch(() => undefined)));
  }
}
