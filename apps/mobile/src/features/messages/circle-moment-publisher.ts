import type { ConversationContext, SentEvent } from './api';
import type { HistorySnapshot } from './history-store';
import type { MessageDraft } from './send';
import { decodeCircleMoment, encodeCircleMoment, selectCircleMoments } from './circle-moments.ts';
import { decodeCircleMomentReaction, encodeCircleMomentReaction, selectCircleMomentReactions, type CircleMomentReactionEmoji } from './circle-moment-reactions.ts';
import { decodeCircleMomentReply, encodeCircleMomentReply } from './circle-moment-reply.ts';
import { decodeCircleMomentDeletion, encodeCircleMomentDeletion } from './circle-moment-deletion.ts';
import { decodeCircleStickerMessage } from './circle-sticker-message.ts';
import { decodeCirclePhotoMessage } from './circle-photo-message.ts';

type Ports = {
  account(): string;
  operation(): string;
  context(input: { circleId: string }): Promise<ConversationContext>;
  history(): Promise<Pick<HistorySnapshot, 'outgoing'> & Partial<Pick<HistorySnapshot, 'incoming'>>>;
  send(draft: MessageDraft): Promise<SentEvent>;
};
function fail(code: string): never { throw new Error(code); }

export function createCircleMomentPublisher(ports: Ports, circleId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') fail('INVALID_INPUT');
  const binding = ports.account();
  let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>): Promise<T> { check(); const value = await job(); check(); return value; }
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => { check(); return job(); });
    tail = result.catch(() => {});
    return result;
  }
  async function pending() {
    const history = await checked(ports.history);
    const queued = history.outgoing.filter(record => record.conversation === circleId && record.status === 'queued' && record.event === null &&
      (() => { try { return JSON.parse(record.plaintext)?.type === 'circle-moment'; } catch { return false; } })());
    if (queued.length > 1) fail('MOMENT_PENDING_INVALID');
    const record = queued[0];
    if (!record) return undefined;
    const moment = decodeCircleMoment(record.plaintext), epoch = /^circle:([1-9][0-9]*)$/.exec(record.audience)?.[1];
    if (!moment || moment.id !== record.operation || record.circle !== circleId || record.target !== null || !epoch || !Number.isSafeInteger(Number(epoch))) fail('MOMENT_PENDING_INVALID');
    return { operation: record.operation, plaintext: record.plaintext, expectedEpoch: Number(epoch), moment };
  }
  async function publish(caption: string, media?: import('../social/circle-profile').CircleAvatar, operation?: string): Promise<SentEvent> {
    if (await pending()) fail('MOMENT_PENDING');
    const context = await checked(() => ports.context({ circleId }));
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || context.recipients.length < 1 || context.recipients.length > 19) fail('CONTEXT_MISMATCH');
    if (media && media.epoch !== context.epoch) fail('CONTEXT_MISMATCH');
    const id = operation ?? ports.operation(), plaintext = encodeCircleMoment({ id, caption, ...(media ? { media } : {}) });
    return checked(() => ports.send({ circleId, expectedEpoch: context.epoch, operation: id, plaintext }));
  }
  async function react(momentId: string, emoji: CircleMomentReactionEmoji): Promise<SentEvent> {
    const context = await checked(() => ports.context({ circleId }));
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || context.recipients.length < 1 || context.recipients.length > 19) fail('CONTEXT_MISMATCH');
    const snapshot = await checked(ports.history);
    const moment = selectCircleMoments({ incoming: snapshot.incoming ?? [], outgoing: snapshot.outgoing }, circleId).find(item => item.id === momentId);
    if (!moment || moment.audience !== context.audience) fail('MOMENT_NOT_ACCESSIBLE');
    const current = selectCircleMomentReactions({ incoming: snapshot.incoming ?? [], outgoing: snapshot.outgoing }, circleId, moment).find(item => item.reactedByMe);
    const operation = ports.operation(), plaintext = encodeCircleMomentReaction({ id: operation, momentId, emoji, active: current?.emoji !== emoji });
    return checked(() => ports.send({ circleId, expectedEpoch: context.epoch, operation, plaintext }));
  }
  async function reply(momentId: string, text: string, operation: string): Promise<SentEvent> {
    const context = await checked(() => ports.context({ circleId }));
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || context.recipients.length < 1 || context.recipients.length > 19) fail('CONTEXT_MISMATCH');
    const snapshot = await checked(ports.history);
    const moment = selectCircleMoments({ incoming: snapshot.incoming ?? [], outgoing: snapshot.outgoing }, circleId).find(item => item.id === momentId);
    if (!moment || moment.audience !== context.audience) fail('MOMENT_NOT_ACCESSIBLE');
    const plaintext = encodeCircleMomentReply({ id: operation, text, moment: { id: moment.id, audience: moment.audience, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}) } });
    return checked(() => ports.send({ circleId, expectedEpoch: context.epoch, operation, plaintext }));
  }
  async function remove(momentId: string): Promise<SentEvent> {
    const context = await checked(() => ports.context({ circleId }));
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || context.recipients.length < 1 || context.recipients.length > 19) fail('CONTEXT_MISMATCH');
    const snapshot = await checked(ports.history);
    const moment = selectCircleMoments({ incoming: snapshot.incoming ?? [], outgoing: snapshot.outgoing }, circleId).find(item => item.id === momentId);
    if (!moment || !moment.own || moment.audience !== context.audience) fail('MOMENT_NOT_ACCESSIBLE');
    const operation = ports.operation(), plaintext = encodeCircleMomentDeletion({ id: operation, momentId });
    return checked(() => ports.send({ circleId, expectedEpoch: context.epoch, operation, plaintext }));
  }
  async function promote(sourceOperation: string): Promise<SentEvent> {
    const context = await checked(() => ports.context({ circleId }));
    if (context.circleId !== circleId || context.conversation !== circleId || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || context.recipients.length < 1 || context.recipients.length > 19) fail('CONTEXT_MISMATCH');
    const snapshot = await checked(ports.history);
    const source = snapshot.outgoing.find(record => record.operation === sourceOperation && record.conversation === circleId && record.circle === circleId && record.target === null);
    if (!source || source.audience !== context.audience || !['sent', 'delivered'].includes(source.status) || !source.event || (source.contentType !== undefined && source.contentType !== 'text')) fail('MOMENT_NOT_ACCESSIBLE');
    const plaintext = source.plaintext;
    const photo = decodeCirclePhotoMessage(plaintext);
    if (photo) {
      if (photo.id !== source.operation || photo.image.epoch !== context.epoch) fail('MOMENT_NOT_ACCESSIBLE');
      return checked(() => publish(photo.caption, photo.image));
    }
    if (!plaintext.trim() || decodeCircleMoment(plaintext) || decodeCircleMomentReaction(plaintext) || decodeCircleMomentDeletion(plaintext) || decodeCircleMomentReply(plaintext) || decodeCircleStickerMessage(plaintext)) fail('MOMENT_SOURCE_INVALID');
    if ([...plaintext].length > 280) fail('MOMENT_SOURCE_TOO_LONG');
    return checked(() => publish(plaintext.trim()));
  }
  return {
    post(caption: string, media?: import('../social/circle-profile').CircleAvatar, operation?: string) { return serial(() => publish(caption, media, operation)); },
    react(momentId: string, emoji: CircleMomentReactionEmoji) { return serial(() => react(momentId, emoji)); },
    reply(momentId: string, text: string, operation: string) { return serial(() => reply(momentId, text, operation)); },
    remove(momentId: string) { return serial(() => remove(momentId)); },
    promote(sourceOperation: string) { return serial(() => promote(sourceOperation)); },
    pending: () => serial(pending),
    retry() { return serial(async () => { const draft = await pending(); if (!draft) fail('NO_PENDING_MOMENT'); return checked(() => ports.send({ circleId, operation: draft.operation, plaintext: draft.plaintext, expectedEpoch: draft.expectedEpoch })); }); },
  };
}
