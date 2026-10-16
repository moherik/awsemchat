import { copySnapshotHeader } from '../../security/snapshot-header.ts';
import type { Delivery } from './api';
import type { Ciphertext } from '../../security/encryption-adapter';
import type { CollectionMetadata, ContentType, PeerKeys } from '../../security/durable-encryption';

type Incoming = CollectionMetadata & { profileRevision?: number; contentType?: ContentType; serverEventId: string; peer: string; operation: string; conversation: string; audience: string; message: Ciphertext };
type Receiver = {
  bundle(): Promise<PeerKeys>;
  committedReceive(input: Incoming & { sender: PeerKeys }): Promise<boolean>;
  observePeer(peer: string, keys: PeerKeys): Promise<unknown>;
  receive(input: Incoming): Promise<unknown>;
};
type ReceiptAPI = { acknowledge(eventId: string): Promise<void> };
type ReceiveOptions = { acknowledge?: boolean };

export async function receiveDelivery(native: Receiver, api: ReceiptAPI, delivery: Delivery, options: ReceiveOptions = {}): Promise<void> {
  const snapshot = delivery.collectionSnapshot ? copySnapshotHeader(delivery.collectionSnapshot) : undefined;
  const change = delivery.collectionChange ? Object.freeze({ ...delivery.collectionChange }) : undefined;
  const revision = delivery.collectionRevision;
  const own = await native.bundle();
  if (own.identity !== delivery.recipientKeys.identity || own.signingIdentity !== delivery.recipientKeys.signingIdentity) {
    throw Object.assign(new Error('RECIPIENT_MISMATCH'), { code: 'RECIPIENT_MISMATCH' });
  }
  const incoming = { ...(snapshot === undefined ? {} : { collectionSnapshot: snapshot }), ...(revision === undefined ? {} : { collectionRevision: revision }), ...(change === undefined ? {} : { collectionChange: change }), peer: delivery.senderId, operation: delivery.operation, conversation: delivery.conversation,
    audience: delivery.audience, serverEventId: delivery.id, message: delivery.message, ...(delivery.profileRevision === undefined ? {} : { profileRevision: delivery.profileRevision }), ...(delivery.contentType === undefined ? {} : { contentType: delivery.contentType }) };
  const proof = { ...incoming, sender: delivery.sender };
  if (!await native.committedReceive(proof)) {
    await native.observePeer(delivery.senderId, delivery.sender);
    await native.receive(incoming);
    if (!await native.committedReceive(proof)) {
      throw Object.assign(new Error('RECEIVE_UNCONFIRMED'), { code: 'RECEIVE_UNCONFIRMED' });
    }
  }
  if (options.acknowledge !== false) await api.acknowledge(delivery.id);
}
