import test from 'node:test';
import assert from 'node:assert/strict';
const api = await import('../src/features/messages/private-photo-editor.ts').catch(() => ({}));
const codec = await import('../src/features/messages/private-photo-message.ts');
const stickerCodec = await import('../src/features/messages/private-sticker-message.ts');
const prepared = { descriptor: { version: 1, id: 'photo-1', key: 'f'.repeat(64), size: 12, mimeType: 'image/jpeg' }, ciphertext: 'YWJjZA==' };
function fixture() {
 let account = 'owner', audience = 'friend:req-1', saved = null, failSend = true; const calls = [];
 const ports = { account: () => account, operation: () => 'op-1', context: async ({ targetId }) => ({ conversation: 'private:' + 'a'.repeat(64), audience, recipients: [{ accountId: targetId, generation: 1, keys: { identity: 'peer' } }] }),
  media: { prepare: async () => prepared, restore: async value => value, upload: async (value, operation) => { calls.push(['upload', value.ciphertext, operation]); return value.descriptor; }, download: async () => new Uint8Array([1]), cancel: async operation => { calls.push(['cancel', operation]); return { state: 'cancelled' }; } },
  vault: { read: async () => saved, write: async value => { saved = value; }, clear: async () => { saved = null; } },
  send: async draft => { calls.push(['send', draft]); if (failSend) { failSend = false; throw Error('NETWORK'); } return { id: 'event-1', operation: draft.operation, status: 'sent' }; } };
 assert.equal(typeof api.createPrivatePhotoEditor, 'function', 'private Chat photo lifecycle is missing');
 const editor = api.createPrivatePhotoEditor(ports, 'bob'); return { editor, ports, calls, get saved() { return saved; }, set account(value) { account = value; }, set audience(value) { audience = value; } };
}
test('private Chat photo encrypts before upload and sends a friendship-bound encrypted message', async () => {
 const f = fixture(); await assert.rejects(f.editor.sendPhoto({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', caption: 'At the lake' }), /NETWORK/);
 assert.deepEqual(f.calls.map(call => call[0]), ['upload', 'send']);
 const draft = f.calls[1][1]; assert.equal(draft.targetId, 'bob'); assert.equal(draft.circleId, undefined);
 const body = codec.decodePrivatePhotoMessage(draft.plaintext); assert.equal(body.id, 'op-1'); assert.equal(body.audience, 'friend:req-1'); assert.equal(body.caption, 'At the lake'); assert.deepEqual(body.media, prepared.descriptor); assert.ok(f.saved);
});
test('private Chat sticker encrypts artwork before upload and persists exact retry state', async () => {
 const f = fixture();
 await assert.rejects(f.editor.sendSticker({ image: 'data:image/png;base64,AQID', label: 'Little wave' }), /NETWORK/);
 assert.deepEqual(f.calls.map(call => call[0]), ['upload', 'send']);
 const draft = f.calls[1][1], body = stickerCodec.decodePrivateStickerMessage(draft.plaintext);
 assert.equal(draft.targetId, 'bob'); assert.equal(draft.operation, 'op-1');
 assert.deepEqual(body, { version: 1, type: 'private-sticker-message', id: 'op-1', audience: 'friend:req-1', label: 'Little wave', media: prepared.descriptor });
 assert.equal(f.saved.stickerIntent.label, 'Little wave');
});
test('private Chat sticker retry reuses exact media and body and rejects a changed friendship audience', async () => {
 const f = fixture(); await assert.rejects(f.editor.sendSticker({ image: 'data:image/png;base64,AQID', label: 'Wave' }), /NETWORK/);
 const first = f.calls.find(call => call[0] === 'send')[1]; f.audience = 'friend:req-2';
 await assert.rejects(f.editor.retry(), /CONTEXT_MISMATCH/); assert.equal(f.calls.length, 2);
 f.audience = 'friend:req-1'; await f.editor.retry();
 assert.deepEqual(f.calls.filter(call => call[0] === 'upload').map(call => call.slice(1)), [['YWJjZA==', 'op-1'], ['YWJjZA==', 'op-1']]);
 assert.deepEqual(f.calls.filter(call => call[0] === 'send').map(call => call[1].plaintext), [first.plaintext, first.plaintext]);
 assert.equal(f.saved, null);
});
test('private Chat photo retries the exact upload and message body without rebasing friendship audience', async () => {
 const f = fixture(); await assert.rejects(f.editor.sendPhoto({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', caption: 'At the lake' }), /NETWORK/);
 const first = f.calls.find(call => call[0] === 'send')[1]; f.audience = 'friend:req-2';
 await assert.rejects(f.editor.retry(), /CONTEXT_MISMATCH/); assert.equal(f.calls.length, 2);
 f.audience = 'friend:req-1'; await f.editor.retry();
 assert.deepEqual(f.calls.filter(call => call[0] === 'upload').map(call => call.slice(1)), [['YWJjZA==', 'op-1'], ['YWJjZA==', 'op-1']]);
 assert.deepEqual(f.calls.filter(call => call[0] === 'send').map(call => call[1].plaintext), [first.plaintext, first.plaintext]); assert.equal(f.saved, null);
});
test('discard fences an uncertain private Chat photo operation with the server before clearing its saved ciphertext', async () => {
 const f = fixture(); await assert.rejects(f.editor.sendPhoto({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', caption: 'At the lake' }), /NETWORK/);
 assert.ok(f.saved); const result = await f.editor.discard(); assert.deepEqual(result, { state: 'cancelled' });
 assert.deepEqual(f.calls.at(-1), ['cancel', 'op-1']); assert.equal(f.saved, null);
});
