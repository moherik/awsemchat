import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { durableEncryption, DurableEncryptionError, type DurableEnvelope, type PeerKeys } from './durable-encryption';
const names = ['probe-durable-a', 'probe-durable-b', 'probe-durable-c', 'probe-durable-fault'];
const input = { operation: 'one', conversation: 'private-room', audience: 'room-revision-1', recipients: ['bob'], plaintext: 'synthetic durable event' };
function assert(value: boolean): asserts value { if (!value) throw new Error('ASSERTION'); }
function keys(bundle: PeerKeys): PeerKeys { return { identity: bundle.identity, signingIdentity: bundle.signingIdentity }; }
async function rejected(operation: () => Promise<unknown>, code: string) {
  try { await operation(); } catch (e) { if (e instanceof DurableEncryptionError && e.code === code) return; throw new Error('WRONG_REJECTION'); }
  throw new Error('ACCEPTED_INVALID');
}
async function control(namespace: string, action: string, input = '') {
  const response = JSON.parse(await nativeCrypto().durableProbe(namespace, action, input));
  if (response.ok !== true) throw new DurableEncryptionError(response.code); return response.value;
}
export async function runDurableCryptoHarness(phase: string) {
  if (!__DEV__) throw new Error('UNAVAILABLE');
  const [a, b, c] = names.map(durableEncryption);
  if (phase === 'recoverBefore') {
    await rejected(() => a.retry('one'), 'UNKNOWN_OPERATION');
    const bytes = await a.send(input); const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await b.receive({ peer: 'alice', operation: 'one', conversation: input.conversation,
      audience: input.audience, message: wire.recipients[0].message })).plaintext === input.plaintext);
    return ['PROCESS_DEATH_BEFORE_COMMIT_ROLLBACK', 'RECOVERED_SEND_RECEIVE'];
  }
  if (phase === 'recoverAfter') {
    const bytes = await a.retry('two'); assert(await a.retry('two') === bytes);
    const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await b.receive({ peer: 'alice', operation: 'two', conversation: input.conversation,
      audience: input.audience, message: wire.recipients[0].message })).plaintext === input.plaintext);
    assert(await control(names[0], 'compareCheckpoint', await a.retry('one')) === true);
    return ['PROCESS_DEATH_AFTER_COMMIT_RECOVERY', 'COMMITTED_RATCHET_CIPHERTEXT', 'PRIOR_CIPHERTEXT_UNCHANGED'];
  }
  if (phase === 'resume') {
    const bytes = await a.retry('one');
    assert(await control(names[0], 'compareCheckpoint', bytes) === true);
    const wire: DurableEnvelope = JSON.parse(bytes);
    assert((await a.bundle()).identity === wire.sender.identity);
    assert((await b.history()).length === 1);
    await rejected(() => b.receive({ peer: 'alice', operation: 'one', conversation: 'private-room', audience: input.audience, message: wire.recipients[0].message }), 'REPLAY');
    assert(await a.send(input) === bytes);
    return ['PROCESS_RESTART_EXACT_RETRY', 'PROCESS_RESTART_IDENTITY', 'PROCESS_RESTART_REPLAY_HISTORY'];
  }
  for (const name of names) await control(name, 'reset');
  const ab = await a.initialize(); const bb = await b.initialize(); const cb = await c.initialize();
  await a.observePeer('bob', keys(bb)); await b.observePeer('alice', keys(ab));
  await a.outbound('bob', bb.prekey);
  if (phase === 'crashBefore') {
    await control(names[0], 'killBeforeCommit'); await a.send(input); throw new Error('PROCESS_NOT_KILLED');
  }
  if (phase === 'crashAfter') {
    await control(names[0], 'checkpoint', await a.send(input));
    await control(names[0], 'killAfterCommit'); await a.send({ ...input, operation: 'two' }); throw new Error('PROCESS_NOT_KILLED');
  }
  await control(names[0], 'rollback');
  await rejected(() => a.send(input), 'COMMIT_FAILED');
  await rejected(() => a.retry('one'), 'UNKNOWN_OPERATION');
  await control(names[0], 'afterCommit');
  await rejected(() => a.send(input), 'COMMIT_UNKNOWN');
  const bytes = await a.retry('one'); assert(await a.send(input) === bytes);
  const wire: DurableEnvelope = JSON.parse(bytes);
  const incoming = { peer: 'alice', operation: 'one', conversation: 'private-room', audience: input.audience, message: wire.recipients[0].message };
  await control(names[1], 'rollback'); await rejected(() => b.receive(incoming), 'COMMIT_FAILED');
  assert((await b.history()).length === 0);
  assert((await b.receive(incoming)).plaintext === input.plaintext);
  await rejected(() => b.receive(incoming), 'REPLAY');
  assert((await b.history()).length === 1);
  const reply: DurableEnvelope = JSON.parse(await b.send({ ...input, operation: 'reply', recipients: ['alice'] }));
  assert((await a.receive({ peer: 'bob', operation: 'reply', conversation: input.conversation,
    audience: input.audience, message: reply.recipients[0].message })).plaintext === input.plaintext);
  assert(await a.retry('one') === bytes);
  await rejected(() => a.send({ ...input, audience: 'changed' }), 'OPERATION_CONFLICT');
  await c.importHistory(await b.exportHistory());
  assert((await c.history())[0].archival && (await c.bundle()).identity === cb.identity);
  await rejected(() => c.retry('one'), 'UNKNOWN_OPERATION');
  await control(names[0], 'checkpoint', bytes);
  if (phase === 'seed') return ['RESTART_SEED_COMMITTED'];
  await a.verifyPeer('bob', keys(bb));
  assert((await a.observePeer('bob', keys(cb))).verified === false);
  await rejected(() => a.retry('one'), 'IDENTITY_CHANGED');
  await rejected(() => a.send({ ...input, operation: 'two' }), 'IDENTITY_CHANGED');
  await a.acknowledgePeer('bob', keys(cb)); await rejected(() => a.retry('one'), 'IDENTITY_CHANGED');
  await a.outbound('bob', cb.prekey);
  await a.send({ ...input, operation: 'two' });
  for (const action of ['corrupt', 'wrongKey', 'deleteKey', 'deleteRow', 'wrongVersion']) {
    const name = names[3]; await control(name, 'reset');
    const fault = durableEncryption(name); await fault.initialize();
    await control(name, action);
    await rejected(() => fault.bundle(), action === 'wrongVersion' ? 'STATE_VERSION' : 'STATE_UNAVAILABLE');
    await rejected(() => fault.initialize(), 'ALREADY_EXISTS');
  }
  return ['ROLLBACK_OUTBOX', 'COMMIT_LOST_REPLY', 'EXACT_RETRY_REOPEN', 'ATOMIC_RECEIVE_REPLAY_HISTORY',
    'DURABLE_BIDIRECTIONAL', 'IMMUTABLE_AUDIENCE', 'HISTORY_ONLY_RESTORE', 'PIN_CHANGE_QUARANTINE', 'CORRUPT_SEAL', 'WRONG_KEY', 'KEY_LOSS', 'MISSING_ROW', 'FORMAT_VERSION'];
}
