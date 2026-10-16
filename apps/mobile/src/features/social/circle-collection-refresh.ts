import { planCollectionSnapshotLayout, prepareCollectionSnapshot } from './collection-snapshot.ts';
import type { CollectionItem, CollectionSelection } from './circle-collection';
import type { ConversationContext } from '../messages/api';
import type { PendingMediaUpload } from '../media/upload';
type Upload = { pending(): Promise<PendingMediaUpload | undefined>; prepare(input: { bytes: Uint8Array; mimeType: string }, epoch: number, revision?: number, intent?: { action: 'add' | 'snapshot-refresh'; id: string; kind: 'sticker' | 'emoji'; label: string; revision: number; operation: string }): Promise<unknown>; upload(): Promise<PendingMediaUpload['prepared']['descriptor']>; acknowledge(): Promise<void> };
type Ports = {
  account(): string; operation(): string; context(input: { circleId: string }): Promise<ConversationContext>;
  load(): Promise<CollectionSelection>; download(item: CollectionItem): Promise<{ bytes: Uint8Array; mimeType: string }>;
  upload(itemId: string): Promise<Upload>; publish(parts: ReturnType<typeof prepareCollectionSnapshot>, operations: readonly string[]): Promise<unknown>;
};
function fail(code: string): never { throw new Error(code); }
export function createCircleCollectionRefresh(ports: Ports, circleId: string) {
  const binding = ports.account(); let busy = false;
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>) { check(); const result = await job(); check(); return result; }
  return {
    async run() {
      if (busy) fail('BUSY'); busy = true;
      try {
        check(); const context = await checked(() => ports.context({ circleId }));
        if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || !Number.isSafeInteger(context.collectionRevision) || context.collectionRevision! < 0 || context.audience !== `circle:${context.epoch}`) fail('CONTEXT_MISMATCH');
        const selection = await checked(ports.load);
        if (selection.state !== 'ready' || selection.revision !== context.collectionRevision) fail('COLLECTION_INCOMPLETE');
        const snapshot = ports.operation(), current = [...selection.items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        const topology = current.map(({ id, kind }) => ({ id, kind }));
        const layout = planCollectionSnapshotLayout({ snapshot, circleId, epoch: context.epoch!, revision: context.collectionRevision! }, current, topology);
        const operationByItem = new Map<string, string>(), partOperations = layout.map(() => ports.operation());
        const indexed = new Map<string, number>(); let offset = 0;
        layout.forEach((size, part) => { for (const item of current.slice(offset, offset + size)) indexed.set(item.id, part); offset += size; });
        const staged = await Promise.all(current.map(async item => ({ item, controller: await checked(() => ports.upload(item.id)) })));
        const pendingByItem = new Map<string, PendingMediaUpload | undefined>();
        for (const { item, controller } of staged) {
          const pending = await checked(() => controller.pending()); pendingByItem.set(item.id, pending);
          if (!pending?.collectionIntent || pending.collectionIntent.action !== 'snapshot-refresh') continue;
          if (pending.collectionIntent.id !== item.id || pending.collectionIntent.kind !== item.kind || pending.collectionIntent.revision !== context.collectionRevision || pending.epoch !== context.epoch || pending.profileRevision !== undefined) fail('MEDIA_CONFLICT');
          const part = indexed.get(item.id)!;
          if (operationByItem.has(String(part)) && operationByItem.get(String(part)) !== pending.collectionIntent.operation) fail('MEDIA_CONFLICT');
          operationByItem.set(String(part), pending.collectionIntent.operation);
        }
        for (const [part, operation] of operationByItem) partOperations[Number(part)] = operation;
        const items: CollectionItem[] = [];
        const uploads: { controller: Upload; descriptor: PendingMediaUpload['prepared']['descriptor'] }[] = [];
        for (const { item, controller } of staged) {
          const pending = pendingByItem.get(item.id);
          if (pending && (!pending.collectionIntent || pending.collectionIntent.action !== 'snapshot-refresh')) fail('MEDIA_CONFLICT');
          if (item.image.epoch === context.epoch) {
            if (pending) {
              if (pending.phase !== 'uploaded' || JSON.stringify(pending.prepared.descriptor) !== JSON.stringify(item.image.media)) fail('MEDIA_CONFLICT');
              await checked(controller.acknowledge);
            }
            items.push(item); continue;
          }
          if (!pending) {
            const source = await checked(() => ports.download(item));
            if (!(source.bytes instanceof Uint8Array) || source.mimeType !== item.image.media.mimeType) fail('MEDIA_INVALID');
            await checked(() => controller.prepare({ bytes: source.bytes, mimeType: source.mimeType }, context.epoch!, undefined, { action: 'snapshot-refresh', id: item.id, kind: item.kind, label: item.label, revision: context.collectionRevision!, operation: partOperations[indexed.get(item.id)!] }));
          }
          const saved = await checked(() => controller.pending()); if (!saved?.collectionIntent || saved.collectionIntent.action !== 'snapshot-refresh' || saved.collectionIntent.id !== item.id || saved.epoch !== context.epoch) fail('MEDIA_CONFLICT');
          const descriptor = await checked(() => controller.upload());
          uploads.push({ controller, descriptor });
          items.push(Object.freeze({ ...item, image: Object.freeze({ epoch: context.epoch!, media: descriptor }) }));
        }
        const latest = await checked(() => ports.context({ circleId }));
        if (latest.epoch !== context.epoch || latest.collectionRevision !== context.collectionRevision || latest.audience !== context.audience) fail('CONTEXT_MISMATCH');
        const parts = prepareCollectionSnapshot({ snapshot, circleId, epoch: context.epoch!, revision: context.collectionRevision! }, items, items.map(({ id, kind }) => ({ id, kind })), layout);
        await checked(() => ports.publish(parts, partOperations));
        for (const { controller, descriptor } of uploads) {
          const saved = await checked(() => controller.pending());
          if (saved?.phase === 'uploaded' && JSON.stringify(saved.prepared.descriptor) === JSON.stringify(descriptor)) await checked(() => controller.acknowledge());
        }
      } finally { busy = false; }
    },
  };
}
