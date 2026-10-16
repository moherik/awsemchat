import { copySnapshotHeader } from '../../security/snapshot-header.ts';
import type { CollectionMetadata, ContentType, durableEncryption } from '../../security/durable-encryption';
import type { createKeyAPI } from '../../security/key-publication';
import type { createMessageAPI, ContextInput, SentEvent } from './api';

type Sender = Pick<ReturnType<typeof durableEncryption>, 'retryDraft' | 'bundle' | 'observePeer' | 'hasSession' | 'outbound' | 'send' | 'confirmSend'>;
type MessageAPI = Pick<ReturnType<typeof createMessageAPI>, 'context' | 'send'>;
type KeysAPI = Pick<ReturnType<typeof createKeyAPI>, 'allocate'>;
export type MessageDraft = ContextInput & CollectionMetadata & { expectedEpoch?: number; profileRevision?: number; contentType?: ContentType; operation: string; plaintext: string };
const mismatch = () => Object.assign(new Error('CONTEXT_MISMATCH'), { code: 'CONTEXT_MISMATCH' });

export async function sendMessage(native: Sender, api: MessageAPI, keys: KeysAPI, draft: MessageDraft,
  allocationID: (operation: string, peer: string) => Promise<string>): Promise<SentEvent> {
  draft = { ...draft, ...(draft.collectionSnapshot ? { collectionSnapshot: copySnapshotHeader(draft.collectionSnapshot) } : {}), ...(draft.collectionChange ? { collectionChange: Object.freeze({ ...draft.collectionChange }) } : {}) };
  let saved: string | undefined;
  const route = { ...(draft.collectionSnapshot === undefined ? {} : { collectionSnapshot: draft.collectionSnapshot }), ...(draft.collectionRevision === undefined ? {} : { collectionRevision: draft.collectionRevision }), ...(draft.collectionChange === undefined ? {} : { collectionChange: draft.collectionChange }), target: draft.targetId, circle: draft.circleId, ...(draft.profileRevision === undefined ? {} : { profileRevision: draft.profileRevision }), ...(draft.contentType === undefined ? {} : { contentType: draft.contentType }) };
  try { saved = await native.retryDraft({ operation: draft.operation, plaintext: draft.plaintext, ...route }); } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'UNKNOWN_OPERATION') throw error;
  }
  async function upload(outbox: string) {
    const event = await api.send(outbox);
    await native.confirmSend({ operation: event.operation, event: event.id, status: event.status });
    return event;
  }
  if (saved !== undefined) return upload(saved);
  const current = await api.context({ targetId: draft.targetId, circleId: draft.circleId });
  if (draft.expectedEpoch !== undefined && (!Number.isSafeInteger(draft.expectedEpoch) || draft.expectedEpoch < 1 || current.epoch !== draft.expectedEpoch || current.circleId !== draft.circleId)) throw mismatch();
  if (draft.contentType === 'circle-member-profile' && (!draft.circleId || draft.targetId !== undefined || current.circleId !== draft.circleId || current.epoch !== draft.expectedEpoch)) throw mismatch();
  if (draft.contentType === 'now-playing' && (!draft.targetId || draft.circleId !== undefined || current.circleId !== undefined || !/^private:[0-9a-f]{64}$/.test(current.conversation) || !/^friend:[A-Za-z0-9._:-]{1,128}$/.test(current.audience) || current.recipients.length !== 1 || current.recipients[0].accountId !== draft.targetId)) throw mismatch();
  if (draft.contentType === 'circle-collection' && (!draft.circleId || draft.targetId !== undefined || current.circleId !== draft.circleId || current.collectionRevision === undefined || draft.collectionRevision !== current.collectionRevision + 1)) throw mismatch();
  if (draft.contentType === 'circle-collection-snapshot' && (!draft.circleId || draft.targetId !== undefined || current.circleId !== draft.circleId || current.collectionRevision === undefined || draft.collectionRevision !== current.collectionRevision)) throw mismatch();
  const own = await native.bundle();
  if (own.identity !== current.sender.identity || own.signingIdentity !== current.sender.signingIdentity) throw mismatch();
  for (const recipient of current.recipients) {
    await native.observePeer(recipient.accountId, recipient.keys);
    if (!await native.hasSession(recipient.accountId)) {
      const allocation = await keys.allocate({ operationId: await allocationID(draft.operation, recipient.accountId), targetId: recipient.accountId,
        ...(current.circleId === undefined ? {} : { circleId: current.circleId, epoch: current.epoch }) });
      if (allocation.generation !== recipient.generation || allocation.bundle.identity !== recipient.keys.identity ||
        allocation.bundle.signingIdentity !== recipient.keys.signingIdentity) throw mismatch();
      await native.outbound(recipient.accountId, allocation.bundle);
    }
  }
  const outbox = await native.send({ operation: draft.operation, conversation: current.conversation, audience: current.audience,
    recipients: current.recipients.map(recipient => recipient.accountId), plaintext: draft.plaintext, ...route });
  return upload(outbox);
}
