import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../src/features/giphy/client.ts').catch(() => ({}));

function fixture(overrides = {}) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return overrides.fetch ? overrides.fetch(url, options) : response({ data: [gif()] });
  };
  assert.equal(typeof mod.createGiphyClient, 'function', 'GIPHY client is missing');
  return { requests, client: mod.createGiphyClient({ apiKey: 'test-key', fetch: fetchImpl }) };
}
function response(body, options = {}) { return { ok: options.ok ?? true, status: options.status ?? 200, headers: { get: name => options.contentType ?? (name.toLowerCase() === 'content-type' ? 'application/json' : null) }, json: async () => body, arrayBuffer: async () => options.bytes ?? new TextEncoder().encode('gif bytes').buffer }; }
function gif(id = 'gif-1') { return { id, title: 'Happy day', images: { fixed_width_small: { webp: 'https://media1.giphy.com/preview.webp', url: 'https://media1.giphy.com/preview.gif' }, downsized: { url: 'https://media1.giphy.com/full.gif' } } }; }

test('search sends the exact query with safe rating and a bounded page size', async () => {
  const f = fixture();
  const result = await f.client.list({ query: '  happy & kind  ', offset: 24 });
  const request = new URL(f.requests[0].url);
  assert.equal(request.pathname, '/v1/gifs/search');
  assert.equal(request.searchParams.get('q'), 'happy & kind');
  assert.equal(request.searchParams.get('rating'), 'g');
  assert.equal(request.searchParams.get('limit'), '24');
  assert.equal(request.searchParams.get('offset'), '24');
  assert.deepEqual(result.items, [{ id: 'gif-1', title: 'Happy day', previewURL: 'https://media1.giphy.com/preview.webp', downloadURL: 'https://media1.giphy.com/full.gif' }]);
});

test('trending uses the trending endpoint and validates malformed provider results', async () => {
  const f = fixture();
  await f.client.list({ query: '', offset: 0 });
  assert.equal(new URL(f.requests[0].url).pathname, '/v1/gifs/trending');
  const malformed = fixture({ fetch: async () => response({ data: [gif(), { id: 'bad', images: {} }] }) });
  await assert.rejects(malformed.client.list({ query: '', offset: 0 }), /GIF_SERVICE_INVALID_RESPONSE/);
});

test('favorite lookup sends only persisted ids and restores live media URLs', async () => {
  const f = fixture();
  const result = await f.client.favorites(['gif-1', 'gif-2']);
  const request = new URL(f.requests[0].url);
  assert.equal(request.pathname, '/v1/gifs');
  assert.equal(request.searchParams.get('ids'), 'gif-1,gif-2');
  assert.equal(result.items.length, 1);
});

test('GIF download accepts only GIPHY HTTPS GIFs within the encrypted media limit', async () => {
  const f = fixture({ fetch: async () => response({}, { contentType: 'image/gif' }) });
  const bytes = await f.client.download({ id: 'gif-1', title: 'Happy day', previewURL: '', downloadURL: 'https://media1.giphy.com/full.gif' });
  assert.equal(new TextDecoder().decode(bytes), 'gif bytes');
  const tooLarge = fixture({ fetch: async () => response({}, { contentType: 'image/gif', bytes: new Uint8Array(2 * 1024 * 1024 + 1).buffer }) });
  await assert.rejects(tooLarge.client.download({ id: 'x', title: 'x', previewURL: '', downloadURL: 'https://media1.giphy.com/x.gif' }), /GIF_TOO_LARGE/);
  const wrongType = fixture({ fetch: async () => response({}, { contentType: 'image/webp' }) });
  await assert.rejects(wrongType.client.download({ id: 'x', title: 'x', previewURL: '', downloadURL: 'https://media1.giphy.com/x.gif' }), /GIF_INVALID_MEDIA/);
  await assert.rejects(f.client.download({ id: 'x', title: 'x', previewURL: '', downloadURL: 'http://media1.giphy.com/x.gif' }), /GIF_INVALID_URL/);
  await assert.rejects(f.client.download({ id: 'x', title: 'x', previewURL: '', downloadURL: 'https://evil.example/x.gif' }), /GIF_INVALID_URL/);
});

test('request cancellation propagates and HTTP errors are surfaced', async () => {
  const controller = new AbortController();
  const f = fixture({ fetch: async (_url, options) => { assert.equal(options.signal, controller.signal); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); } });
  await assert.rejects(f.client.list({ query: 'hello', offset: 0, signal: controller.signal }), { name: 'AbortError' });
  const failed = fixture({ fetch: async () => response({}, { ok: false, status: 429 }) });
  await assert.rejects(failed.client.list({ query: 'hello', offset: 0 }), /GIF_SERVICE_UNAVAILABLE/);
});
