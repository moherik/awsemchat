import { decodeCollectionPayload, encodeCollectionPayload, type CollectionItem } from './circle-collection.ts';
import type { ConversationContext, ProfileCancellation, SentEvent } from '../messages/api';
import type { MessageDraft } from '../messages/send';
import type { HistorySnapshot } from '../messages/history-store';
import type { durableEncryption } from '../../security/durable-encryption';
type Ports = {
  account(): string;
  operation(): string;
  context(input: { circleId: string }): Promise<ConversationContext>;
  history(): Promise<Pick<HistorySnapshot, 'incoming' | 'outgoing'>>;
  send(draft: MessageDraft): Promise<SentEvent>;
  native: Pick<ReturnType<typeof durableEncryption>, 'collectionRecoveryDraft' | 'confirmSend' | 'retireCollection'>;
  cancel(envelope: string): Promise<ProfileCancellation>;
};
function fail(code: string): never { throw new Error(code); }
export function createCircleCollectionPublisher(ports: Ports, circleId: string) {
  const bound = ports.account();
  let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== bound) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>) { check(); const result = await job(); check(); return result; }
  function serial<T>(job: () => Promise<T>): Promise<T> { const result = tail.then(() => { check(); return job(); }); tail = result.catch(() => {}); return result; }
  async function pending(): Promise<MessageDraft | undefined> {
    const history = await checked(ports.history);
    const queued = history.outgoing.filter(record => record.conversation === circleId && record.contentType === 'circle-collection' && record.status === 'queued');
    if (queued.length > 1) fail('COLLECTION_PENDING_INVALID');
    const record = queued[0]; if (!record) return undefined;
    const content = decodeCollectionPayload(record.plaintext), epoch = /^circle:([1-9][0-9]*)$/.exec(record.audience)?.[1];
    if (!content || !epoch || !Number.isSafeInteger(Number(epoch)) || record.circle !== circleId || record.target !== null || record.event !== null || !Number.isSafeInteger(record.collectionRevision) || record.collectionRevision! < 1 || JSON.stringify(content.change) !== JSON.stringify(record.collectionChange) || ('image' in content && content.image.epoch !== Number(epoch))) fail('COLLECTION_PENDING_INVALID');
    return { circleId, expectedEpoch: Number(epoch), contentType: 'circle-collection', operation: record.operation, plaintext: record.plaintext, collectionRevision: record.collectionRevision!, collectionChange: content.change };
  }
  function publish(plaintext: string) {
    return serial(async () => {
      if (await pending()) fail('COLLECTION_PENDING');
      const context = await checked(() => ports.context({ circleId })), content = decodeCollectionPayload(plaintext)!;
      if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || !Number.isSafeInteger(context.collectionRevision) || context.collectionRevision! < 0 || context.collectionRevision! >= Number.MAX_SAFE_INTEGER || ('image' in content && content.image.epoch !== context.epoch)) fail('CONTEXT_MISMATCH');
      return checked(() => ports.send({ circleId, expectedEpoch: context.epoch, contentType: 'circle-collection', operation: ports.operation(), plaintext, collectionRevision: context.collectionRevision! + 1, collectionChange: content.change }));
    });
  }
  return {
    add(input: CollectionItem) { return publish(encodeCollectionPayload({ version: 1, change: { action: 'add', kind: input.kind, item: input.id }, label: input.label, image: input.image })); },
    remove(input: Pick<CollectionItem, 'id' | 'kind'>) { return publish(encodeCollectionPayload({ version: 1, change: { action: 'remove', kind: input.kind, item: input.id } })); },
    pending: () => serial(pending),
    retry: () => serial(async () => { const draft = await pending(); if (!draft) fail('NO_PENDING_COLLECTION'); return checked(() => ports.send(draft)); }),
    recover: () => serial(async () => {
      const draft = await pending(); if (!draft) fail('NO_PENDING_COLLECTION');
      const envelope = await checked(() => ports.native.collectionRecoveryDraft({ operation: draft.operation, circle: circleId, plaintext: draft.plaintext, collectionRevision: draft.collectionRevision!, collectionChange: draft.collectionChange! }));
      const result = await checked(() => ports.cancel(envelope));
      if (result.operation !== draft.operation) fail('INVALID_RESPONSE');
      if (result.state === 'committed') {
        if (!result.event || result.event.operation !== draft.operation || result.event.status !== 'sent') fail('INVALID_RESPONSE');
        await checked(() => ports.native.confirmSend({ operation: draft.operation, event: result.event!.id, status: 'sent' }));
        return 'committed' as const;
      }
      if (result.state !== 'cancelled') fail('INVALID_RESPONSE');
      await checked(() => ports.native.retireCollection({ operation: draft.operation, envelope }));
      return 'cancelled' as const;
    }),
  };
}
