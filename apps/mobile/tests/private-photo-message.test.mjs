import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/features/messages/private-photo-message.ts').catch(() => ({}));
const media = { version: 1, id: 'photo-1', key: 'f'.repeat(64), size: 12, mimeType: 'image/jpeg' };
test('private Chat photo codec binds message operation, friendship audience and safe media descriptor', () => {
 assert.equal(typeof api.encodePrivatePhotoMessage, 'function', 'private Chat photo codec is missing');
 const encoded = api.encodePrivatePhotoMessage({ id: 'op-1', audience: 'friend:req-1', caption: 'At the lake', media });
 assert.deepEqual(api.decodePrivatePhotoMessage(encoded), { version: 1, type: 'private-photo-message', id: 'op-1', audience: 'friend:req-1', caption: 'At the lake', media });
 assert.equal(api.decodePrivatePhotoMessage(JSON.stringify({ version: 1, type: 'private-photo-message', id: 'op-1', audience: 'friend:req-2', caption: '', media, extra: true })), undefined);
 assert.throws(() => api.encodePrivatePhotoMessage({ id: 'op-1', audience: 'friend:req-1', caption: '', media: { ...media, size: 0 } }));
});
