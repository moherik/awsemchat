import type { createEncryptedMedia, PreparedMedia } from '../media/encrypted-media';
import type { SentEvent } from './api';
import type { MessageDraft } from './send';
import { encodePrivatePhotoMessage } from './private-photo-message.ts';
import { encodePrivateStickerMessage } from './private-sticker-message.ts';
import { decodeEditedPhotoDataUri } from './circle-photo-data.ts';

type Media = Pick<ReturnType<typeof createEncryptedMedia>, 'prepare' | 'restore' | 'upload' | 'cancel' | 'download'>;
type PrivateStickerIntent = Readonly<{ label: string }>;
type VaultValue = Readonly<{ version: 1; binding: string; peerId: string; conversation: string; audience: string; operation: string; caption: string; stickerIntent?: PrivateStickerIntent; prepared: PreparedMedia; uploadAttempted: boolean }>;
type Ports = { account(): string; operation(): string; context(input: { targetId: string }): Promise<{ conversation: string; audience: string; recipients: readonly { accountId: string }[] }>; media: Media; vault: { read(): Promise<unknown>; write(value: VaultValue): Promise<void>; clear(): Promise<void> }; send(draft: MessageDraft): Promise<SentEvent> };
function fail(code: string): never { throw new Error(code); }
function validate(value: unknown, binding: string, peerId: string): VaultValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('VAULT_INVALID');
  const job = value as VaultValue, descriptor = job.prepared?.descriptor;
  const keys = Object.keys(job).sort().join(',');
  const sticker = job.stickerIntent;
  const validSticker = sticker === undefined || (!!sticker && typeof sticker === 'object' && !Array.isArray(sticker) && Object.keys(sticker).join(',') === 'label' && typeof sticker.label === 'string' && !!sticker.label.trim() && sticker.label === sticker.label.trim() && [...sticker.label].length <= 80 && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(sticker.label));
  if ((keys !== 'audience,binding,caption,conversation,operation,peerId,prepared,uploadAttempted,version' && keys !== 'audience,binding,caption,conversation,operation,peerId,prepared,stickerIntent,uploadAttempted,version') ||
    job.version !== 1 || job.binding !== binding || job.peerId !== peerId || !/^private:[a-f0-9]{64}$/.test(job.conversation) || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(job.audience) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(job.operation) || typeof job.caption !== 'string' || [...job.caption].length > 280 || (sticker !== undefined && (job.caption !== '' || !validSticker)) || typeof job.uploadAttempted !== 'boolean' || !descriptor || descriptor.version !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(descriptor.id) || !/^[a-f0-9]{64}$/.test(descriptor.key) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 2 * 1024 * 1024 || !['image/jpeg','image/png','image/webp','image/gif'].includes(descriptor.mimeType) || typeof job.prepared.ciphertext !== 'string' || job.prepared.ciphertext.length < 1 || job.prepared.ciphertext.length > 8 * 1024 * 1024 || job.prepared.ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(job.prepared.ciphertext)) return fail('VAULT_INVALID');
  return Object.freeze({ ...job, ...(sticker === undefined ? {} : { stickerIntent: Object.freeze({ label: sticker.label }) }), prepared: Object.freeze({ descriptor: Object.freeze({ ...descriptor }), ciphertext: job.prepared.ciphertext }) });
}
export function createPrivatePhotoEditor(ports: Ports, peerId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId)) fail('INVALID_INPUT');
  const binding = ports.account(); let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(async () => { check(); const value = await work(); check(); return value; }); tail = result.catch(() => {}); return result; }
  async function current() { const value = await ports.context({ targetId: peerId }); check(); if (!/^private:[a-f0-9]{64}$/.test(value.conversation) || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.audience) || value.recipients.length !== 1 || value.recipients[0].accountId !== peerId) fail('CONTEXT_MISMATCH'); return value; }
  async function pending(): Promise<VaultValue | undefined> { const value = await ports.vault.read(); check(); return value === null ? undefined : validate(value, binding, peerId); }
  async function save(job: VaultValue) { check(); await ports.vault.write(validate(job, binding, peerId)); check(); }
  async function send(job: VaultValue) {
    const context = await current(); if (context.conversation !== job.conversation || context.audience !== job.audience) fail('CONTEXT_MISMATCH');
    const prepared = await ports.media.restore(job.prepared); check();
    if (!job.uploadAttempted) { job = Object.freeze({ ...job, uploadAttempted: true }); await save(job); }
    const media = await ports.media.upload(prepared, job.operation); check();
    if (JSON.stringify(media) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    const fresh = await current(); if (fresh.conversation !== job.conversation || fresh.audience !== job.audience) fail('CONTEXT_MISMATCH');
    const plaintext = job.stickerIntent
      ? encodePrivateStickerMessage({ id: job.operation, audience: job.audience, label: job.stickerIntent.label, media })
      : encodePrivatePhotoMessage({ id: job.operation, audience: job.audience, caption: job.caption, media });
    const result = await ports.send({ targetId: peerId, operation: job.operation, plaintext }); check(); await ports.vault.clear(); check(); return result;
  }
  return {
    pending: () => serial(pending),
    download: (media: import('../media/encrypted-media').MediaDescriptor) => serial(async () => { const context = await current(), bytes = await ports.media.download(media); check(); const latest = await current(); if (latest.conversation !== context.conversation || latest.audience !== context.audience) fail('CONTEXT_MISMATCH'); return bytes; }),
    sendPhoto: (input: { bytes: Uint8Array; mimeType: string; caption: string }) => serial(async () => {
      if (await pending()) fail('MEDIA_PENDING'); if (typeof input.caption !== 'string' || [...input.caption].length > 280) fail('INVALID_PRIVATE_PHOTO_MESSAGE');
      const context = await current(), operation = ports.operation(), prepared = await ports.media.prepare({ bytes: input.bytes, mimeType: input.mimeType }); check();
      const job = validate({ version: 1, binding, peerId, conversation: context.conversation, audience: context.audience, operation, caption: input.caption, prepared, uploadAttempted: false }, binding, peerId); await save(job); return send(job);
    }),
    sendSticker: (input: { image: string; label: string }) => serial(async () => {
      if (await pending()) fail('MEDIA_PENDING');
      const decoded = typeof input?.image === 'string' ? decodeEditedPhotoDataUri(input.image) : undefined;
      const label = typeof input?.label === 'string' ? input.label.trim() : '';
      if (!decoded || !label || [...label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(label)) fail('INVALID_PRIVATE_STICKER_MESSAGE');
      const context = await current(), operation = ports.operation(), prepared = await ports.media.prepare(decoded); check();
      const job = validate({ version: 1, binding, peerId, conversation: context.conversation, audience: context.audience, operation, caption: '', stickerIntent: { label }, prepared, uploadAttempted: false }, binding, peerId);
      await save(job); return send(job);
    }),
    retry: () => serial(async () => { const job = await pending(); if (!job) fail('NO_PENDING_PRIVATE_PHOTO'); return send(job); }),
    discard: () => serial(async () => { const job = await pending(); if (!job) return { state: 'cancelled' as const }; if (!job.uploadAttempted) { await ports.vault.clear(); check(); return { state: 'cancelled' as const }; } const result = await ports.media.cancel(job.operation); check(); await ports.vault.clear(); check(); return result; }),
  };
}
