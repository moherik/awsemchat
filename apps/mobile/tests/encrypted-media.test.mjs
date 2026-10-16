import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const module = await import('../src/features/media/encrypted-media.ts').catch(() => ({}));
function fixture() {
  let binding = 'account-one', next = 0;
  const stored = new Map();
  const ports = {
    binding: () => binding, objectId: () => `media-${++next}`,
    codec: {
      async encode(context, records) { const key = randomBytes(32), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(context)); const bytes = Buffer.concat([nonce, cipher.update(JSON.stringify(records)), cipher.final(), cipher.getAuthTag()]); return { archive: bytes.toString('base64'), recoveryKey: key.toString('hex') }; },
      async decode(context, archive, key) { const bytes = Buffer.from(archive, 'base64'), cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), bytes.subarray(0, 12)); cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(bytes.subarray(-16)); return { records: JSON.parse(Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString()) }; },
    },
    storage: { put: async (id, ciphertext, operation) => { if (!operation) throw Error('OPERATION_REQUIRED'); if (stored.has(id) && stored.get(id) !== ciphertext) throw Error('OBJECT_CONFLICT'); stored.set(id, ciphertext); }, get: async id => { if (!stored.has(id)) throw Error('NOT_FOUND'); return stored.get(id); }, cancel: async operation => ({ state: 'cancelled', operation }) },
  };
  assert.equal(typeof module.createEncryptedMedia, 'function', 'encrypted media service is missing');
  return { ports, stored, media: module.createEncryptedMedia(ports), replace: () => { binding = 'account-two'; } };
}
const input = () => ({ bytes: new TextEncoder().encode('private photo bytes'), mimeType: 'image/jpeg' });
test('persisted media authenticates before being restored for exact upload',async()=>{
 const f=fixture(),prepared=await f.media.prepare(input()),restarted=module.createEncryptedMedia(f.ports);
 assert.equal(typeof restarted.restore,'function','persisted upload recovery is missing');
 const restored=await restarted.restore(structuredClone(prepared));
 await restarted.upload(restored,'avatar-operation');assert.equal(f.stored.get(prepared.descriptor.id),prepared.ciphertext);
 await assert.rejects(restarted.restore({...prepared,descriptor:{...prepared.descriptor,key:'0'.repeat(64)}}));
});
test('media storage receives only authenticated ciphertext and never its recovery key', async () => {
  const f = fixture(), prepared = await f.media.prepare(input()); await f.media.upload(prepared,'photo-operation');
  const wire = [...f.stored.values()][0]; assert.equal(Buffer.from(wire, 'base64').includes(Buffer.from('private photo bytes')), false); assert.equal(wire.includes(prepared.descriptor.key), false);
  assert.deepEqual(await f.media.download(prepared.descriptor), input().bytes);
});
test('multi-chunk media reconstructs every byte and exact retry keeps one object', async () => {
  const f = fixture(), bytes = Uint8Array.from({ length: 70_000 }, (_, i) => i % 251);
  const prepared = await f.media.prepare({ bytes, mimeType: 'image/png' }); await f.media.upload(prepared,'photo-operation'); await f.media.upload(prepared,'photo-operation');
  assert.equal(f.stored.size, 1); assert.deepEqual(await f.media.download(prepared.descriptor), bytes);
});
test('corruption wrong keys and object substitution cannot expose media bytes', async () => {
  const f = fixture(), prepared = await f.media.prepare(input()); await f.media.upload(prepared,'photo-operation');
  await assert.rejects(f.media.download({ ...prepared.descriptor, key: '0'.repeat(64) }));
  f.stored.set('other-object', prepared.ciphertext); await assert.rejects(f.media.download({ ...prepared.descriptor, id: 'other-object' }));
  const damaged = Buffer.from(prepared.ciphertext, 'base64'); damaged[15] ^= 1; f.stored.set(prepared.descriptor.id, damaged.toString('base64')); await assert.rejects(f.media.download(prepared.descriptor));
});
test('account replacement during encryption prevents upload and replacement during download suppresses plaintext', async () => {
  const f = fixture(), encode = f.ports.codec.encode;
  f.ports.codec.encode = async (...args) => { const result = await encode(...args); f.replace(); return result; };
  await assert.rejects(f.media.prepare(input()), { message: 'SESSION_CHANGED' }); assert.equal(f.stored.size, 0);
  const other = fixture(), prepared = await other.media.prepare(input()); await other.media.upload(prepared,'photo-operation'); const get = other.ports.storage.get;
  other.ports.storage.get = async id => { const result = await get(id); other.replace(); return result; };
  await assert.rejects(other.media.download(prepared.descriptor), { message: 'SESSION_CHANGED' });
});
test('oversized empty and unsupported input is rejected before encryption or storage', async () => {
  const f = fixture();
  for (const value of [{ bytes: new Uint8Array(), mimeType: 'image/png' }, { bytes: new Uint8Array(2 * 1024 * 1024 + 1), mimeType: 'image/jpeg' }, { ...input(), mimeType: 'text/html' }]) await assert.rejects(f.media.prepare(value), { message: 'INVALID_MEDIA' });
  assert.equal(f.stored.size, 0);
});
test('mutating caller bytes while encryption awaits cannot alter the prepared media', async () => {
  const f = fixture(), source = input(), original = source.bytes.slice(), encode = f.ports.codec.encode;
  f.ports.codec.encode = async (...args) => { source.bytes.fill(0); return encode(...args); };
  const prepared = await f.media.prepare(source); await f.media.upload(prepared,'photo-operation'); assert.deepEqual(await f.media.download(prepared.descriptor), original);
});
test('lost upload response retries the original ciphertext and object identifier', async () => {
  const f=fixture(),prepared=await f.media.prepare(input()),put=f.ports.storage.put;let lose=true;
  f.ports.storage.put=async(...args)=>{await put(...args);if(lose){lose=false;throw Error('NETWORK');}};
  await assert.rejects(f.media.upload(prepared,'photo-operation'));await f.media.upload(prepared,'photo-operation');assert.equal(f.stored.size,1);assert.equal(f.stored.get(prepared.descriptor.id),prepared.ciphertext);
});
test('authenticated but malformed manifests reordered chunks and truncation fail before returning bytes', async () => {
  for(const mutate of [records=>records.pop(),records=>{[records[1],records[2]]=[records[2],records[1]];},records=>{const manifest=JSON.parse(records[0].payload);manifest.mimeType='image/gif';records[0].payload=JSON.stringify(manifest);}]){
    const f=fixture(),prepared=await f.media.prepare({bytes:new Uint8Array(40_000),mimeType:'image/png'});await f.media.upload(prepared,'photo-operation');const decode=f.ports.codec.decode;
    f.ports.codec.decode=async(...args)=>{const value=await decode(...args);mutate(value.records);return value;};await assert.rejects(f.media.download(prepared.descriptor),{message:'INVALID_MEDIA'});
  }
});
test('cancel delegates the exact operation to durable storage',async()=>{
 const f=fixture();assert.deepEqual(await f.media.cancel('cancel-me'),{state:'cancelled'});
 await assert.rejects(f.media.cancel('../bad'),{message:'INVALID_MEDIA'});
});
