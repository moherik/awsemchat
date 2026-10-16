import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/features/giphy/send.ts').catch(() => ({}));

test('selected GIPHY GIF is downloaded and sent through encrypted chat media', async () => {
  assert.equal(typeof mod.sendEncryptedGif, 'function', 'encrypted GIF send helper is missing');
  const bytes = new Uint8Array([71, 73, 70]);
  const calls = [];
  const result = await mod.sendEncryptedGif({ client: { download: async (...args) => { calls.push(['download', ...args]); return bytes; } }, gif: { id: 'g1', title: 'Wave', previewURL: 'https://media1.giphy.com/preview.webp', downloadURL: 'https://media1.giphy.com/wave.gif' }, editor: { sendPhoto: async (...args) => { calls.push(['send', ...args]); return 'sent'; } }, caption: '  Hello  ' });
  assert.equal(result, 'sent');
  assert.deepEqual(calls[1][1], { bytes, mimeType: 'image/gif', caption: 'Hello' });
});

test('GIF download errors do not invoke encrypted media send', async () => {
  const calls = [];
  await assert.rejects(mod.sendEncryptedGif({ client: { download: async () => { throw new Error('GIF_TOO_LARGE'); } }, gif: { id: 'g1', title: 'Wave', previewURL: '', downloadURL: '' }, editor: { sendPhoto: async value => calls.push(value) }, caption: '' }), /GIF_TOO_LARGE/);
  assert.deepEqual(calls, []);
});
