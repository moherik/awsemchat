import type { CollectionSelection, CollectionItem } from './circle-collection';
import type { Details } from './api';
type Ports = { account(): string; memberId(): string; details(): Promise<Details>; load(): Promise<CollectionSelection>; remove(item: Pick<CollectionItem, 'id' | 'kind'>): Promise<unknown>; download(item: CollectionItem): Promise<Uint8Array> };
type Snapshot = Readonly<{ state: 'ready'; revision: number; items: readonly CollectionItem[]; canRemove: boolean; needsRefresh: boolean }> | Readonly<{ state: 'incomplete' | 'stale' | 'invalid' | 'conflict'; revision: number; items: readonly CollectionItem[]; canRemove: false; needsRefresh: false }>;
function fail(code: string): never { throw new Error(code); }
export function createCircleStickerManagement(ports: Ports, circleId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') fail('INVALID_INPUT');
  const binding = ports.account(); let cached: Snapshot | undefined; let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>): Promise<T> { check(); const value = await job(); check(); return value; }
  async function load(): Promise<Snapshot> {
    const [details, collection] = await Promise.all([checked(ports.details), checked(ports.load)]);
    if (details.id !== circleId) fail('CONTEXT_MISMATCH');
    const membership = details.members.find(member => member.accountId === ports.memberId());
    if (!membership) fail('DENIED');
    if (collection.state !== 'ready') return cached = Object.freeze({ state: collection.state, revision: collection.revision, items: Object.freeze([]), canRemove: false, needsRefresh: false });
    return cached = Object.freeze({ state: 'ready', revision: collection.revision, items: Object.freeze(collection.items.map(item => Object.freeze({ ...item }))), canRemove: membership.role === 'admin', needsRefresh: collection.items.some(item => item.image.epoch !== details.epoch) });
  }
  function remove(item: Pick<CollectionItem, 'id' | 'kind'>): Promise<void> {
    const result = tail.then(async () => {
      check(); const state = await load();
      if (!state.canRemove || !state.items.some(value => value.id === item.id && value.kind === item.kind)) fail('DENIED');
      await checked(() => ports.remove({ id: item.id, kind: item.kind }));
      cached = undefined;
    });
    tail = result.catch(() => {}); return result;
  }
  return { load, getSnapshot: () => cached, remove, download: (item: CollectionItem) => checked(() => ports.download(item)) };
}
