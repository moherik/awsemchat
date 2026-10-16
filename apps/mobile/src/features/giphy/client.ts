export type Gif = Readonly<{ id: string; title: string; previewURL: string; downloadURL: string }>;
type ProviderGif = { id?: unknown; title?: unknown; images?: { fixed_width_small?: { webp?: unknown; url?: unknown }; downsized?: { url?: unknown } } };
type FetchResponse = { ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> };
type Fetch = (input: string, init?: { signal?: AbortSignal }) => Promise<FetchResponse>;
const pageSize = 24, maxBytes = 2 * 1024 * 1024;
function invalid(code: string): never { throw new Error(code); }
function mediaURL(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'giphy.com' || /^media\d+\.giphy\.com$/.test(url.hostname)); } catch { return false; }
}
function parseGif(value: unknown): Gif {
  const item = value as ProviderGif | null;
  if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || !item.images) return invalid('GIF_SERVICE_INVALID_RESPONSE');
  const previewURL = mediaURL(item.images.fixed_width_small?.webp) ? item.images.fixed_width_small.webp : item.images.fixed_width_small?.url;
  const downloadURL = item.images.downsized?.url;
  if (!mediaURL(previewURL) || !mediaURL(downloadURL)) return invalid('GIF_SERVICE_INVALID_RESPONSE');
  const title = typeof item.title === 'string' ? [...item.title.trim()].slice(0, 120).join('') : '';
  return Object.freeze({ id: item.id, title: title || 'GIF', previewURL, downloadURL });
}
function parseList(value: unknown) {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { data?: unknown }).data)) return invalid('GIF_SERVICE_INVALID_RESPONSE');
  const items = (value as { data: unknown[] }).data.map(parseGif);
  return Object.freeze({ items: Object.freeze(items), hasMore: items.length === pageSize });
}
export function createGiphyClient(options: { apiKey: string; fetch?: Fetch }) {
  const key = options.apiKey.trim();
  const request = options.fetch ?? globalThis.fetch as unknown as Fetch;
  if (!key) invalid('GIF_API_KEY_MISSING');
  async function json(path: string, params: Record<string, string>, signal?: AbortSignal) {
    const query = new URLSearchParams({ api_key: key, rating: 'g', ...params });
    const endpoint = path ? `https://api.giphy.com/v1/gifs/${path}` : 'https://api.giphy.com/v1/gifs';
    const response = await request(`${endpoint}?${query}`, { signal });
    if (!response.ok) invalid('GIF_SERVICE_UNAVAILABLE');
    return response.json();
  }
  return Object.freeze({
    async list(input: { query: string; offset: number; signal?: AbortSignal }) {
      if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 4999) invalid('GIF_INVALID_OFFSET');
      const query = input.query.trim();
      if ([...query].length > 50) invalid('GIF_QUERY_TOO_LONG');
      const path = query ? 'search' : 'trending';
      return parseList(await json(path, { limit: String(pageSize), offset: String(input.offset), ...(query ? { q: query } : {}) }, input.signal));
    },
    async favorites(ids: readonly string[], signal?: AbortSignal) {
      const safeIDs = [...new Set(ids)].filter(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)).slice(0, 100);
      if (!safeIDs.length) return Object.freeze({ items: Object.freeze([]), hasMore: false });
      return parseList(await json('', { ids: safeIDs.join(',') }, signal));
    },
    async download(gif: Gif, signal?: AbortSignal) {
      if (!mediaURL(gif.downloadURL)) invalid('GIF_INVALID_URL');
      const response = await request(gif.downloadURL, { signal });
      if (!response.ok) invalid('GIF_SERVICE_UNAVAILABLE');
      if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/gif') invalid('GIF_INVALID_MEDIA');
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > maxBytes) invalid('GIF_TOO_LARGE');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.length || bytes.length > maxBytes) invalid('GIF_TOO_LARGE');
      return bytes;
    },
  });
}
