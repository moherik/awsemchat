import type { Session } from '../features/auth/api.ts';
import { guardAccountOperation } from './account-encryption.ts';
import type { PrekeyPublication, PrekeyStatus, SignedRegistration, SignedPublicBundle } from './durable-encryption';

const codes = new Set(['INVALID_INPUT', 'BUNDLE_EXPIRED', 'PUBLICATION_CONFLICT', 'SESSION_REVOKED', 'UNAVAILABLE', 'DENIED', 'KEYS_EXHAUSTED']);
export type KeyAllocationRequest = { operationId: string; targetId: string; circleId?: string; epoch?: number };
export type KeyAllocation = { generation: number; bundle: SignedPublicBundle };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
function parseAllocation(value: unknown): KeyAllocation {
  if (!value || typeof value !== 'object') throw new KeyPublicationError('INVALID_RESPONSE');
  const v = value as Record<string, unknown>;
  if (typeof v.generation !== 'number' || !Number.isSafeInteger(v.generation) || v.generation < 1 || !v.bundle || typeof v.bundle !== 'object') throw new KeyPublicationError('INVALID_RESPONSE');
  const b = v.bundle as Record<string, unknown>;
  const base64 = (v: unknown, length: number): v is string => typeof v === 'string' && v.length === length && /^[A-Za-z0-9+/]+$/.test(v);
  if (b.version !== 1 || b.context !== 'awsemchat.olm.signed-prekey' || !identifier(b.publication) ||
    !base64(b.keyId, 11) || !base64(b.identity, 43) || !base64(b.signingIdentity, 43) || !base64(b.prekey, 43) || !base64(b.signature, 86) ||
    typeof b.issuedAt !== 'number' || !Number.isSafeInteger(b.issuedAt) || b.issuedAt < 0 || typeof b.expiresAt !== 'number' ||
    !Number.isSafeInteger(b.expiresAt) || b.expiresAt - b.issuedAt !== 604800) throw new KeyPublicationError('INVALID_RESPONSE');
  return { generation: v.generation, bundle: { version: 1, context: 'awsemchat.olm.signed-prekey', publication: b.publication, keyId: b.keyId,
    identity: b.identity, signingIdentity: b.signingIdentity, prekey: b.prekey, issuedAt: b.issuedAt, expiresAt: b.expiresAt, signature: b.signature } };
}
export class KeyPublicationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'KeyPublicationError'; }
}
export function createKeyAPI(origin: string, session: () => Session, development = false) {
  let url: URL;
  try { url = new URL(origin); } catch { throw new KeyPublicationError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new KeyPublicationError('CONFIGURATION');
  async function request(path: string, body: object, empty: boolean): Promise<unknown> {
    const before = session();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${url.origin}${path}`, {
        method: 'POST', headers: { Authorization: `Bearer ${before.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body), redirect: 'error', signal: controller.signal,
      });
      const text = await response.text(), after = session();
      if (before.account.id !== after.account.id || before.deviceId !== after.deviceId || before.generation !== after.generation || before.accessToken !== after.accessToken) throw new KeyPublicationError('SESSION_CHANGED');
      if (response.ok) {
        if (empty) {
          if (response.status !== 204 || text !== '') throw new KeyPublicationError('INVALID_RESPONSE');
          return;
        }
        if (response.status !== 200 || text.length > 8192) throw new KeyPublicationError('INVALID_RESPONSE');
        try { return JSON.parse(text); } catch { throw new KeyPublicationError('INVALID_RESPONSE'); }
      }
      let code = 'UNAVAILABLE';
      if (text.length <= 4096) {
        try { const value = JSON.parse(text); if (value && typeof value.code === 'string' && codes.has(value.code)) code = value.code; } catch {}
      }
      throw new KeyPublicationError(code);
    } catch (error) {
      if (error instanceof KeyPublicationError) throw error;
      if (error instanceof Error && 'code' in error && error.code === 'SESSION_REVOKED') throw new KeyPublicationError('SESSION_REVOKED');
      throw new KeyPublicationError('NETWORK');
    } finally { clearTimeout(timeout); }
  }
  return {
    async publish(registration: SignedRegistration): Promise<void> {
      await request('/v1/keys/publications', { bundles: registration.bundles, proof: registration.proof }, true);
    },
    async allocate(input: KeyAllocationRequest): Promise<KeyAllocation> {
      if (!identifier(input.operationId) || !identifier(input.targetId) || (input.circleId === undefined ? input.epoch !== undefined :
        !identifier(input.circleId) || !Number.isSafeInteger(input.epoch) || (input.epoch ?? 0) < 1)) throw new KeyPublicationError('INVALID_INPUT');
      return parseAllocation(await request('/v1/keys/allocations', { operationId: input.operationId, targetId: input.targetId,
        ...(input.circleId === undefined ? {} : { circleId: input.circleId, epoch: input.epoch }) }, false));
    },
  };
}

type PublicationCrypto = {
  prekeyStatus(): Promise<PrekeyStatus>;
  preparePublication(operation: string): Promise<PrekeyPublication>;
  signPublication(operation: string): Promise<SignedRegistration>;
  confirmPublication(operation: string): Promise<unknown>;
};
export async function publishAccountKeys(session: () => Session, crypto: PublicationCrypto,
  upload: (registration: SignedRegistration) => Promise<void>, operationID: () => string): Promise<void> {
  const active = session();
  const bound = { account: { ...active.account }, deviceId: active.deviceId, generation: active.generation };
  const guarded = <T>(work: () => Promise<T>) => guardAccountOperation(session, bound, work);
  const status = await guarded(() => crypto.prekeyStatus());
  if (status.pending === null && status.stored === 20 && status.unpublished === 0) return;
  const operation = status.pending ?? operationID();
  await guarded(() => crypto.preparePublication(operation));
  const registration = await guarded(() => crypto.signPublication(operation));
  await guarded(() => upload(registration));
  await guarded(() => crypto.confirmPublication(operation));
}
