import { encodeCollectionPayload } from './circle-collection.ts';
import type { createCircleMediaUpload, CollectionUploadIntent } from '../media/upload';
import type { ConversationContext, SentEvent } from '../messages/api';
import type { HistorySnapshot } from '../messages/history-store';
import type { MessageDraft } from '../messages/send';
type Ports = {
  account(): string; operation(): string;
  upload: ReturnType<typeof createCircleMediaUpload>;
  context(input: { circleId: string }): Promise<ConversationContext>;
  history(): Promise<Pick<HistorySnapshot, 'incoming' | 'outgoing'>>;
  send(draft: MessageDraft): Promise<SentEvent>;
};
function fail(code: string): never { throw new Error(code); }
export function createCircleCollectionMediaEditor(ports: Ports, circleId: string) {
  const binding = ports.account(); let busy = false;
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>) { check(); const value = await job(); check(); return value; }
  async function run<T>(job: () => Promise<T>): Promise<T> { if (busy) fail('BUSY'); busy = true; try { check(); return await job(); } finally { busy = false; } }
  function current(context: ConversationContext, epoch?: number, revision?: number) {
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || !Number.isSafeInteger(context.collectionRevision) || context.collectionRevision! < 0 || context.collectionRevision! >= Number.MAX_SAFE_INTEGER || (epoch !== undefined && context.epoch !== epoch) || (revision !== undefined && context.collectionRevision !== revision)) fail('CONTEXT_MISMATCH');
  }
  async function resume() {
    const job = await checked(ports.upload.pending); if (!job) return;
    const intent = job.collectionIntent; if (!intent || intent.action !== 'add' || job.profileRevision !== undefined) fail('COLLECTION_PENDING_INVALID');
    const plaintext = encodeCollectionPayload({ version: 1, change: { action: 'add', kind: intent.kind, item: intent.id }, label: intent.label, image: { epoch: job.epoch, media: job.prepared.descriptor } });
    const history = await checked(ports.history), records = history.outgoing.filter(record => record.operation === intent.operation);
    if (records.some(record => record.contentType !== 'circle-collection' || record.conversation !== circleId || record.circle !== circleId || record.target !== null || record.audience !== `circle:${job.epoch}` || record.collectionRevision !== intent.revision + 1 || record.plaintext !== plaintext || JSON.stringify(record.collectionChange) !== JSON.stringify({ action: 'add', kind: intent.kind, item: intent.id }))) fail('COLLECTION_PENDING_INVALID');
    if (records.some(record => (record.status === 'sent' || record.status === 'delivered') && !!record.event)) {
      if (job.phase !== 'uploaded') fail('COLLECTION_PENDING_INVALID');
      await checked(ports.upload.acknowledge); return;
    }
    const queued = history.outgoing.filter(record => record.conversation === circleId && record.contentType === 'circle-collection' && record.status === 'queued');
    if (queued.length > 1 || queued.some(record => record.operation !== intent.operation || record.event !== null)) fail('COLLECTION_PENDING');
    if (!queued.length) current(await checked(() => ports.context({ circleId })), job.epoch, intent.revision);
    else if (job.phase !== 'uploaded') fail('COLLECTION_PENDING_INVALID');
    const descriptor = await checked(ports.upload.upload);
    if (JSON.stringify(descriptor) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    await checked(() => ports.send({ circleId, expectedEpoch: job.epoch, contentType: 'circle-collection', operation: intent.operation, plaintext, collectionRevision: intent.revision + 1, collectionChange: { action: 'add', kind: intent.kind, item: intent.id } }));
    const uploaded = await checked(ports.upload.pending);
    if (!uploaded || uploaded.phase !== 'uploaded' || JSON.stringify(uploaded.collectionIntent) !== JSON.stringify(intent) || JSON.stringify(uploaded.prepared) !== JSON.stringify(job.prepared)) fail('MEDIA_CONFLICT');
    await checked(ports.upload.acknowledge);
  }
  return {
    pending: () => checked(ports.upload.pending),
    resume: () => run(resume),
    discard: (operation: string) => run(async () => {
      const job = await checked(ports.upload.pending);
      if (!job) return;
      if (job.collectionIntent?.operation !== operation) fail('COLLECTION_PENDING_INVALID');
      const result = await checked(ports.upload.cancel);
      if (result.state === 'committed') { await resume(); return result; }
      return result;
    }),
    choose(input: { id: string; kind: 'sticker' | 'emoji'; label: string; bytes: Uint8Array; mimeType: string }) {
      const owned = { ...input, bytes: input.bytes.slice() };
      return run(async () => {
        if (await checked(ports.upload.pending)) fail('MEDIA_PENDING');
        const context = await checked(() => ports.context({ circleId })); current(context);
        const intent: CollectionUploadIntent = { action: 'add', id: owned.id, kind: owned.kind, label: owned.label.trim(), operation: ports.operation(), revision: context.collectionRevision! };
        await checked(() => ports.upload.prepare(owned, context.epoch!, undefined, intent));
        await resume();
      });
    },
  };
}
