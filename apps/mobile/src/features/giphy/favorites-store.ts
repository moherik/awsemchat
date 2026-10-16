export type GifFavorite = Readonly<{ id: string; title: string }>;
type Storage = { get(): Promise<string | null>; set(value: string): Promise<void> };
const maxFavorites = 100;
function validFavorite(value: unknown): value is GifFavorite {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.id) && typeof item.title === 'string' && [...item.title].length <= 120;
}
export function createGifFavorites(storage: Storage) {
  let tail: Promise<unknown> = Promise.resolve();
  async function read(): Promise<GifFavorite[]> {
    let raw: string | null;
    try { raw = await storage.get(); } catch { return []; }
    if (!raw) return [];
    try { const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) return []; return value.filter(validFavorite).slice(0, maxFavorites).map(item => Object.freeze({ id: item.id, title: item.title })); } catch { return []; }
  }
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(work); tail = result.catch(() => {}); return result; }
  return Object.freeze({
    list: () => serial(read),
    toggle: (gif: { id: string; title: string }) => serial(async () => {
      if (!validFavorite(gif)) throw new Error('GIF_FAVORITE_INVALID');
      const current = await read();
      const next = current.some(item => item.id === gif.id) ? current.filter(item => item.id !== gif.id) : [{ id: gif.id, title: gif.title }, ...current].slice(0, maxFavorites);
      await storage.set(JSON.stringify(next));
      return Object.freeze(next);
    }),
  });
}
