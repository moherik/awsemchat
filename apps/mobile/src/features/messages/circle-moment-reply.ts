import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { CircleAvatar } from '../social/circle-profile';

export type CircleMomentReply = Readonly<{ version: 1; type: 'circle-moment-reply'; id: string; text: string; moment: Readonly<{ id: string; audience: string; caption: string; media?: CircleAvatar }> }>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function invalid(): never { throw new Error('INVALID_CIRCLE_MOMENT_REPLY'); }
function utf8Length(value: string) {
  let size = 0;
  for (const character of value) { const point = character.codePointAt(0)!; size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; }
  return size;
}
function parseMoment(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>, audience = typeof raw.audience === 'string' ? /^circle:([1-9][0-9]*)$/.exec(raw.audience) : null;
  if (Object.keys(raw).sort().join(',') !== (raw.media === undefined ? 'audience,caption,id' : 'audience,caption,id,media') || typeof raw.id !== 'string' || !idPattern.test(raw.id) || !audience || !Number.isSafeInteger(Number(audience[1])) || typeof raw.caption !== 'string' || [...raw.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(raw.caption)) return invalid();
  let media: CircleAvatar | undefined;
  if (raw.media !== undefined) {
    const item = raw.media as CircleAvatar;
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'epoch,media' || item.epoch !== Number(audience![1])) return invalid();
    try { media = Object.freeze({ epoch: item.epoch, media: validateMediaDescriptor(item.media) }); } catch { return invalid(); }
  }
  return Object.freeze({ id: raw.id, audience: raw.audience as string, caption: raw.caption, ...(media ? { media } : {}) });
}
function parse(value: unknown): CircleMomentReply {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'id,moment,text,type,version' || raw.version !== 1 || raw.type !== 'circle-moment-reply' || typeof raw.id !== 'string' || !idPattern.test(raw.id) || typeof raw.text !== 'string' || !raw.text.trim() || [...raw.text].length > 8000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(raw.text)) return invalid();
  const moment = parseMoment(raw.moment);
  return Object.freeze({ version: 1, type: 'circle-moment-reply', id: raw.id, text: raw.text, moment });
}
export function encodeCircleMomentReply(value: { id: string; text: string; moment: { id: string; audience: string; caption: string; media?: CircleAvatar } }): string {
  const body = JSON.stringify(parse({ version: 1, type: 'circle-moment-reply', ...value }));
  if (utf8Length(body) > 32 * 1024) return invalid();
  return body;
}
export function decodeCircleMomentReply(value: string): CircleMomentReply | undefined {
  if (typeof value !== 'string' || utf8Length(value) > 32 * 1024) return undefined;
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-moment-reply') return undefined; return parse(parsed); } catch { return undefined; }
}
