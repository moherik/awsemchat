import { validateMediaDescriptor, type MediaDescriptor } from '../media/encrypted-media.ts';

export type PrivateStickerMessage = Readonly<{
  version: 1;
  type: 'private-sticker-message';
  id: string;
  audience: string;
  label: string;
  media: MediaDescriptor;
}>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const audiencePattern = /^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parse(value: unknown): PrivateStickerMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PRIVATE_STICKER_MESSAGE');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'audience,id,label,media,type,version' || raw.version !== 1 || raw.type !== 'private-sticker-message' ||
    typeof raw.id !== 'string' || !idPattern.test(raw.id) || typeof raw.audience !== 'string' || !audiencePattern.test(raw.audience) ||
    typeof raw.label !== 'string' || !raw.label.trim() || [...raw.label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(raw.label)) throw new Error('INVALID_PRIVATE_STICKER_MESSAGE');
  const media = validateMediaDescriptor(raw.media as MediaDescriptor);
  return Object.freeze({ version: 1, type: 'private-sticker-message', id: raw.id, audience: raw.audience, label: raw.label.trim(), media });
}

export function encodePrivateStickerMessage(value: { id: string; audience: string; label: string; media: MediaDescriptor }): string {
  return JSON.stringify(parse({ version: 1, type: 'private-sticker-message', ...value }));
}

export function decodePrivateStickerMessage(value: string): PrivateStickerMessage | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'private-sticker-message') return undefined;
    return parse(parsed);
  } catch { return undefined; }
}
