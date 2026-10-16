import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import type { Ciphertext } from './encryption-adapter';
import type { PublicationBinding } from './account-encryption';

export type PeerKeys = { identity: string; signingIdentity: string };
export type ContentType = 'text' | 'ping' | 'pong' | 'redaction-control' | 'private-profile' | 'now-playing' | 'circle-profile' | 'circle-member-profile' | 'circle-collection' | 'circle-collection-snapshot';
export type CollectionChange = Readonly<{ action: 'add' | 'remove'; kind: 'sticker' | 'emoji'; item: string }>;
export type CollectionSnapshotHeader = Readonly<{ id: string; part: number; parts: number; items: readonly Readonly<{ id: string; kind: 'sticker' | 'emoji' }>[] }>;
export type CollectionMetadata = { collectionSnapshot?: CollectionSnapshotHeader; collectionRevision?: number; collectionChange?: CollectionChange };
export type SignedPublicBundle = PeerKeys & { version: 1; context: 'awsemchat.olm.signed-prekey';
  publication: string; keyId: string; prekey: string; issuedAt: number; expiresAt: number; signature: string };
export type PrekeyPublication = { bundles: SignedPublicBundle[] };
export type SignedRegistration = PrekeyPublication & { proof: string };
export type PrekeyStatus = { stored: number; unpublished: number; pending: string | null };
export type PeerPin = { historyExhausted: boolean; current: PeerKeys; pending: PeerKeys | null; observed: PeerKeys[]; verified: boolean; revision: number };
export type LegacyMessageIdentity = { conversation: string; audience: string; operation: string; peerKeys: PeerKeys };
export type RedactionTarget = { eventId: string } | { legacy: LegacyMessageIdentity };
export type Redaction = { eventId: string; conversation: string; audience: string; operation: string; sender: PeerKeys; cursor?: string };
export type PendingRedaction = { target: RedactionTarget; operation: string; messageOperation: string; confirmed: boolean; redaction?: Redaction; route?: { target?: string; circle?: string; recipients: string[] } };
export type DurableHistory = CollectionMetadata & { serverEventId?: string; collectionAccepted?: boolean; profileAccepted?: boolean; profileRevision?: number; contentType?: ContentType; direction?: 'incoming' | 'outgoing'; sequence?: number; createdAt?: number; operation: string; conversation: string; audience: string; sender: PeerKeys; plaintext: string; archival: boolean };
export type DurableEnvelope = CollectionMetadata & { profileRevision?: number; contentType?: ContentType; version: 1; operation: string; conversation: string; audience: string; sender: PeerKeys;
  recipients: { peer: string; keys: PeerKeys; message: Ciphertext }[] };
export type OutgoingHistory = { collectionSnapshot?: CollectionSnapshotHeader | null; collectionRevision?: number | null; collectionChange?: CollectionChange | null; profileRevision?: number | null; contentType?: ContentType | null; sequence?: number | null; operation: string; conversation: string; audience: string; recipients: string[]; plaintext: string;
  serverEventId?: string | null; target: string | null; circle: string | null; createdAt: number | null; event: string | null; status: 'queued' | 'sent' | 'delivered' };
const codes = new Set(['INVALID_INPUT', 'INPUT_TOO_LARGE', 'CAPACITY', 'CRYPTO_REJECTED', 'INVALID_PLAINTEXT',
  'PREKEY_EXHAUSTED', 'PREKEY_CAPACITY', 'PREKEY_REUSED', 'PUBLICATION_PENDING', 'SIGNATURE_REJECTED', 'BUNDLE_VERSION', 'BUNDLE_EXPIRED', 'UNKNOWN_PEER', 'IDENTITY_CHANGED', 'SESSION_EXISTS', 'NO_SESSION', 'OPERATION_CONFLICT',
  'UNKNOWN_OPERATION', 'OPERATION_CANCELLED', 'REPLAY', 'CONTEXT_MISMATCH', 'STATE_INVALID', 'STATE_VERSION', 'STATE_UNAVAILABLE',
  'ALREADY_EXISTS', 'NOT_INITIALIZED', 'COMMIT_FAILED', 'COMMIT_UNKNOWN', 'UNSUPPORTED_PLATFORM', 'UNAVAILABLE',
  'OPERATION_REDACTED', 'REDACTION_PENDING', 'UNKNOWN_REDACTION', 'REDACTION_CONFLICT']);
export class DurableEncryptionError extends Error {
  readonly code: string;
  constructor(code: string) { const safe = codes.has(code) ? code : 'UNAVAILABLE'; super(safe); this.code = safe; }
}
async function call<T>(namespace: string, request: object): Promise<T> {
  try {
    const result = JSON.parse(await nativeCrypto().executeDurable(namespace, JSON.stringify(request)));
    if (result.ok !== true) throw new DurableEncryptionError(result.code);
    return result.value as T;
  } catch (error) {
    if (error instanceof DurableEncryptionError) throw error;
    throw new DurableEncryptionError(error instanceof Error && error.message === 'UNSUPPORTED_PLATFORM' ? error.message : 'UNAVAILABLE');
  }
}

