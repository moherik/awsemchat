import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { CircleAvatar } from '../social/circle-profile';

export type CirclePhotoMessage = Readonly<{ version: 1; type: 'circle-photo-message'; id: string; caption: string; image: CircleAvatar }>;
function invalid(): never { throw new Error('INVALID_CIRCLE_PHOTO_MESSAGE'); }
function parse(value: unknown): CirclePhotoMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'caption,id,image,type,version' || raw.version !== 1 || raw.type !== 'circle-photo-message' || typeof raw.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(raw.id) || typeof raw.caption !== 'string' || [...raw.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(raw.caption)) return invalid();
  const image = raw.image as CircleAvatar, epoch = /^circle:([1-9][0-9]*)$/.exec(`circle:${image?.epoch}`)?.[1];
  if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).sort().join(',') !== 'epoch,media' || !Number.isSafeInteger(image.epoch) || image.epoch < 1 || !epoch) return invalid();
  try { return Object.freeze({ version: 1, type: 'circle-photo-message', id: raw.id, caption: raw.caption.trim(), image: Object.freeze({ epoch: image.epoch, media: validateMediaDescriptor(image.media) }) }); } catch { return invalid(); }
}
export function encodeCirclePhotoMessage(value: { id: string; caption: string; image: CircleAvatar }) { return JSON.stringify(parse({ version: 1, type: 'circle-photo-message', ...value })); }
export function decodeCirclePhotoMessage(value: string): CirclePhotoMessage | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-photo-message') return undefined; return parse(parsed); } catch { return undefined; }
}
