import { nativeCrypto } from '../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import type { Ciphertext } from './encryption-adapter';

export type PeerKeys = { identity: string; signingIdentity: string };
export type SignedPublicBundle = PeerKeys & { version: 1; context: 'awsemchat.olm.signed-prekey';
  publication: string; keyId: string; prekey: string; issuedAt: number; expiresAt: number; signature: string };
export type PrekeyPublication = { bundles: SignedPublicBundle[] };
export type PrekeyStatus = { stored: number; unpublished: number; pending: string | null };
export type PeerPin = { historyExhausted: boolean; current: PeerKeys; pending: PeerKeys | null; observed: PeerKeys[]; verified: boolean; revision: number };
export type DurableHistory = { operation: string; conversation: string; audience: string; sender: PeerKeys; plaintext: string; archival: boolean };
export type DurableEnvelope = { version: 1; operation: string; conversation: string; audience: string; sender: PeerKeys;
  recipients: { peer: string; keys: PeerKeys; message: Ciphertext }[] };
const codes = new Set(['INVALID_INPUT', 'INPUT_TOO_LARGE', 'CAPACITY', 'CRYPTO_REJECTED', 'INVALID_PLAINTEXT',
  'PREKEY_EXHAUSTED', 'PREKEY_CAPACITY', 'PREKEY_REUSED', 'PUBLICATION_PENDING', 'SIGNATURE_REJECTED', 'BUNDLE_VERSION', 'BUNDLE_EXPIRED', 'UNKNOWN_PEER', 'IDENTITY_CHANGED', 'SESSION_EXISTS', 'NO_SESSION', 'OPERATION_CONFLICT',
  'UNKNOWN_OPERATION', 'REPLAY', 'CONTEXT_MISMATCH', 'STATE_INVALID', 'STATE_VERSION', 'STATE_UNAVAILABLE',
  'ALREADY_EXISTS', 'NOT_INITIALIZED', 'COMMIT_FAILED', 'COMMIT_UNKNOWN', 'UNSUPPORTED_PLATFORM', 'UNAVAILABLE']);
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
    confirmPublication: (operation: string) => call<null>(namespace, { op: 'confirmPublication', operation }),
    prekeyStatus: () => call<PrekeyStatus>(namespace, { op: 'prekeyStatus' }),
    observePeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'observePeer', peer, keys }),
    acknowledgePeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'acknowledgePeer', peer, keys }),
    verifyPeer: (peer: string, keys: PeerKeys) => call<PeerPin>(namespace, { op: 'verifyPeer', peer, keys }),
    peer: (peer: string) => call<PeerPin>(namespace, { op: 'peer', peer }),
    outbound: (peer: string, bundle: SignedPublicBundle) => call<null>(namespace, { op: 'outbound', peer, bundle }),
    send: (input: { operation: string; conversation: string; audience: string; recipients: string[]; plaintext: string }) =>
      call<string>(namespace, { op: 'send', ...input }),
    retry: (operation: string) => call<string>(namespace, { op: 'retry', operation }),
    receive: (input: { peer: string; operation: string; conversation: string; audience: string; message: Ciphertext }) =>
      call<DurableHistory>(namespace, { op: 'receive', ...input }),
    history: () => call<DurableHistory[]>(namespace, { op: 'history' }),
    exportHistory: () => call<DurableHistory[]>(namespace, { op: 'exportHistory' }),
    importHistory: (records: DurableHistory[]) => call<null>(namespace, { op: 'importHistory', records }),
  };
}
