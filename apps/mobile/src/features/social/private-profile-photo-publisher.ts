import { decodePrivateProfile, encodePrivateProfile } from './private-profile.ts';
import type { PrivateProfilePhoto } from './private-profile-photo-store.ts';
import type { createEncryptedMedia, MediaDescriptor, PreparedMedia } from '../media/encrypted-media.ts';
import type { MessageDraft } from '../messages/send';
import type { SentEvent } from '../messages/api';

type Media = Pick<ReturnType<typeof createEncryptedMedia>, 'prepare' | 'restore' | 'upload'>;
type ProfileInput = Readonly<{ revision: number; name: string; status: string; photo: PrivateProfilePhoto | null; operation: string }>;
type VaultValue = Readonly<{ version: 1; binding: string; peerId: string; requestId: string; conversation: string; audience: string; operation: string; revision: number; name: string; status: string; avatar: MediaDescriptor | null; prepared?: PreparedMedia; uploadAttempted: boolean }>;
type Context = Readonly<{ conversation: string; audience: string; recipients: readonly { accountId: string }[] }>;
type Ports = {
  binding(): string;
  context(input: { targetId: string }): Promise<Context>;
  media: Media;
  vault: { read(): Promise<unknown>; write(value: VaultValue): Promise<void>; clear(): Promise<void> };
  send(draft: MessageDraft): Promise<SentEvent>;
};

function fail(code: string): never { throw new Error(code); }
function validate(value: unknown, binding: string, peerId: string, requestId: string): VaultValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('PROFILE_PHOTO_VAULT_INVALID');
  const raw = value as Record<string, unknown>;
  const hasPrepared = Object.prototype.hasOwnProperty.call(raw, 'prepared');
  const expectedKeys = ('audience,avatar,binding,conversation,name,operation,peerId,requestId,revision,status,uploadAttempted,version' + (hasPrepared ? ',prepared' : '')).split(',').sort().join(',');
  if (Object.keys(raw).sort().join(',') !== expectedKeys || raw.version !== 1 || raw.binding !== binding || raw.peerId !== peerId || raw.requestId !== requestId || typeof raw.conversation !== 'string' || !/^private:[a-f0-9]{64}$/.test(raw.conversation) || raw.audience !== `friend:${requestId}` || typeof raw.operation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(raw.operation) || !Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1 || typeof raw.name !== 'string' || typeof raw.status !== 'string' || typeof raw.uploadAttempted !== 'boolean') return fail('PROFILE_PHOTO_VAULT_INVALID');
  let avatar: MediaDescriptor | null = null;
  if (raw.avatar !== null) {
    const parsed = decodePrivateProfile(JSON.stringify({ version: 2, revision: raw.revision, name: raw.name, status: raw.status, avatar: raw.avatar }));
    if (!parsed || parsed.version !== 2 || !parsed.avatar) return fail('PROFILE_PHOTO_VAULT_INVALID');
    avatar = parsed.avatar;
  } else if (hasPrepared) return fail('PROFILE_PHOTO_VAULT_INVALID');
  const profile = decodePrivateProfile(encodePrivateProfile({ revision: raw.revision as number, name: raw.name, status: raw.status, avatar }));
  if (!profile || profile.version !== 2) return fail('PROFILE_PHOTO_VAULT_INVALID');
  let prepared: PreparedMedia | undefined;
  if (hasPrepared) {
    const item = raw.prepared as PreparedMedia;
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'ciphertext,descriptor' || typeof item.ciphertext !== 'string' || item.ciphertext.length < 1 || item.ciphertext.length > 8 * 1024 * 1024 || item.ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.ciphertext)) return fail('PROFILE_PHOTO_VAULT_INVALID');
    const mediaProfile = decodePrivateProfile(JSON.stringify({ version: 2, revision: raw.revision, name: raw.name, status: raw.status, avatar: item.descriptor }));
    if (!mediaProfile || mediaProfile.version !== 2 || JSON.stringify(mediaProfile.avatar) !== JSON.stringify(avatar)) return fail('PROFILE_PHOTO_VAULT_INVALID');
    prepared = Object.freeze({ descriptor: mediaProfile.avatar!, ciphertext: item.ciphertext });
  }
  if ((avatar === null) === hasPrepared) return fail('PROFILE_PHOTO_VAULT_INVALID');
  return Object.freeze({ version: 1, binding, peerId, requestId, conversation: raw.conversation, audience: raw.audience, operation: raw.operation, revision: raw.revision as number, name: profile.name, status: profile.status, avatar, ...(prepared ? { prepared } : {}), uploadAttempted: raw.uploadAttempted as boolean });
}

