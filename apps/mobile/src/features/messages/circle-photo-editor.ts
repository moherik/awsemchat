import type { CircleAvatar } from '../social/circle-profile';
import type { createCircleMediaUpload } from '../media/upload';
import type { ConversationContext, SentEvent } from './api';
import type { MessageDraft } from './send';
import { encodeCirclePhotoMessage } from './circle-photo-message.ts';

type Upload = ReturnType<typeof createCircleMediaUpload>;
type Ports = {
  account(): string;
  operation(): string;
  context(input: { circleId: string }): Promise<ConversationContext>;
  upload: Upload;
  send(draft: MessageDraft): Promise<SentEvent>;
};
function fail(code: string): never { throw new Error(code); }

export function createCirclePhotoEditor(ports: Ports, circleId: string) {
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
    const intent = job.chatImageIntent;
    if (!intent) fail('CHAT_PHOTO_MISSING');
    return { operation: intent.operation, expectedEpoch: job.epoch, plaintext: encodeCirclePhotoMessage({ id: intent.operation, caption: intent.caption, image: { epoch: job.epoch, media: job.prepared.descriptor } }) };
  }
  async function sendJob(job: NonNullable<Awaited<ReturnType<Upload['pending']>>>) {
    if (!job.chatImageIntent) fail('CHAT_PHOTO_MISSING');
    const descriptor = await ports.upload.upload(); check();
    if (JSON.stringify(descriptor) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    const draft = message(job);
    const result = await ports.send({ circleId, ...draft }); check();
    await ports.upload.acknowledge(); check(); return result;
  }
  async function pending() {
    const job = await ports.upload.pending(); check();
    if (!job) return undefined;
    if (!job.chatImageIntent) fail('MEDIA_PENDING');
    return Object.freeze({ operation: job.chatImageIntent.operation, caption: job.chatImageIntent.caption, epoch: job.epoch, phase: job.phase, image: Object.freeze({ epoch: job.epoch, media: job.prepared.descriptor }) satisfies CircleAvatar });
  }
  return {
    pending: () => serial(pending),
    sendPhoto(input: { bytes: Uint8Array; mimeType: string; caption: string }) {
      const bytes = input.bytes.slice(), caption = input.caption;
      return serial(async () => {
        if (await ports.upload.pending()) fail('MEDIA_PENDING');
        if (typeof caption !== 'string' || [...caption].length > 280) fail('INVALID_CIRCLE_PHOTO_MESSAGE');
        const epoch = await currentEpoch(), operation = ports.operation();
        await ports.upload.prepare({ bytes, mimeType: input.mimeType }, epoch, undefined, undefined, undefined, { operation, caption }); check();
        const job = await ports.upload.pending(); if (!job) fail('CHAT_PHOTO_MISSING');
        const result = await sendJob(job); check(); return result;
      });
    },
    retry() {
      return serial(async () => {
        const job = await ports.upload.pending(); check();
        if (!job?.chatImageIntent) fail('NO_PENDING_CHAT_PHOTO');
        return sendJob(job);
      });
    },
    discard() {
      return serial(async () => {
        const job = await ports.upload.pending(); check();
        if (!job?.chatImageIntent) fail('NO_PENDING_CHAT_PHOTO');
        const result = await ports.upload.cancel(); check();
        if (result.state === 'committed') await sendJob(job);
        return result;
      });
    },
  };
}
