import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/features/social/account-circle-creation.ts').catch(() => ({}));
function fixture() {
  let session = { account: { id: 'alice' }, deviceId: 'phone-1', generation: 1, accessToken: 'secret-token' };
  let record = null;
  const vault = { read: async () => record, write: async value => { record = value; }, clear: async () => { record = null; } };
  const ports = { session: () => session, ready: () => true, fingerprint: async () => 'a'.repeat(64), vault: () => vault,
    operation: (() => { let n = 0; return () => `op-${++n}`; })(), api: {}, sender: {} };
  return { ports, set session(value) { session = value; }, get session() { return session; } };
}
test('account change while opening a creation vault cannot return a usable controller', async () => {
  assert.equal(typeof module.openAccountCircleCreation, 'function', 'account-bound creation supplier is missing');
  const f = fixture();
  f.ports.fingerprint = async () => { f.session = { ...f.session, generation: 2 }; return 'a'.repeat(64); };
  await assert.rejects(module.openAccountCircleCreation(f.ports), { message: 'SESSION_CHANGED' });
});
test('an opened controller rejects token replacement before reading or publishing drafts', async () => {
  assert.equal(typeof module.openAccountCircleCreation, 'function', 'account-bound creation supplier is missing');
  const f = fixture(), controller = await module.openAccountCircleCreation(f.ports);
  f.session = { ...f.session, accessToken: 'replacement-token' };
  await assert.rejects(controller.pending(), { message: 'SESSION_CHANGED' });
});
