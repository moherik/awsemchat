import type { CircleAvatar } from '../social/circle-profile';
import type { createCircleMediaUpload } from '../media/upload';
import type { createCircleMomentPublisher } from './circle-moment-publisher';

type Publisher = ReturnType<typeof createCircleMomentPublisher>;
type Upload = ReturnType<typeof createCircleMediaUpload>;
type Ports = { account(): string; operation(): string; context(input: { circleId: string }): Promise<{ circleId?: string; conversation: string; audience: string; epoch?: number; recipients: readonly unknown[] }>; upload: Upload; publisher: Publisher };
function fail(code: string): never { throw new Error(code); }

export function createCircleMomentEditor(ports: Ports, circleId: string) {
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
  async function finishUpload(job: Awaited<ReturnType<Upload['pending']>>) {
    if (!job?.momentIntent) fail('MOMENT_MEDIA_MISSING');
    const media = await ports.upload.upload(); check();
    if (JSON.stringify(media) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
    return { caption: job.momentIntent.caption, operation: job.momentIntent.operation, media: { epoch: job.epoch, media } satisfies CircleAvatar };
  }
  async function pending() {
    const [job, message] = await Promise.all([ports.upload.pending(), ports.publisher.pending()]); check();
    if (!job) return message ? { kind: 'message' as const, caption: message.moment.caption, hasPhoto: !!message.moment.media, operation: message.operation, moment: message.moment } : undefined;
    if (!job.momentIntent) fail('MEDIA_PENDING');
    if (message && (message.operation !== job.momentIntent.operation || message.moment.caption !== job.momentIntent.caption || JSON.stringify(message.moment.media) !== JSON.stringify({ epoch: job.epoch, media: job.prepared.descriptor }))) fail('MOMENT_DRAFT_CONFLICT');
    const moment = message?.moment ?? Object.freeze({ version: 1 as const, type: 'circle-moment' as const, id: job.momentIntent.operation, caption: job.momentIntent.caption, media: { epoch: job.epoch, media: job.prepared.descriptor } });
    return { kind: 'photo' as const, caption: job.momentIntent.caption, hasPhoto: true, operation: job.momentIntent.operation, phase: job.phase, messagePending: !!message, moment };
  }
  return {
    pending: () => serial(pending),
    postPhoto(input: { caption: string; bytes: Uint8Array; mimeType: string }) {
      return serial(async () => {
        const existing = await ports.publisher.pending(); check();
        if (existing) fail('MOMENT_PENDING');
        const saved = await ports.upload.pending(); check();
        if (saved) fail('MEDIA_PENDING');
        const epoch = await currentEpoch(), operation = ports.operation();
        await ports.upload.prepare({ bytes: input.bytes, mimeType: input.mimeType }, epoch, undefined, undefined, { caption: input.caption, operation }); check();
        const job = await ports.upload.pending();
        if (!job?.momentIntent) fail('MOMENT_MEDIA_MISSING');
        const ready = await finishUpload(job);
        const result = await ports.publisher.post(ready.caption, ready.media, ready.operation); check();
        await ports.upload.acknowledge(); check(); return result;
      });
    },
    retryPhoto() {
      return serial(async () => {
        const message = await ports.publisher.pending(), job = await ports.upload.pending(); check();
        if (message && !message.moment.media) return ports.publisher.retry();
        if (!job?.momentIntent) {
          if (message) return ports.publisher.retry();
          fail('NO_PENDING_MOMENT');
        }
        if (message && (message.operation !== job.momentIntent.operation || message.moment.caption !== job.momentIntent.caption || JSON.stringify(message.moment.media) !== JSON.stringify({ epoch: job.epoch, media: job.prepared.descriptor }))) fail('MOMENT_DRAFT_CONFLICT');
        const epoch = await currentEpoch();
        if (!message && epoch !== job.epoch) fail('MOMENT_EPOCH_CHANGED');
        const ready = await finishUpload(job);
        const result = message ? await ports.publisher.retry() : await ports.publisher.post(ready.caption, ready.media, ready.operation);
        check(); await ports.upload.acknowledge(); check(); return result;
      });
    },
    discardPhoto() {
      return serial(async () => {
        const [message, job] = await Promise.all([ports.publisher.pending(), ports.upload.pending()]); check();
        if (!job?.momentIntent) fail('NO_PENDING_MOMENT');
        if (message) fail('MOMENT_PHOTO_UPLOAD_UNCERTAIN');
        const result = await ports.upload.cancel(); check();
        if (result.state === 'committed') await ports.upload.acknowledge();
        return result;
      });
    },
  };
}
