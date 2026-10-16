import { validateMediaDescriptor, type MediaDescriptor } from '../media/encrypted-media.ts';

export type PrivatePhotoMessage = Readonly<{ version: 1; type: 'private-photo-message'; id: string; audience: string; caption: string; media: MediaDescriptor }>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const audiencePattern = /^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
function parse(value: unknown): PrivatePhotoMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PRIVATE_PHOTO_MESSAGE');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'audience,caption,id,media,type,version' || raw.version !== 1 || raw.type !== 'private-photo-message' || typeof raw.id !== 'string' || !idPattern.test(raw.id) || typeof raw.audience !== 'string' || !audiencePattern.test(raw.audience) || typeof raw.caption !== 'string' || [...raw.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(raw.caption)) throw new Error('INVALID_PRIVATE_PHOTO_MESSAGE');
  const media = validateMediaDescriptor(raw.media as MediaDescriptor);
  return Object.freeze({ version: 1, type: 'private-photo-message', id: raw.id, audience: raw.audience, caption: raw.caption.trim(), media });
}
export function encodePrivatePhotoMessage(value: { id: string; audience: string; caption: string; media: MediaDescriptor }) {
  return JSON.stringify(parse({ version: 1, type: 'private-photo-message', ...value }));
}
export function decodePrivatePhotoMessage(value: string): PrivatePhotoMessage | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'private-photo-message') return undefined; return parse(parsed); } catch { return undefined; }
}
