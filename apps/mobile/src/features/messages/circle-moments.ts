import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { HistorySnapshot } from './history-store';
import type { PeerKeys } from '../../security/durable-encryption';
import type { CircleAvatar } from '../social/circle-profile';
import { decodeCircleMomentDeletion } from './circle-moment-deletion.ts';

export type CircleMoment = Readonly<{ version: 1; type: 'circle-moment'; id: string; caption: string; media?: CircleAvatar }>;
export type CircleMomentEntry = Readonly<{
  id: string; messageId: string; operation: string; own: boolean; audience: string; sender?: PeerKeys; caption: string; media?: CircleAvatar;
  sequence?: number; createdAt?: number; status?: 'queued' | 'sent' | 'delivered';
}>;
function invalid(): never { throw new Error('INVALID_CIRCLE_MOMENT'); }

function parse(value: unknown): CircleMoment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== (raw.media === undefined ? 'caption,id,type,version' : 'caption,id,media,type,version') ||
    raw.version !== 1 || raw.type !== 'circle-moment' || typeof raw.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(raw.id) ||
    typeof raw.caption !== 'string' || [...raw.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(raw.caption) ||
    (!raw.caption.trim() && raw.media === undefined)) return invalid();
  let media: CircleAvatar | undefined;
  if (raw.media !== undefined) {
    const value = raw.media as CircleAvatar;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'epoch,media' || !Number.isSafeInteger(value.epoch) || value.epoch < 1) return invalid();
    try { media = Object.freeze({ epoch: value.epoch, media: validateMediaDescriptor(value.media) }); } catch { return invalid(); }
  }
  return Object.freeze({ version: 1, type: 'circle-moment', id: raw.id, caption: raw.caption.trim(), ...(media ? { media } : {}) });
}

export function encodeCircleMoment(value: { id: string; caption: string; media?: CircleAvatar }): string {
  return JSON.stringify(parse({ version: 1, type: 'circle-moment', ...value }));
}

export function decodeCircleMoment(value: string): CircleMoment | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-moment') return undefined;
    return parse(parsed);
  } catch { return undefined; }
}

export function selectCircleMoments(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, circle: string): readonly CircleMomentEntry[] {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circle) || circle === '.' || circle === '..') throw new Error('INVALID_CIRCLE');
  const entries = new Map<string, CircleMomentEntry>(), ids = new Set<string>();
  for (const record of history.incoming) {
    if (record.conversation !== circle || !/^circle:[1-9][0-9]*$/.test(record.audience)) continue;
    const moment = decodeCircleMoment(record.plaintext);
    if (!moment) continue;
    const own = record.direction === 'outgoing', identity = own ? 'self' : record.sender.identity;
    const operationKey = `${identity}:${record.operation}`;
    const entry: CircleMomentEntry = Object.freeze({ id: moment.id, messageId: `${identity}:${record.operation}`, operation: record.operation, own, audience: record.audience, sender: record.sender, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}), ...(record.sequence === undefined ? {} : { sequence: record.sequence }), ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt * 1000 }) });
    const previous = entries.get(operationKey);
    if (previous) {
      if (previous.id !== entry.id || previous.caption !== entry.caption || previous.audience !== entry.audience || JSON.stringify(previous.media) !== JSON.stringify(entry.media)) throw new Error('CIRCLE_MOMENT_CONFLICT');
      continue;
    }
    if (ids.has(moment.id)) throw new Error('CIRCLE_MOMENT_CONFLICT');
    ids.add(moment.id); entries.set(operationKey, entry);
  }
  for (const record of history.outgoing) {
    if (record.conversation !== circle || record.circle !== circle || record.target !== null || !/^circle:[1-9][0-9]*$/.test(record.audience)) continue;
    const moment = decodeCircleMoment(record.plaintext);
    if (!moment) continue;
    const operationKey = `self:${record.operation}`;
    const previous = entries.get(operationKey);
    if (previous) {
      if (previous.id !== moment.id || previous.caption !== moment.caption || previous.audience !== record.audience || JSON.stringify(previous.media) !== JSON.stringify(moment.media)) throw new Error('CIRCLE_MOMENT_CONFLICT');
      entries.set(operationKey, Object.freeze({ ...previous, status: record.status,
        ...(previous.sequence === undefined && record.sequence == null ? {} : { sequence: previous.sequence ?? record.sequence ?? undefined }),
        ...(previous.createdAt === undefined && record.createdAt == null ? {} : { createdAt: previous.createdAt ?? (record.createdAt == null ? undefined : record.createdAt * 1000) }) }));
      continue;
    }
    if (ids.has(moment.id)) throw new Error('CIRCLE_MOMENT_CONFLICT');
    ids.add(moment.id);
    entries.set(operationKey, Object.freeze({ id: moment.id, messageId: `self:${record.operation}`, operation: record.operation, own: true, audience: record.audience, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}), ...(record.sequence == null ? {} : { sequence: record.sequence }), ...(record.createdAt == null ? {} : { createdAt: record.createdAt * 1000 }), status: record.status }));
  }
  const authors = new Map([...entries.values()].map(entry => [`${entry.audience}:${entry.id}`, entry.own ? 'self' : entry.sender?.identity]));
  const deleted = new Set<string>();
  const deletionRecords = [
    ...history.incoming.map(record => ({ record, identity: record.direction === 'outgoing' ? 'self' : record.sender?.identity })),
    ...history.outgoing.map(record => ({ record, identity: 'self' })),
  ];
  for (const { record, identity } of deletionRecords) {
    if (!identity || record.conversation !== circle || !/^circle:[1-9][0-9]*$/.test(record.audience)) continue;
    if ('circle' in record && (record.circle !== circle || record.target !== null)) continue;
    const deletion = decodeCircleMomentDeletion(record.plaintext);
    if (!deletion || deletion.id !== record.operation || authors.get(`${record.audience}:${deletion.momentId}`) !== identity) continue;
    deleted.add(`${record.audience}:${identity}:${deletion.momentId}`);
  }
  return Object.freeze([...entries.values()].filter(entry => !deleted.has(`${entry.audience}:${entry.own ? 'self' : entry.sender?.identity}:${entry.id}`)).sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) || (a.createdAt ?? 0) - (b.createdAt ?? 0)));
}
