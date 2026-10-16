import { parseCollectionChange } from '../../security/collection-change.ts';
import type { CollectionChange } from '../../security/durable-encryption';
import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { HistorySnapshot } from '../messages/history-store';
import type { CircleAvatar } from './circle-profile';

export type CollectionPayload = Readonly<{ version: 1; change: CollectionChange; label: string; image: CircleAvatar }> | Readonly<{ version: 1; change: CollectionChange }>;
export type CollectionItem = Readonly<{ id: string; kind: 'sticker' | 'emoji'; label: string; image: CircleAvatar }>;
export type CollectionSelection = Readonly<{ state: 'ready'; revision: number; items: readonly CollectionItem[] }> | Readonly<{ state: 'incomplete' | 'stale' | 'invalid' | 'conflict'; revision: number }>;
function invalid(): never { throw new Error('INVALID_COLLECTION'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function payload(input: unknown): CollectionPayload {
  const value = object(input), change = parseCollectionChange(value.change);
  if (value.version !== 1 || !change) invalid();
  if (change.action === 'remove') {
    if (Object.keys(value).sort().join(',') !== 'change,version') invalid();
    return Object.freeze({ version: 1, change });
  }
  if (Object.keys(value).sort().join(',') !== 'change,image,label,version' || typeof value.label !== 'string') invalid();
  const label = value.label.trim();
  if (!label || [...label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(label) || (change.kind === 'emoji' && !/^[a-z0-9_]{1,32}$/.test(label))) invalid();
  const image = object(value.image), media = object(image.media);
  if (Object.keys(image).sort().join(',') !== 'epoch,media' || !Number.isSafeInteger(image.epoch) || (image.epoch as number) < 1 || Object.keys(media).sort().join(',') !== 'id,key,mimeType,size,version') invalid();
  let descriptor;
  try { descriptor = validateMediaDescriptor(media as unknown as CircleAvatar['media']); } catch { return invalid(); }
  return Object.freeze({ version: 1, change, label, image: Object.freeze({ epoch: image.epoch as number, media: descriptor }) });
}
export function encodeCollectionPayload(value: unknown): string { return JSON.stringify(payload(value)); }
export function decodeCollectionPayload(value: string): CollectionPayload | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { return payload(JSON.parse(value)); } catch { return undefined; }
}

export function selectCircleCollection(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, circleId: string, revision: number): CollectionSelection {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('INVALID_INPUT');
  const records = [
    ...history.incoming.filter(record => record.conversation === circleId && record.contentType === 'circle-collection' && record.collectionAccepted === true),
    ...history.outgoing.filter(record => record.conversation === circleId && record.contentType === 'circle-collection' && (record.status === 'sent' || record.status === 'delivered')),
  ];
  const events = new Map<number, { operation: string; bytes: string; sender?: string; payload: CollectionPayload }>();
  for (const record of records) {
    const content = decodeCollectionPayload(record.plaintext), change = parseCollectionChange(record.collectionChange);
    const epoch = /^circle:([1-9][0-9]*)$/.exec(record.audience)?.[1];
    if (!content || !change || !Number.isSafeInteger(record.collectionRevision) || (record.collectionRevision ?? 0) < 1 || !epoch || !Number.isSafeInteger(Number(epoch)) ||
      JSON.stringify(content.change) !== JSON.stringify(change) || ('image' in content && content.image.epoch !== Number(epoch)) ||
      ('status' in record && (!record.event || record.circle !== circleId || record.target !== null))) return { state: 'invalid', revision };
    const value = record.collectionRevision!, bytes = JSON.stringify(content), sender = 'sender' in record ? record.sender.identity : undefined, prior = events.get(value);
    if (prior && (prior.operation !== record.operation || prior.bytes !== bytes || (sender !== undefined && prior.sender !== undefined && sender !== prior.sender))) return { state: 'conflict', revision };
    events.set(value, { operation: record.operation, bytes, sender: sender ?? prior?.sender, payload: content });
  }
  if ([...events.keys()].some(value => value > revision)) return { state: 'stale', revision };
  const items = new Map<string, CollectionItem>(), seen = new Set<string>();
  const ordered = [...events].sort(([a], [b]) => a - b);
  if (ordered.length !== revision) return { state: 'incomplete', revision };
  let next = 1;
  for (const [value, event] of ordered) {
    if (value !== next++) return { state: 'incomplete', revision };
    const content = event.payload, change = content.change;
    if ('image' in content) {
      if (seen.has(change.item)) return { state: 'conflict', revision };
      seen.add(change.item);
      items.set(change.item, Object.freeze({ id: change.item, kind: change.kind, label: content.label, image: content.image }));
    } else {
      const previous = items.get(change.item);
      if (!previous || previous.kind !== change.kind) return { state: 'conflict', revision };
      items.delete(change.item);
    }
  }
  return Object.freeze({ state: 'ready', revision, items: Object.freeze([...items.values()]) });
}
