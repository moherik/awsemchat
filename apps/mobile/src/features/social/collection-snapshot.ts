import { parseSnapshotHeader } from '../../security/snapshot-header.ts';
import type { HistorySnapshot } from '../messages/history-store';
import { decodeCollectionPayload, encodeCollectionPayload, type CollectionItem } from './circle-collection.ts';
export type SnapshotBinding = Readonly<{ snapshot: string; circleId: string; epoch: number; revision: number }>;
export type SnapshotPart = SnapshotBinding & Readonly<{ version: 1; part: number; parts: number; items: readonly CollectionItem[] }>;
type Manifest = readonly Readonly<{ id: string; kind: 'sticker' | 'emoji' }>[];
type Selection = Readonly<{ state: 'ready'; revision: number; items: readonly CollectionItem[] }> | Readonly<{ state: 'invalid' | 'conflict' | 'incomplete'; revision: number }>;
const maxPartBytes = 16384;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
function invalid(): never { throw new Error('INVALID_SNAPSHOT'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function binding(value: SnapshotBinding) {
  if (!identifier(value.snapshot) || !identifier(value.circleId) || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || !Number.isSafeInteger(value.revision) || value.revision < 0) invalid();
  return Object.freeze({ snapshot: value.snapshot, circleId: value.circleId, epoch: value.epoch, revision: value.revision });
}
function bytes(value: string) { let count = 0; for (const point of value) { const code = point.codePointAt(0)!; count += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; } return count; }
function item(value: unknown, epoch: number): CollectionItem {
  const raw = object(value);
  if (Object.keys(raw).sort().join(',') !== 'id,image,kind,label') invalid();
  try {
    const content = decodeCollectionPayload(encodeCollectionPayload({ version: 1, change: { action: 'add', kind: raw.kind, item: raw.id }, label: raw.label, image: raw.image }));
    if (!content || !('image' in content) || content.image.epoch !== epoch) return invalid();
    return Object.freeze({ id: content.change.item, kind: content.change.kind, label: content.label, image: content.image });
  } catch { return invalid(); }
}
function manifest(value: Manifest) {
  const entries = new Map<string, 'sticker' | 'emoji'>();
  for (const raw of value) {
    const entry = object(raw);
    if (Object.keys(entry).sort().join(',') !== 'id,kind' || !identifier(entry.id) || (entry.kind !== 'sticker' && entry.kind !== 'emoji') || entries.has(entry.id)) invalid();
    entries.set(entry.id, entry.kind);
  }
  return entries;
}
function matches(items: readonly CollectionItem[], entries: Map<string, 'sticker' | 'emoji'>) {
  if (items.length !== entries.size || new Set(items.map(value => value.id)).size !== items.length || items.some(value => entries.get(value.id) !== value.kind)) invalid();
}
export function prepareCollectionSnapshot(input: SnapshotBinding, current: readonly CollectionItem[], topology: Manifest, layout?: readonly number[]): readonly SnapshotPart[] {
  const expected = binding(input), entries = manifest(topology), items = current.map(value => item(value, expected.epoch)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  matches(items, entries);
  const groups: CollectionItem[][] = [];
  if (layout) {
    if (!layout.length || layout.length > 256 || layout.some(size => !Number.isSafeInteger(size) || size < 0 || size > 50) || layout.some(size => size === 0) && (items.length !== 0 || layout.length !== 1) || layout.reduce((sum, size) => sum + size, 0) !== items.length) throw new Error('CAPACITY');
    let offset = 0;
    for (const size of layout) {
      const group = items.slice(offset, offset + size); offset += size;
      if (bytes(JSON.stringify({ version: 1, ...expected, part: Number.MAX_SAFE_INTEGER, parts: Number.MAX_SAFE_INTEGER, items: group })) > maxPartBytes) throw new Error('CAPACITY');
      groups.push(group);
    }
  } else {
    let group: CollectionItem[] = [];
    for (const entry of items) {
      const candidate = [...group, entry];
      if (candidate.length > 50 || bytes(JSON.stringify({ version: 1, ...expected, part: Number.MAX_SAFE_INTEGER, parts: Number.MAX_SAFE_INTEGER, items: candidate })) > maxPartBytes) {
        if (!group.length) throw new Error('CAPACITY');
        groups.push(group); if (groups.length >= 256) throw new Error('CAPACITY'); group = [entry];
      } else group = candidate;
    }
    if (group.length || !groups.length) groups.push(group);
  }
  return Object.freeze(groups.map((values, part) => Object.freeze({ version: 1, ...expected, part, parts: groups.length, items: Object.freeze(values) })));
}
export function planCollectionSnapshotLayout(input: SnapshotBinding, current: readonly CollectionItem[], topology: Manifest): readonly number[] {
  const placeholders = current.map(entry => Object.freeze({ ...entry, image: Object.freeze({ epoch: input.epoch, media: Object.freeze({ version: 1 as const, id: 'x'.repeat(64), key: '0'.repeat(64), size: 2 * 1024 * 1024, mimeType: 'image/webp' }) }) }));
  return Object.freeze(prepareCollectionSnapshot(input, placeholders, topology).map(value => value.items.length));
}
function part(raw: unknown, expected: SnapshotBinding): SnapshotPart {
  const value = object(raw);
  if (Object.keys(value).sort().join(',') !== 'circleId,epoch,items,part,parts,revision,snapshot,version' || value.version !== 1 || value.snapshot !== expected.snapshot || value.circleId !== expected.circleId || value.epoch !== expected.epoch || value.revision !== expected.revision || !Number.isSafeInteger(value.parts) || (value.parts as number) < 1 || !Number.isSafeInteger(value.part) || (value.part as number) < 0 || (value.part as number) >= (value.parts as number) || !Array.isArray(value.items) || bytes(JSON.stringify(value)) > maxPartBytes) invalid();
  const items = value.items.map(entry => item(entry, expected.epoch));
  if (!items.length && value.parts !== 1 || items.some((entry, index) => index > 0 && entry.id <= items[index - 1].id)) invalid();
  return Object.freeze({ version: 1, ...expected, part: value.part as number, parts: value.parts as number, items: Object.freeze(items) });
}
export function assembleCollectionSnapshot(input: SnapshotBinding, received: readonly unknown[], topology: Manifest): Selection {
  try {
    const expected = binding(input), entries = manifest(topology), parts = new Map<number, SnapshotPart>(); let total: number | undefined;
    for (const raw of received) {
      const decoded = part(raw, expected), prior = parts.get(decoded.part);
      if (total !== undefined && total !== decoded.parts || prior && JSON.stringify(prior) !== JSON.stringify(decoded)) return { state: 'conflict', revision: expected.revision };
      total = decoded.parts; parts.set(decoded.part, decoded);
    }
    if (total === undefined || parts.size !== total) return { state: 'incomplete', revision: expected.revision };
    const ordered = [...parts.values()].sort((a, b) => a.part - b.part), items = ordered.flatMap(value => [...value.items]);
    if (ordered.some((value, index) => value.part !== index) || items.some((entry, index) => index > 0 && entry.id <= items[index - 1].id)) invalid();
    matches(items, entries);
    return Object.freeze({ state: 'ready', revision: expected.revision, items: Object.freeze(items) });
  } catch { return { state: 'invalid', revision: input.revision }; }
}

export function selectAcceptedCollectionSnapshot(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, input: SnapshotBinding, topology: Manifest): Selection {
  const received: SnapshotPart[] = [];
  let publisher: string | undefined;
  try {
    const expected = binding(input);
    const records = [
      ...history.incoming.filter(record => record.collectionAccepted === true),
      ...history.outgoing.filter(record => (record.status === 'sent' || record.status === 'delivered') && !!record.event && record.circle === expected.circleId && record.target === null),
    ];
    for (const record of records) {
      if (record.contentType !== 'circle-collection-snapshot' || record.conversation !== expected.circleId || record.audience !== `circle:${expected.epoch}` || record.collectionRevision !== expected.revision) continue;
      const header = parseSnapshotHeader(record.collectionSnapshot);
      if (!header) return { state: 'invalid', revision: expected.revision };
      if (header.id !== expected.snapshot) continue;
      if (bytes(record.plaintext) > maxPartBytes) return { state: 'invalid', revision: expected.revision };
      const decoded = part(JSON.parse(record.plaintext), expected);
      if (decoded.part !== header.part || decoded.parts !== header.parts || JSON.stringify(decoded.items.map(({ id, kind }) => ({ id, kind }))) !== JSON.stringify(header.items)) return { state: 'invalid', revision: expected.revision };
      if ('sender' in record) {
        const identity = record.sender.identity;
        if (publisher !== undefined && publisher !== identity) return { state: 'conflict', revision: expected.revision };
        publisher = identity;
      }
      received.push(decoded);
    }
    return assembleCollectionSnapshot(expected, received, topology);
  } catch { return { state: 'invalid', revision: input.revision }; }
}
