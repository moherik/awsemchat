import type { StickerArtwork } from './model';
export type PersonalSticker = Readonly<{ id: string; artwork: StickerArtwork }>;
export type PersonalStickerStorage = { list(): Promise<unknown[]>; get(id: string): Promise<unknown>; put(value: PersonalSticker): Promise<void>; mergeAll(values: readonly PersonalSticker[]): Promise<void>; remove(id: string): Promise<void> };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function invalid(): never { throw new Error('INVALID_STICKER'); }
function artwork(value: unknown): StickerArtwork {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  const fields = ['background','image','pack','text','textColor','textSize','textY','title'];
  if (raw.textBoxes !== undefined) fields.push('textBoxes');
  if (Object.keys(raw).sort().join(',') !== fields.sort().join(',') || typeof raw.image !== 'string' || raw.image.length > 2_800_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.image) || typeof raw.title !== 'string' || !raw.title.trim() || [...raw.title].length > 80 || typeof raw.text !== 'string' || raw.text.length > 80 || typeof raw.textColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.textColor) || !Number.isFinite(raw.textSize) || (raw.textSize as number) < 12 || (raw.textSize as number) > 64 || !Number.isFinite(raw.textY) || (raw.textY as number) < 0 || (raw.textY as number) > 100 || (raw.background !== null && (typeof raw.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.background))) || typeof raw.pack !== 'string' || !raw.pack.trim() || [...raw.pack].length > 40) return invalid();
  let textBoxes: StickerArtwork['textBoxes'];
  if (raw.textBoxes !== undefined) {
    if (!Array.isArray(raw.textBoxes) || raw.textBoxes.length > 8) return invalid();
    textBoxes = raw.textBoxes.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
      const box = value as Record<string, unknown>;
      if (Object.keys(box).sort().join(',') !== 'color,id,size,text,x,y' || typeof box.id !== 'string' || !idPattern.test(box.id) || typeof box.text !== 'string' || box.text.length > 60 || !Number.isFinite(box.x) || (box.x as number) < 0 || (box.x as number) > 1 || !Number.isFinite(box.y) || (box.y as number) < 0 || (box.y as number) > 1 || typeof box.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(box.color) || !Number.isFinite(box.size) || (box.size as number) < 12 || (box.size as number) > 64) return invalid();
      return Object.freeze({ id: box.id, text: box.text, x: box.x as number, y: box.y as number, color: box.color, size: box.size as number });
    });
    if (new Set(textBoxes.map(box => box.id)).size !== textBoxes.length) return invalid();
  }
  return Object.freeze({ image: raw.image, title: raw.title.trim(), text: raw.text, textColor: raw.textColor, textSize: raw.textSize as number, textY: raw.textY as number, background: raw.background as string | null, pack: raw.pack.trim(), ...(textBoxes === undefined ? {} : { textBoxes: Object.freeze(textBoxes) as unknown as StickerArtwork['textBoxes'] }) });
}
function entry(value: unknown): PersonalSticker {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'artwork,id' || typeof raw.id !== 'string' || !idPattern.test(raw.id)) return invalid();
  return Object.freeze({ id: raw.id, artwork: artwork(raw.artwork) });
}
export function parsePersonalSticker(value: unknown): PersonalSticker { return entry(value); }
export function createPersonalStickerStore(storage: PersonalStickerStorage, nextID: () => string) {
  return {
    async list(): Promise<readonly PersonalSticker[]> {
      const values = await storage.list(); if (!Array.isArray(values) || values.length > 10_000) return invalid();
      const parsed = values.map(entry); if (new Set(parsed.map(value => value.id)).size !== parsed.length) return invalid();
      return Object.freeze(parsed);
    },
    async save(value: StickerArtwork): Promise<PersonalSticker> {
      const saved = entry({ id: nextID(), artwork: value });
      if (await storage.get(saved.id) !== undefined) return invalid();
      await storage.put(saved); return saved;
    },
    async copy(value: Pick<PersonalSticker, 'artwork'> & { id?: string }): Promise<PersonalSticker> {
      return this.save({ ...value.artwork, pack: 'Saved stickers', textBoxes: value.artwork.textBoxes?.map(box => ({ ...box })) });
    },
    async restore(values: unknown) {
      if (!Array.isArray(values) || values.length > 10_000) return invalid();
      const parsed = values.map(entry);
      if (new Set(parsed.map(value => value.id)).size !== parsed.length) return invalid();
      await storage.mergeAll(parsed);
    },
    async remove(id: string) { if (!idPattern.test(id)) return invalid(); await storage.remove(id); },
  };
}
