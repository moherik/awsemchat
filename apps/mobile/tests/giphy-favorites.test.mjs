import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/features/giphy/favorites-store.ts').catch(() => ({}));

test('favorite GIF storage persists only IDs and titles and toggles idempotently', async () => {
  assert.equal(typeof mod.createGifFavorites, 'function', 'GIPHY favorites store is missing');
  let saved = '';
  const store = mod.createGifFavorites({ get: async () => saved, set: async value => { saved = value; } });
  const gif = { id: 'gif-1', title: 'Happy', previewURL: 'https://media1.giphy.com/preview.webp', downloadURL: 'https://media1.giphy.com/full.gif' };
  await store.toggle(gif);
  assert.deepEqual(await store.list(), [{ id: 'gif-1', title: 'Happy' }]);
  assert.equal(saved.includes('previewURL'), false);
  assert.equal(saved.includes('downloadURL'), false);
  await store.toggle(gif);
  assert.deepEqual(await store.list(), []);
});

test('favorite storage ignores malformed data and enforces a bounded, safe ID list', async () => {
  const f = value => mod.createGifFavorites({ get: async () => value, set: async () => {} });
  assert.deepEqual(await f('{broken').list(), []);
  assert.deepEqual(await f(JSON.stringify([{ id: '../bad', title: 'bad' }, { id: 'ok-1', title: 'Good' }])).list(), [{ id: 'ok-1', title: 'Good' }]);
  const values = Array.from({ length: 110 }, (_, i) => ({ id: `gif-${i}`, title: `GIF ${i}` }));
  const saved = { value: '' };
  const store = mod.createGifFavorites({ get: async () => saved.value, set: async value => { saved.value = value; } });
  for (const gif of values) await store.toggle({ ...gif, previewURL: 'https://media1.giphy.com/x.webp', downloadURL: 'https://media1.giphy.com/x.gif' });
  assert.equal((await store.list()).length, 100);
});
