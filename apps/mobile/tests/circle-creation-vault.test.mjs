import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const module = await import('../src/features/social/circle-creation-vault.ts').catch(() => ({}));
const binding = 'a'.repeat(64);
const job = { version: 1, binding, createOperation: 'create-1', profileOperation: 'profile-1', payload: 'private family name', invitees: ['friend-1'], profileSent: false, completed: false };
function fixture() {
  let metadata = null, next = 0;
  const files = new Map();
  const ports = {
    readMetadata: async () => metadata,
    writeMetadata: async value => { metadata = value; },
    clearMetadata: async () => { metadata = null; },
    writeFile: async (name, bytes) => { files.set(name, bytes); },
    readFile: async name => { if (!files.has(name)) throw Error('missing'); return files.get(name); },
    removeFile: async name => { files.delete(name); },
    name: () => `draft-${++next}.bin`,
    codec: {
      async encode(account, records) {
        const key = randomBytes(32), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(account));
        const bytes = Buffer.concat([nonce, cipher.update(JSON.stringify(records)), cipher.final(), cipher.getAuthTag()]);
        return { archive: bytes.toString('base64'), recoveryKey: key.toString('hex') };
      },
      async decode(account, archive, recoveryKey) {
        const bytes = Buffer.from(archive, 'base64'), cipher = createDecipheriv('aes-256-gcm', Buffer.from(recoveryKey, 'hex'), bytes.subarray(0, 12));
        cipher.setAAD(Buffer.from(account)); cipher.setAuthTag(bytes.subarray(-16));
        return { records: JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString()) };
      },
    },
  };
  return { ports, files, get metadata() { return metadata; }, vault: () => {
    assert.equal(typeof module.createCircleCreationVault, 'function', 'encrypted creation vault is missing');
    return module.createCircleCreationVault(ports, binding);
  } };
}
test('creation draft reopens from ciphertext with only a small protected pointer', async () => {
  const f = fixture(); await f.vault().write(job);
  assert.deepEqual(await f.vault().read(), job);
  assert.equal(f.metadata.includes(job.payload), false);
  assert.equal(f.metadata.includes('friend-1'), false);
  assert.equal([...f.files.values()].some(value => value.includes(job.payload)), false);
});
test('failed pointer update preserves the last committed creation record', async () => {
  const f = fixture(); await f.vault().write(job);
  f.ports.writeMetadata = async () => { throw Error('STORAGE'); };
  await assert.rejects(f.vault().write({ ...job, circleId: 'circle-1' }));
  assert.deepEqual(await f.vault().read(), job);
});
test('lost save response retains the ciphertext referenced by the committed pointer', async () => {
  const f = fixture(), write = f.ports.writeMetadata;
  f.ports.writeMetadata = async value => { await write(value); throw Error('UNKNOWN_COMMIT'); };
  await assert.rejects(f.vault().write(job)); assert.deepEqual(await f.vault().read(), job);
});
test('damaged ciphertext fails closed and cannot be overwritten by an update', async () => {
  const f = fixture(); await f.vault().write(job);
  f.files.set([...f.files.keys()][0], 'YQ==');
  await assert.rejects(f.vault().read(), { message: 'VAULT_INVALID' });
  await assert.rejects(f.vault().write({ ...job, circleId: 'circle-1' }), { message: 'VAULT_INVALID' });
  assert.notEqual(f.metadata, null);
});
test('foreign account cannot read or erase a creation record', async () => {
  const f = fixture(); await f.vault().write(job);
  const other = module.createCircleCreationVault(f.ports, 'b'.repeat(64));
  await assert.rejects(other.read(), { message: 'VAULT_INVALID' });
  await assert.rejects(other.clear(), { message: 'VAULT_INVALID' });
  assert.deepEqual(await f.vault().read(), job);
});
test('clear removes only the referenced creation file after clearing its pointer', async () => {
  const f = fixture(); await f.vault().write(job); f.files.set('unrelated.bin', 'keep');
  await f.vault().clear(); assert.equal(await f.vault().read(), null);
  assert.deepEqual([...f.files.keys()], ['unrelated.bin']);
});
