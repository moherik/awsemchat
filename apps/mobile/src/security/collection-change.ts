import type { CollectionChange } from './durable-encryption';
export function parseCollectionChange(value: unknown): CollectionChange | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const change = value as Record<string, unknown>;
  if (Object.keys(change).sort().join(',') !== 'action,item,kind' || (change.action !== 'add' && change.action !== 'remove') ||
    (change.kind !== 'sticker' && change.kind !== 'emoji') || typeof change.item !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(change.item) || change.item === '.' || change.item === '..') return undefined;
  return Object.freeze({ action: change.action, kind: change.kind, item: change.item });
}
