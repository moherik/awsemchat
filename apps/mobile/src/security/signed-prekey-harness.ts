import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { durableEncryption, DurableEncryptionError, type DurableEnvelope, type SignedPublicBundle } from './durable-encryption';
const names = ['probe-durable-a', 'probe-durable-b', 'probe-durable-c', 'probe-durable-fault'];
const input = { operation: 'prekey-event', conversation: 'synthetic-room', audience: 'one', recipients: ['bob'], plaintext: 'synthetic signed prekey event' };
function assert(value: boolean): asserts value { if (!value) throw new Error('PREKEY_ASSERTION'); }
async function rejected(operation: () => Promise<unknown>, code: string) {
  try { await operation(); } catch (error) {
    if (error instanceof DurableEncryptionError && error.code === code) return;
    throw new Error('PREKEY_WRONG_REJECTION');
  }
  throw new Error('PREKEY_ACCEPTED_INVALID');
}
async function control(namespace: string, action: string, input = '') {
  const result = JSON.parse(await nativeCrypto().durableProbe(namespace, action, input));
  if (result.ok !== true) throw new DurableEncryptionError(result.code);
  return result.value;
}
function receive(bytes: string) {
  const wire: DurableEnvelope = JSON.parse(bytes);
  return { peer: 'alice', operation: input.operation, conversation: input.conversation,
    audience: input.audience, message: wire.recipients[0].message };
}
export async function runSignedPrekeyHarness(phase: string) {
  if (!__DEV__) throw new Error('UNAVAILABLE');
  const [a, b, c] = names.map(durableEncryption);
  if (phase === 'prekeyResume') {
    const batch = await b.preparePublication('initial');
    assert(await control(names[1], 'compareCheckpoint', JSON.stringify(batch)) === true);
    assert((await b.prekeyStatus()).stored === 20 && (await b.prekeyStatus()).unpublished === 0);
    const incoming = receive(await a.retry(input.operation));
    await rejected(() => b.receive(incoming), 'REPLAY');
    assert((await b.history()).length === 1);
    return ['SIGNED_PUBLICATION_EXACT_PROCESS_RESTART', 'CONSUMED_PREKEY_REPLAY_RESTART', 'REPLENISHMENT_RESTART'];
  }
  if (phase === 'prekeyRecoverPublicationBefore' || phase === 'prekeyRecoverPublicationAfter') {
    const committed = phase === 'prekeyRecoverPublicationAfter';
    const status = await b.prekeyStatus();
    assert(status.stored === (committed ? 20 : 0) && status.pending === (committed ? 'initial' : null));
    const batch = await b.preparePublication('initial');
    assert(JSON.stringify(await b.preparePublication('initial')) === JSON.stringify(batch));
    await b.confirmPublication('initial');
    await a.observePeer('bob', await b.bundle()); await a.outbound('bob', batch.bundles[0]);
    return [committed ? 'PUBLICATION_PROCESS_DEATH_AFTER_COMMIT' : 'PUBLICATION_PROCESS_DEATH_BEFORE_COMMIT', 'RECOVERED_SIGNATURE_VALID'];
  }
  if (phase === 'prekeyRecoverConsumptionBefore' || phase === 'prekeyRecoverConsumptionAfter') {
    const committed = phase === 'prekeyRecoverConsumptionAfter';
    assert((await b.prekeyStatus()).stored === (committed ? 19 : 20));
    assert((await b.history()).length === (committed ? 1 : 0));
    const incoming = receive(await a.retry(input.operation));
    if (committed) await rejected(() => b.receive(incoming), 'REPLAY');
    else assert((await b.receive(incoming)).plaintext === input.plaintext);
    assert((await b.prekeyStatus()).stored === 19 && (await b.history()).length === 1);
    assert((await b.preparePublication('refill')).bundles.length === 1);
    await b.confirmPublication('refill');
    const reply: DurableEnvelope = JSON.parse(await b.send({ ...input, operation: 'recovered-reply', recipients: ['alice'] }));
    assert((await a.receive({ peer: 'bob', operation: 'recovered-reply', conversation: input.conversation,
      audience: input.audience, message: reply.recipients[0].message })).plaintext === input.plaintext);
    return [committed ? 'CONSUMPTION_PROCESS_DEATH_AFTER_COMMIT' : 'CONSUMPTION_PROCESS_DEATH_BEFORE_COMMIT', 'RECOVERED_CONSUMPTION_REPLENISHMENT', 'RECOVERED_SESSION_BIDIRECTIONAL'];
  }
  for (const name of names) await control(name, 'reset');
  const ab = await a.initialize(); const bb = await b.initialize(); const cb = await c.initialize();
  if (phase === 'prekeyCrashPublicationBefore' || phase === 'prekeyCrashPublicationAfter') {
    await control(names[1], phase === 'prekeyCrashPublicationBefore' ? 'killBeforeCommit' : 'killAfterCommit');
    await b.preparePublication('initial'); throw new Error('PROCESS_NOT_KILLED');
  }
  await control(names[1], 'rollback');
  await rejected(() => b.preparePublication('initial'), 'COMMIT_FAILED');
  assert((await b.prekeyStatus()).stored === 0);
  await control(names[1], 'afterCommit');
  await rejected(() => b.preparePublication('initial'), 'COMMIT_UNKNOWN');
  const batch = await b.preparePublication('initial');
  assert(batch.bundles.length === 20);
  await control(names[1], 'checkpoint', JSON.stringify(batch));
  assert(JSON.stringify(await b.preparePublication('initial')) === JSON.stringify(batch));
  await control(names[1], 'afterCommit');
  await rejected(() => b.confirmPublication('initial'), 'COMMIT_UNKNOWN');
  await b.confirmPublication('initial');
  assert((await b.prekeyStatus()).unpublished === 0);
  await a.observePeer('bob', bb); await b.observePeer('alice', ab);
  const bundle = batch.bundles[0];
  for (const [field, value, code] of [
    ['prekey', batch.bundles[1].prekey, 'SIGNATURE_REJECTED'],
    ['identity', cb.identity, 'IDENTITY_CHANGED'],
    ['signingIdentity', cb.signingIdentity, 'IDENTITY_CHANGED'],
    ['signature', batch.bundles[1].signature, 'SIGNATURE_REJECTED'],
    ['signature', 'bad', 'INVALID_INPUT'],
    ['context', 'other', 'BUNDLE_VERSION'],
    ['version', 2, 'BUNDLE_VERSION'],
  ] as const) {
    await rejected(() => a.outbound('bob', { ...bundle, [field]: value } as SignedPublicBundle), code);
  }
  const unsigned = JSON.parse(await nativeCrypto().executeDurable(names[0], JSON.stringify({ op: 'outbound', peer: 'bob', prekey: bundle.prekey })));
  assert(unsigned.ok === false && unsigned.code === 'INVALID_INPUT');
  await a.outbound('bob', bundle);
  const bytes = await a.send(input); const incoming = receive(bytes);
  if (phase === 'prekeyCrashConsumptionBefore' || phase === 'prekeyCrashConsumptionAfter') {
    await control(names[1], phase === 'prekeyCrashConsumptionBefore' ? 'killBeforeCommit' : 'killAfterCommit');
    await b.receive(incoming); throw new Error('PROCESS_NOT_KILLED');
  }
  await control(names[1], 'rollback'); await rejected(() => b.receive(incoming), 'COMMIT_FAILED');
  assert((await b.prekeyStatus()).stored === 20);
  await rejected(() => b.receive({ ...incoming, conversation: 'changed' }), 'CONTEXT_MISMATCH');
  assert((await b.prekeyStatus()).stored === 20);
  await control(names[1], 'afterCommit'); await rejected(() => b.receive(incoming), 'COMMIT_UNKNOWN');
  assert((await b.prekeyStatus()).stored === 19);
  await rejected(() => b.receive(incoming), 'REPLAY');
  await c.observePeer('bob', bb); await b.observePeer('carol', cb); await c.outbound('bob', bundle);
  const duplicate = receive(await c.send({ ...input, operation: 'reissued' }));
  await rejected(() => b.receive({ ...duplicate, peer: 'carol', operation: 'reissued' }), 'CRYPTO_REJECTED');
  const refill = await b.preparePublication('refill'); assert(refill.bundles.length === 1);
  assert(!batch.bundles.some(old => old.prekey === refill.bundles[0].prekey));
  await b.confirmPublication('initial'); assert((await b.prekeyStatus()).unpublished === 1);
  await b.confirmPublication('refill'); assert((await b.prekeyStatus()).stored === 20);
  return ['SIGNED_PREKEY_ACCEPTED', 'BUNDLE_TAMPER_REJECTED', 'UNSIGNED_DURABLE_REJECTED',
    'PUBLICATION_ROLLBACK_LOST_REPLY', 'EXACT_PUBLICATION_RETRY', 'STALE_ACK_ISOLATED',
    'CONSUMPTION_ROLLBACK_LOST_REPLY', 'CONSUMED_KEY_REISSUE_REJECTED', 'BOUNDED_FRESH_REPLENISHMENT'];
}