export function createPrivateProfilePhotoPublisher(ports: Ports, friendship: { peerId: string; requestId: string }) {
  const { peerId, requestId } = friendship, binding = ports.binding();
  if (!binding || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) fail('INVALID_INPUT');
  let tail: Promise<unknown> = Promise.resolve();
  function check() { if (!binding || ports.binding() !== binding) fail('SESSION_CHANGED'); }
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(async () => { check(); const value = await work(); check(); return value; }); tail = result.catch(() => undefined); return result; }
  async function current(): Promise<Context> {
    const context = await ports.context({ targetId: peerId }); check();
    if (!context || context.audience !== `friend:${requestId}` || !/^private:[a-f0-9]{64}$/.test(context.conversation) || context.recipients.length !== 1 || context.recipients[0]?.accountId !== peerId) fail('CONTEXT_MISMATCH');
    return context;
  }
  async function pending(): Promise<VaultValue | undefined> { const value = await ports.vault.read(); check(); return value == null ? undefined : validate(value, binding, peerId, requestId); }
  async function save(value: VaultValue): Promise<void> { check(); await ports.vault.write(validate(value, binding, peerId, requestId)); check(); }
  async function send(job: VaultValue): Promise<SentEvent> {
    const context = await current();
    if (context.conversation !== job.conversation || context.audience !== job.audience) fail('CONTEXT_MISMATCH');
    let uploaded = job;
    if (job.prepared) {
      const prepared = await ports.media.restore(job.prepared); check();
      if (!job.uploadAttempted) { uploaded = Object.freeze({ ...job, uploadAttempted: true }); await save(uploaded); }
      const descriptor = await ports.media.upload(prepared, uploaded.operation); check();
      if (JSON.stringify(descriptor) !== JSON.stringify(uploaded.avatar)) fail('INVALID_RESPONSE');
    }
    const fresh = await current();
    if (fresh.conversation !== uploaded.conversation || fresh.audience !== uploaded.audience) fail('CONTEXT_MISMATCH');
    const plaintext = encodePrivateProfile({ revision: uploaded.revision, name: uploaded.name, status: uploaded.status, avatar: uploaded.avatar });
    const result = await ports.send({ targetId: peerId, operation: uploaded.operation, contentType: 'private-profile', plaintext }); check();
    await ports.vault.clear(); check();
    return result;
  }
  return Object.freeze({
    publish: (input: ProfileInput) => serial(async () => {
      if (!input || !Number.isSafeInteger(input.revision) || input.revision < 1) fail('INVALID_PROFILE');
      const prior = await pending();
      if (prior) {
        if (prior.revision === input.revision && prior.name === input.name && prior.status === input.status) return send(prior);
        await send(prior);
      }
      const context = await current();
      let prepared: PreparedMedia | undefined, avatar: MediaDescriptor | null = null;
      if (input.photo !== null) {
        prepared = await ports.media.prepare(input.photo); check();
        avatar = prepared.descriptor;
      }
      const job = validate({ version: 1, binding, peerId, requestId, conversation: context.conversation, audience: context.audience, operation: input.operation, revision: input.revision, name: input.name, status: input.status, avatar, ...(prepared ? { prepared } : {}), uploadAttempted: false }, binding, peerId, requestId);
      await save(job);
      return send(job);
    }),
    retry: () => serial(async () => { const job = await pending(); if (!job) fail('NO_PENDING_PROFILE_PHOTO'); return send(job); }),
  });
}