/** Native durable foundation. Transport activation requires the remaining protocol/security gates. */
export function durableEncryption(namespace: string) {
  return {
    initialize: () => call<PeerKeys>(namespace, { op: 'initialize' }),
    bundle: () => call<PeerKeys>(namespace, { op: 'bundle' }),
    preparePublication: (operation: string) => call<PrekeyPublication>(namespace, { op: 'preparePublication', operation }),
    signPublication: (operation: string, binding: PublicationBinding) => call<SignedRegistration>(namespace, { op: 'signPublication', operation, ...binding }),
    confirmPublication: (operation: string) => call<null>(namespace, { op: 'confirmPublication', operation }),
    prekeyStatus: () => call<PrekeyStatus>(namespace, { op: 'prekeyStatus' }),
    observePeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'observePeer', peer, keys }),
    acknowledgePeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'acknowledgePeer', peer, keys }),
    verifyPeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'verifyPeer', peer, keys }),
    peer: (peer: string) => call<PeerPin>(namespace, { op: 'peer', peer }),
    hasSession: (peer: string) => call<boolean>(namespace, { op: 'hasSession', peer }),
    outbound: (peer: string, bundle: SignedPublicBundle) => call<null>(namespace, { op: 'outbound', peer, bundle }),
    send: (input: CollectionMetadata & { profileRevision?: number; contentType?: ContentType; operation: string; conversation: string; audience: string; recipients: string[]; plaintext: string; target?: string; circle?: string }) =>
      call<string>(namespace, { op: 'send', ...input }),
    retry: (operation: string) => call<string>(namespace, { op: 'retry', operation }),
    retireProfile: (input: { operation: string; envelope: string }) => call<null>(namespace, { op: 'retireProfile', ...input }),
    profileRecoveryDraft: (input: { operation: string; circle: string; plaintext: string; profileRevision: number }) => call<string>(namespace, { op: 'profileRecoveryDraft', ...input }),
    retireCollection: (input: { operation: string; envelope: string }) => call<null>(namespace, { op: 'retireCollection', ...input }),
    collectionRecoveryDraft: (input: { operation: string; circle: string; plaintext: string; collectionRevision: number; collectionChange: CollectionMetadata['collectionChange'] }) => call<string>(namespace, { op: 'collectionRecoveryDraft', ...input }),
    retryDraft: (input: CollectionMetadata & { profileRevision?: number; contentType?: ContentType; operation: string; target?: string; circle?: string; plaintext: string }) => call<string>(namespace, { op: 'retryDraft', ...input }),
    receive: (input: CollectionMetadata & { profileRevision?: number; contentType?: ContentType; serverEventId?: string; peer: string; operation: string; conversation: string; audience: string; message: Ciphertext }) =>
      call<DurableHistory>(namespace, { op: 'receive', ...input }),
    committedReceive: (input: CollectionMetadata & { profileRevision?: number; contentType?: ContentType; serverEventId?: string; peer: string; operation: string; conversation: string; audience: string; sender: PeerKeys; message: Ciphertext }) =>
      call<boolean>(namespace, { op: 'committedReceive', ...input }),
    history: () => call<DurableHistory[]>(namespace, { op: 'history' }),
    outgoingHistory: () => call<OutgoingHistory[]>(namespace, { op: 'outgoingHistory' }),
    confirmSend: (input: { operation: string; event: string; status: 'sent' | 'delivered' }) => call<null>(namespace, { op: 'confirmSend', ...input }),
    beginRedaction: (target: RedactionTarget, operation: string) => call<PendingRedaction>(namespace, { op: 'beginRedaction', target, operation }),
    pendingRedactions: () => call<PendingRedaction[]>(namespace, { op: 'pendingRedactions' }),
    confirmRedaction: (target: RedactionTarget, redaction: Redaction) => call<null>(namespace, { op: 'confirmRedaction', target, redaction }),
    cancelRedaction: (operation: string) => call<null>(namespace, { op: 'cancelRedaction', operation }),
    applyRedactions: (previousCursor: string | null, cursor: string, items: Redaction[]) => call<null>(namespace, { op: 'applyRedactions', previousCursor, cursor, items }),
    redactionCursor: () => call<string | null>(namespace, { op: 'redactionCursor' }),
    completeRedaction: (eventId: string) => call<null>(namespace, { op: 'completeRedaction', eventId }),
    inboxCursor: () => call<string | null>(namespace, { op: 'inboxCursor' }),
    advanceInboxCursor: (previous: string | null, next: string) => call<null>(namespace, { op: 'advanceInboxCursor', previous, next }),
    exportHistory: () => call<DurableHistory[]>(namespace, { op: 'exportHistory' }),
    importHistory: (records: DurableHistory[]) => call<null>(namespace, { op: 'importHistory', records }),
  };
}
