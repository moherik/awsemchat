import type { createCircleMediaUpload, ChatStickerUploadIntent } from '../media/upload';
import type { ConversationContext, SentEvent } from './api';
import type { MessageDraft } from './send';
import { decodeEditedPhotoDataUri } from './circle-photo-data.ts';
import { encodePersonalCircleStickerMessage } from './circle-sticker-message.ts';

type Upload = ReturnType<typeof createCircleMediaUpload>;
type Ports = {
  account(): string;
  operation(): string;
  context(input: { circleId: string }): Promise<ConversationContext>;
  upload: Upload;
  send(draft: MessageDraft): Promise<SentEvent>;
};
function fail(code: string): never { throw new Error(code); }

export function createCircleStickerMessageSender(ports: Ports, circleId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') fail('INVALID_INPUT');
  const binding = ports.account();
  let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => { check(); const value = await work(); check(); return value; });
    tail = result.catch(() => {}); return result;
  }
  async function currentEpoch() {
    const value = await ports.context({ circleId }); check();
    if (value.circleId !== circleId || value.conversation !== circleId || !Number.isSafeInteger(value.epoch) || value.epoch! < 1 || value.audience !== `circle:${value.epoch}` || value.recipients.length < 1 || value.recipients.length > 19) fail('CONTEXT_MISMATCH');
    return value.epoch!;
  }
  function message(job: NonNullable<Awaited<ReturnType<Upload['pending']>>>) {
    const intent = job.chatStickerIntent;
    if (!intent) fail('CHAT_STICKER_MISSING');
    return { operation: intent.operation, expectedEpoch: job.epoch, plaintext: encodePersonalCircleStickerMessage({ id: intent.item, label: intent.label, image: { epoch: job.epoch, media: job.prepared.descriptor } }) };
  }
  async function sendJob(job: NonNullable<Awaited<ReturnType<Upload['pending']>>>) {
    if (!job.chatStickerIntent) fail('CHAT_STICKER_MISSING');
    const descriptor = await ports.upload.upload(); check();
    if (JSON.stringify(descriptor) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    const result = await ports.send({ circleId, ...message(job) }); check();
    await ports.upload.acknowledge(); check();
    return result;
  }
  async function pending() {
    const job = await ports.upload.pending(); check();
    if (!job) return undefined;
    if (!job.chatStickerIntent) fail('MEDIA_PENDING');
    return Object.freeze({ operation: job.chatStickerIntent.operation, item: job.chatStickerIntent.item, label: job.chatStickerIntent.label, epoch: job.epoch, phase: job.phase });
  }
  return {
    pending: () => serial(pending),
    sendSticker(input: { image: string; label: string }) {
      const decoded = typeof input?.image === 'string' ? decodeEditedPhotoDataUri(input.image) : undefined;
      const label = typeof input?.label === 'string' ? input.label.trim() : '';
      if (!decoded || !label || [...label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(label)) return Promise.reject(new Error('INVALID_CIRCLE_STICKER'));
      const bytes = decoded.bytes.slice(), mimeType = decoded.mimeType;
      return serial(async () => {
        if (await ports.upload.pending()) fail('MEDIA_PENDING');
        const epoch = await currentEpoch(), operation = ports.operation();
        const intent: ChatStickerUploadIntent = { operation, item: operation, label };
        await ports.upload.prepare({ bytes, mimeType }, epoch, undefined, undefined, undefined, undefined, intent); check();
        const job = await ports.upload.pending(); if (!job) fail('CHAT_STICKER_MISSING');
        return sendJob(job);
      });
    },
    retry() {
      return serial(async () => {
        const job = await ports.upload.pending(); check();
        if (!job?.chatStickerIntent) fail('NO_PENDING_CHAT_STICKER');
        return sendJob(job);
      });
    },
    discard() {
      return serial(async () => {
        const job = await ports.upload.pending(); check();
        if (!job?.chatStickerIntent) fail('NO_PENDING_CHAT_STICKER');
        const result = await ports.upload.cancel(); check();
        if (result.state === 'committed') await sendJob(job);
        return result;
      });
    },
  };
}
