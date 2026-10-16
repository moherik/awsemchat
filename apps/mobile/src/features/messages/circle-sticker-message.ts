import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { CollectionItem } from '../social/circle-collection';
import type { CircleAvatar } from '../social/circle-profile';

export type CircleStickerMessage = Readonly<{
  version: 1;
  type: 'circle-sticker';
  item: string;
  label: string;
  image: CircleAvatar;
}>;

function invalid(): never { throw new Error('INVALID_CIRCLE_STICKER'); }

function parse(value: unknown): CircleStickerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'image,item,label,type,version' || raw.version !== 1 || raw.type !== 'circle-sticker' ||
    typeof raw.item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(raw.item) ||
    typeof raw.label !== 'string' || !raw.label.trim() || [...raw.label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(raw.label)) return invalid();
  const image = raw.image as CircleAvatar;
  if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).sort().join(',') !== 'epoch,media' ||
    !Number.isSafeInteger(image.epoch) || image.epoch < 1) return invalid();
  let media;
  try { media = validateMediaDescriptor(image.media); } catch { return invalid(); }
  return Object.freeze({ version: 1, type: 'circle-sticker', item: raw.item, label: raw.label.trim(), image: Object.freeze({ epoch: image.epoch, media }) });
}

export function encodeCircleStickerMessage(item: CollectionItem): string {
  if (!item || item.kind !== 'sticker') return invalid();
  return JSON.stringify(parse({ version: 1, type: 'circle-sticker', item: item.id, label: item.label, image: item.image }));
}

export function encodePersonalCircleStickerMessage(value: { id: string; label: string; image: CircleAvatar }): string {
  return JSON.stringify(parse({ version: 1, type: 'circle-sticker', item: value.id, label: value.label, image: value.image }));
}

export function decodeCircleStickerMessage(value: string): CircleStickerMessage | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-sticker') return undefined;
    return parse(parsed);
  } catch { return undefined; }
}
