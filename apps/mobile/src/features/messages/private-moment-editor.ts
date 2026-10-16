import type { createEncryptedMedia, PreparedMedia } from '../media/encrypted-media';
import type { createPrivateMomentPublisher } from './private-moments';

type Media = Pick<ReturnType<typeof createEncryptedMedia>, 'prepare' | 'restore' | 'upload' | 'cancel' | 'download'>;
type Publisher = ReturnType<typeof createPrivateMomentPublisher>;
export type PrivateMomentVaultValue = Readonly<{ version: 1; binding: string; peerId: string; conversation: string; audience: string; operation: string; caption: string; prepared: PreparedMedia; uploadAttempted: boolean }>;
type Pending = PrivateMomentVaultValue;
type Ports = { account(): string; operation(): string; context(input: { targetId: string }): Promise<{ conversation: string; audience: string; recipients: readonly { accountId: string }[] }>; media: Media; vault: { read(): Promise<unknown>; write(value: Pending): Promise<void>; clear(): Promise<void> }; publisher: Publisher };
function fail(code: string): never { throw new Error(code); }
function valid(value: unknown, binding: string, peerId: string): Pending {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('VAULT_INVALID');
  const job = value as Pending, descriptor = job.prepared?.descriptor;
  if (Object.keys(job).sort().join(',') !== 'audience,binding,caption,conversation,operation,peerId,prepared,uploadAttempted,version' || job.version !== 1 || job.binding !== binding || job.peerId !== peerId || !/^private:[a-f0-9]{64}$/.test(job.conversation) || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(job.audience) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(job.operation) || typeof job.caption !== 'string' || [...job.caption].length > 280 || typeof job.uploadAttempted !== 'boolean' || !descriptor || descriptor.version !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(descriptor.id) || !/^[a-f0-9]{64}$/.test(descriptor.key) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 2 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(descriptor.mimeType) || typeof job.prepared.ciphertext !== 'string' || job.prepared.ciphertext.length < 1 || job.prepared.ciphertext.length > 8 * 1024 * 1024 || job.prepared.ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(job.prepared.ciphertext)) return fail('VAULT_INVALID');
  return Object.freeze({ ...job, prepared: Object.freeze({ descriptor: Object.freeze({ ...descriptor }), ciphertext: job.prepared.ciphertext }) });
}
export function createPrivateMomentEditor(ports: Ports, peerId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId)) fail('INVALID_INPUT');
  const binding = ports.account(); let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(async () => { check(); const value = await work(); check(); return value; }); tail = result.catch(() => {}); return result; }
  async function current() { const value = await ports.context({ targetId: peerId }); check(); if (!/^private:[a-f0-9]{64}$/.test(value.conversation) || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.audience) || value.recipients.length !== 1 || value.recipients[0].accountId !== peerId) fail('CONTEXT_MISMATCH'); return value; }
  async function pending(): Promise<Pending | undefined> { const value = await ports.vault.read(); check(); return value === null ? undefined : valid(value, binding, peerId); }
  async function save(job: Pending) { check(); await ports.vault.write(valid(job, binding, peerId)); check(); }
  async function upload(job: Pending) {
    const restored = await ports.media.restore(job.prepared); check();
    if (!job.uploadAttempted) { job = Object.freeze({ ...job, uploadAttempted: true }); await save(job); }
    const descriptor = await ports.media.upload(restored, job.operation); check();
    if (JSON.stringify(descriptor) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    return { job, descriptor };
  }
  return {
    pending: () => serial(pending),
    download: (descriptor: import('../media/encrypted-media').MediaDescriptor) => serial(async () => { const context = await current(); const bytes = await ports.media.download(descriptor); check(); const latest = await current(); if (latest.conversation !== context.conversation || latest.audience !== context.audience) fail('CONTEXT_MISMATCH'); return bytes; }),
    prepare: (input: { bytes: Uint8Array; mimeType: string; caption: string }) => serial(async () => {
      if (await pending()) fail('MEDIA_PENDING'); if (typeof input.caption !== 'string' || [...input.caption].length > 280) fail('INVALID_PRIVATE_MOMENT');
      const context = await current(), operation = ports.operation(), prepared = await ports.media.prepare({ bytes: input.bytes, mimeType: input.mimeType }); check();
      const job = valid({ version: 1, binding, peerId, conversation: context.conversation, audience: context.audience, operation, caption: input.caption, prepared, uploadAttempted: false }, binding, peerId); await save(job); return job;
    }),
    postPhoto: (input: { bytes: Uint8Array; mimeType: string; caption: string }) => serial(async () => {
      if (await pending()) fail('MEDIA_PENDING'); if (typeof input.caption !== 'string' || [...input.caption].length > 280) fail('INVALID_PRIVATE_MOMENT');
      const context = await current(), operation = ports.operation(), prepared = await ports.media.prepare({ bytes: input.bytes, mimeType: input.mimeType }); check();
      let job = valid({ version: 1, binding, peerId, conversation: context.conversation, audience: context.audience, operation, caption: input.caption, prepared, uploadAttempted: false }, binding, peerId); await save(job);
      const uploaded = await upload(job); job = uploaded.job;
      const fresh = await current(); if (fresh.conversation !== job.conversation || fresh.audience !== job.audience) fail('CONTEXT_MISMATCH');
      const result = await ports.publisher.post(job.caption, uploaded.descriptor, job.operation); check(); await ports.vault.clear(); check(); return result;
    }),
    retry: () => serial(async () => {
      const job = await pending(); if (!job) fail('NO_PENDING_MOMENT'); const context = await current();
      if (context.conversation !== job.conversation || context.audience !== job.audience) fail('CONTEXT_MISMATCH');
      const uploaded = await upload(job), queued = await ports.publisher.pending(); check();
      const result = queued?.operation === job.operation ? await ports.publisher.retry() : await ports.publisher.post(job.caption, uploaded.descriptor, job.operation);
      check(); await ports.vault.clear(); check(); return result;
    }),
    discard: () => serial(async () => {
      const job = await pending(); if (!job) return { state: 'cancelled' as const };
      if (!job.uploadAttempted) { await ports.vault.clear(); check(); return { state: 'cancelled' as const }; }
      const result = await ports.media.cancel(job.operation); check(); if (result.state === 'cancelled') { await ports.vault.clear(); check(); } else await ports.vault.clear();
      return result;
    }),
  };
}
