import { disposeAccounts } from './dispose-accounts';
import { fromByteArray, toByteArray } from 'base64-js';
import { encryption as e, EncryptionError, type AccountHandle, type Ciphertext, type SessionHandle } from './encryption-adapter';

const checks = ['BIDIRECTIONAL', 'OUTSIDER_REJECTED', 'WRONG_IDENTITY_REJECTED', 'TAMPER_REJECTED',
  'REPLAY_REJECTED', 'PREJOIN_EXCLUDED', 'JOIN_FANOUT', 'REMOVED_FUTURE_EXCLUDED', 'DISPOSED_REJECTED'] as const;
function assert(value: boolean): asserts value { if (!value) throw new Error('PROBE_ASSERTION'); }
async function rejected(operation: () => Promise<unknown>, code: string) {
  try { await operation(); } catch (error) {
    if (error instanceof EncryptionError && error.code === code) return;
    throw new Error('PROBE_WRONG_REJECTION');
  }
  throw new Error('PROBE_ACCEPTED_INVALID');
}
function tamper(message: Ciphertext): Ciphertext {
  const padded = message.body + '='.repeat((4 - message.body.length % 4) % 4);
  const bytes = toByteArray(padded);
  bytes[bytes.length - 1] ^= 1;
  return { kind: message.kind, body: fromByteArray(bytes).replace(/=+$/, '') };
}

export async function runNativeCryptoHarness() {
  if (!__DEV__) throw new Error('PROBE_UNAVAILABLE');
  const accounts: AccountHandle[] = [];
  try {
    for (let i = 0; i < 4; i++) accounts.push(await e.createAccount());
    const [alice, bob, carol, outsider] = accounts;
    // These public identities are trusted synthetic fixtures created locally, not a key-directory test.
    const [a, b, c] = await Promise.all([e.publicBundle(alice), e.publicBundle(bob), e.publicBundle(carol)]);
    const ab = await e.outbound(alice, b);
    const first = await e.encrypt(ab, 'synthetic prejoin event');
    await rejected(() => e.inbound(outsider, a.identity, first), 'CRYPTO_REJECTED');
    await rejected(() => e.inbound(bob, c.identity, first), 'CRYPTO_REJECTED');
    await rejected(() => e.inbound(carol, a.identity, first), 'CRYPTO_REJECTED');
    const ba = await e.inbound(bob, a.identity, first);
    assert(ba.plaintext === 'synthetic prejoin event');
    assert(await e.decrypt(ab, await e.encrypt(ba.session, 'synthetic reply')) === 'synthetic reply');
    const intact = await e.encrypt(ab, 'synthetic authenticated event');
    await rejected(() => e.decrypt(ba.session, tamper(intact)), 'CRYPTO_REJECTED');
    assert(await e.decrypt(ba.session, intact) === 'synthetic authenticated event');
    await rejected(() => e.decrypt(ba.session, intact), 'CRYPTO_REJECTED');

    const ac = await e.outbound(alice, c);
    const sessions: Record<string, SessionHandle> = { bob: ab, carol: ac };
    // The fixture supplies an exact authorized set. Production must obtain and enforce it transactionally.
    async function fanout(recipients: string[], plaintext: string) {
      const envelopes: Record<string, Ciphertext> = {};
      for (const recipient of recipients) envelopes[recipient] = await e.encrypt(sessions[recipient], plaintext);
      assert(Object.keys(envelopes).sort().join(',') === [...recipients].sort().join(','));
      return envelopes;
    }
    const prejoin = { bob: first };
    assert(Object.keys(prejoin).join(',') === 'bob');
    const joined = await fanout(['bob', 'carol'], 'synthetic joined event');
    assert(await e.decrypt(ba.session, joined.bob) === 'synthetic joined event');
    const ca = await e.inbound(carol, a.identity, joined.carol);
    assert(ca.plaintext === 'synthetic joined event');
    assert(await e.decrypt(ac, await e.encrypt(ca.session, 'synthetic carol reply')) === 'synthetic carol reply');
    const removed = await fanout(['carol'], 'synthetic after removal');
    assert(!Object.hasOwn(removed, 'bob'));
    await rejected(() => e.decrypt(ba.session, removed.carol), 'CRYPTO_REJECTED');
    assert(await e.decrypt(ca.session, removed.carol) === 'synthetic after removal');
    await e.disposeSession(ab);
    await rejected(() => e.encrypt(ab, 'synthetic disposed'), 'INVALID_HANDLE');
    return [...checks];
  } finally {
    await disposeAccounts(accounts, e.disposeAccount);
  }
}
