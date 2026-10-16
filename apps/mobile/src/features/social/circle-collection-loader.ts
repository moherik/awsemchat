import { selectCircleCollection } from './circle-collection.ts';
import { selectAcceptedCollectionSnapshot } from './collection-snapshot.ts';
import type { CollectionSelection } from './circle-collection';
import type { ConversationContext, CollectionManifest, CollectionManifestInput } from '../messages/api';
import type { HistorySnapshot } from '../messages/history-store';
type Ports = {
  account(): string;
  context(input: { circleId: string }): Promise<ConversationContext>;
  manifest(input: CollectionManifestInput): Promise<CollectionManifest>;
  history(): Promise<Pick<HistorySnapshot, 'incoming' | 'outgoing'>>;
};
function fail(code: string): never { throw new Error(code); }
export async function loadCircleCollection(ports: Ports, circleId: string): Promise<CollectionSelection> {
  const account = ports.account();
  async function checked<T>(job: () => Promise<T>): Promise<T> {
    if (ports.account() !== account) fail('SESSION_CHANGED');
    const value = await job();
    if (ports.account() !== account) fail('SESSION_CHANGED');
    return value;
  }
  const context = await checked(() => ports.context({ circleId }));
  const epoch = context.epoch, revision = context.collectionRevision;
  if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(epoch) || epoch! < 1 || !Number.isSafeInteger(revision) || revision! < 0 || context.audience !== `circle:${epoch}`) fail('CONTEXT_MISMATCH');
  const items: CollectionManifest['items'] = [];
  let cursor: string | undefined, complete = false;
  for (let page = 0; page < 256; page++) {
    const result = await checked(() => ports.manifest({ circleId, epoch: epoch!, revision: revision!, limit: 50, ...(cursor ? { cursor } : {}) }));
    if (result.circleId !== circleId || result.epoch !== epoch || result.revision !== revision || !Array.isArray(result.items) || result.items.length > 50 || typeof result.more !== 'boolean') fail('INVALID_MANIFEST');
    let previous = cursor ?? '';
    for (const entry of result.items) {
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(entry.id) || entry.id === '.' || entry.id === '..' || entry.id <= previous || (entry.kind !== 'sticker' && entry.kind !== 'emoji')) fail('INVALID_MANIFEST');
      previous = entry.id; items.push(Object.freeze({ ...entry }));
    }
    if (!result.more) { if (result.cursor !== undefined) fail('INVALID_MANIFEST'); complete = true; break; }
    if (!result.items.length || result.cursor !== previous || result.cursor === cursor) fail('INVALID_MANIFEST');
    cursor = result.cursor;
  }
  if (!complete) fail('CAPACITY');
  const history = await checked(ports.history);
  const latest = await checked(() => ports.context({ circleId }));
  if (latest.circleId !== circleId || latest.conversation !== circleId || latest.epoch !== epoch || latest.collectionRevision !== revision || latest.audience !== context.audience) fail('CONTEXT_MISMATCH');
  const ids = new Set([...history.incoming, ...history.outgoing].filter(record => record.conversation === circleId && record.audience === context.audience && record.collectionRevision === revision && record.contentType === 'circle-collection-snapshot').map(record => record.collectionSnapshot?.id).filter((id): id is string => typeof id === 'string'));
  let ready: CollectionSelection | undefined;
  for (const snapshot of [...ids].sort()) {
    const selected = selectAcceptedCollectionSnapshot(history, { snapshot, circleId, epoch: epoch!, revision: revision! }, items);
    if (selected.state === 'invalid' || selected.state === 'conflict') return selected;
    if (selected.state === 'ready') {
      if (ready && JSON.stringify(ready) !== JSON.stringify(selected)) return { state: 'conflict', revision: revision! };
      ready = selected;
    }
  }
  if (ready) return ready;
  const mutations = selectCircleCollection(history, circleId, revision!);
  return mutations.state === 'ready' ? mutations : { state: 'incomplete', revision: revision! };
}
