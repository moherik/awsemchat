import type { CollectionSnapshotHeader } from './durable-encryption';
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
export function parseSnapshotHeader(value: unknown): CollectionSnapshotHeader | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const header = value as Record<string, unknown>;
  if (Object.keys(header).sort().join(',') !== 'id,items,part,parts' || !identifier(header.id) || !Number.isSafeInteger(header.part) || (header.part as number) < 0 || !Number.isSafeInteger(header.parts) || (header.parts as number) < 1 || (header.parts as number) > 256 || (header.part as number) >= (header.parts as number) || !Array.isArray(header.items) || header.items.length > 50 || (!header.items.length && header.parts !== 1)) return undefined;
  const items: { id: string; kind: 'sticker' | 'emoji' }[] = []; let previous = '';
  for (const raw of header.items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).sort().join(',') !== 'id,kind' || !identifier(item.id) || item.id <= previous || (item.kind !== 'sticker' && item.kind !== 'emoji')) return undefined;
    previous = item.id; items.push(Object.freeze({ id: item.id, kind: item.kind }));
  }
  return Object.freeze({ id: header.id, part: header.part as number, parts: header.parts as number, items: Object.freeze(items) });
}
export function copySnapshotHeader(value: CollectionSnapshotHeader): CollectionSnapshotHeader {
  const header = parseSnapshotHeader(value); if (!header) throw new Error('INVALID_INPUT'); return header;
}
