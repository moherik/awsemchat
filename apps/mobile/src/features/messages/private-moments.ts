import { validateMediaDescriptor, type MediaDescriptor } from '../media/encrypted-media.ts';
import type { HistorySnapshot } from './history-store';
import { decodeCircleMoment } from './circle-moments.ts';
import { decodeCircleMomentReaction } from './circle-moment-reactions.ts';
import { decodeCircleMomentDeletion } from './circle-moment-deletion.ts';
import { decodeCircleMomentReply } from './circle-moment-reply.ts';
import { decodeCirclePhotoMessage } from './circle-photo-message.ts';
import { decodeCircleStickerMessage } from './circle-sticker-message.ts';
import { decodePrivatePhotoMessage } from './private-photo-message.ts';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const emojis = Object.freeze(['❤️', '😂', '😮', '😢', '👍', '🎉'] as const);
export type PrivateMomentEmoji = typeof emojis[number];
export type PrivateMoment = Readonly<{ version: 1; type: 'private-moment'; id: string; audience: string; caption: string; media?: MediaDescriptor }>;
export type PrivateMomentReply = Readonly<{ version: 1; type: 'private-moment-reply'; id: string; audience: string; text: string; moment: Readonly<{ id: string; audience: string; caption: string; media?: MediaDescriptor }> }>;
export type PrivateMomentEntry = Readonly<{ id: string; messageId: string; operation: string; own: boolean; author: string; audience: string; caption: string; media?: MediaDescriptor; sequence?: number; createdAt?: number; status?: 'queued' | 'sent' | 'delivered' }>;
export type PrivateMomentReaction = Readonly<{ emoji: PrivateMomentEmoji; count: number; reactedByMe: boolean }>;
function fail(): never { throw new Error('INVALID_PRIVATE_MOMENT'); }
function validAudience(value: unknown): value is string { return typeof value === 'string' && /^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value); }
function text(value: unknown, limit: number, allowBlank: boolean) { return typeof value === 'string' && [...value].length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(value) && (allowBlank || !!value.trim()); }
function parseMoment(value: unknown): PrivateMoment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== (raw.media === undefined ? 'audience,caption,id,type,version' : 'audience,caption,id,media,type,version') || raw.version !== 1 || raw.type !== 'private-moment' || typeof raw.id !== 'string' || !idPattern.test(raw.id) || !validAudience(raw.audience) || !text(raw.caption, 280, true) || (!(raw.caption as string).trim() && raw.media === undefined)) return fail();
  let media: MediaDescriptor | undefined;
  if (raw.media !== undefined) { try { media = validateMediaDescriptor(raw.media as MediaDescriptor); } catch { return fail(); } }
  return Object.freeze({ version: 1, type: 'private-moment', id: raw.id, audience: raw.audience, caption: (raw.caption as string).trim(), ...(media ? { media } : {}) });
}
export function encodePrivateMoment(value: { id: string; audience: string; caption: string; media?: MediaDescriptor }) { return JSON.stringify(parseMoment({ version: 1, type: 'private-moment', ...value })); }
export function decodePrivateMoment(value: string): PrivateMoment | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;
  try { const raw: unknown = JSON.parse(value); if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as Record<string, unknown>).type !== 'private-moment') return undefined; return parseMoment(raw); } catch { return undefined; }
}

export function encodePrivateMomentReaction(value: { id: string; audience: string; momentId: string; emoji: PrivateMomentEmoji; active: boolean }) {
  if (!idPattern.test(value.id) || !validAudience(value.audience) || !idPattern.test(value.momentId) || !emojis.includes(value.emoji) || typeof value.active !== 'boolean') return fail();
  return JSON.stringify({ version: 1, type: 'private-moment-reaction', ...value });
}
export function decodePrivateMomentReaction(value: string): (ReturnType<typeof encodePrivateMomentReaction> extends string ? { version: 1; type: 'private-moment-reaction'; id: string; audience: string; momentId: string; emoji: PrivateMomentEmoji; active: boolean } : never) | undefined {
  if (typeof value !== 'string' || value.length > 1024) return undefined;
  try { const raw: unknown = JSON.parse(value); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined; const x = raw as Record<string, unknown>;
    if (Object.keys(x).sort().join(',') !== 'active,audience,emoji,id,momentId,type,version' || x.version !== 1 || x.type !== 'private-moment-reaction' || typeof x.id !== 'string' || !idPattern.test(x.id) || !validAudience(x.audience) || typeof x.momentId !== 'string' || !idPattern.test(x.momentId) || typeof x.emoji !== 'string' || !emojis.includes(x.emoji as PrivateMomentEmoji) || typeof x.active !== 'boolean') return undefined;
    return Object.freeze(x as never);
  } catch { return undefined; }
}

export function encodePrivateMomentReply(value: { id: string; audience: string; text: string; moment: { id: string; audience: string; caption: string; media?: MediaDescriptor } }) {
  const moment = value.moment;
  if (!idPattern.test(value.id) || !validAudience(value.audience) || !text(value.text, 8000, false) || !moment || moment.audience !== value.audience || !idPattern.test(moment.id) || !text(moment.caption, 280, true)) return fail();
  let media: MediaDescriptor | undefined; if (moment.media !== undefined) { try { media = validateMediaDescriptor(moment.media); } catch { return fail(); } }
  const body = JSON.stringify({ version: 1, type: 'private-moment-reply', id: value.id, audience: value.audience, text: value.text, moment: { id: moment.id, audience: value.audience, caption: moment.caption, ...(media ? { media } : {}) } });
  if (new TextEncoder().encode(body).length > 32 * 1024) return fail(); return body;
}
export function decodePrivateMomentReply(value: string): PrivateMomentReply | undefined {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > 32 * 1024) return undefined;
  try { const raw: unknown = JSON.parse(value); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined; const x = raw as Record<string, unknown>, m = x.moment as Record<string, unknown>;
    if (Object.keys(x).sort().join(',') !== 'audience,id,moment,text,type,version' || x.version !== 1 || x.type !== 'private-moment-reply' || typeof x.id !== 'string' || !idPattern.test(x.id) || !validAudience(x.audience) || !text(x.text, 8000, false) || !m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).sort().join(',') !== (m.media === undefined ? 'audience,caption,id' : 'audience,caption,id,media') || m.audience !== x.audience || typeof m.id !== 'string' || !idPattern.test(m.id) || !text(m.caption, 280, true)) return undefined;
    let media: MediaDescriptor | undefined; if (m.media !== undefined) media = validateMediaDescriptor(m.media as MediaDescriptor);
    return Object.freeze({ version: 1, type: 'private-moment-reply', id: x.id as string, audience: x.audience as string, text: x.text as string, moment: Object.freeze({ id: m.id as string, audience: x.audience as string, caption: m.caption as string, ...(media ? { media } : {}) }) });
  } catch { return undefined; }
}

export function encodePrivateMomentDeletion(value: { id: string; audience: string; momentId: string }) {
  if (!idPattern.test(value.id) || !validAudience(value.audience) || !idPattern.test(value.momentId)) return fail();
  return JSON.stringify({ version: 1, type: 'private-moment-deletion', ...value });
}
export function decodePrivateMomentDeletion(value: string): { version: 1; type: 'private-moment-deletion'; id: string; audience: string; momentId: string } | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  try { const raw: unknown = JSON.parse(value); if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined; const x = raw as Record<string, unknown>;
    if (Object.keys(x).sort().join(',') !== 'audience,id,momentId,type,version' || x.version !== 1 || x.type !== 'private-moment-deletion' || typeof x.id !== 'string' || !idPattern.test(x.id) || !validAudience(x.audience) || typeof x.momentId !== 'string' || !idPattern.test(x.momentId)) return undefined;
    return Object.freeze(x as never);
  } catch { return undefined; }
}

function recordAudience(record: { conversation: string; audience: string }, conversation: string, audience: string) { return record.conversation === conversation && record.audience === audience; }
export function selectPrivateMoments(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, conversation: string, audience: string): readonly PrivateMomentEntry[] {
  if (!/^private:[a-f0-9]{64}$/.test(conversation) || !validAudience(audience)) throw new Error('INVALID_PRIVATE_CONTEXT');
  const entries = new Map<string, PrivateMomentEntry>(), ids = new Set<string>();
  for (const record of history.incoming) {
    if (!recordAudience(record, conversation, audience)) continue;
    const own = record.direction === 'outgoing', identity = own ? 'self' : record.sender.identity, moment = decodePrivateMoment(record.plaintext);
    if (!moment || moment.audience !== audience || moment.id !== record.operation) continue;
    const key = `${identity}:${record.operation}`, entry: PrivateMomentEntry = Object.freeze({ id: moment.id, messageId: key, operation: record.operation, own, author: identity, audience, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}), ...(record.sequence === undefined ? {} : { sequence: record.sequence }), ...(record.createdAt === undefined ? {} : { createdAt: record.createdAt * 1000 }) });
    const prior = entries.get(key);
    if (prior) { if (prior.id !== entry.id || prior.caption !== entry.caption || JSON.stringify(prior.media) !== JSON.stringify(entry.media)) return Object.freeze([]); continue; }
    if (ids.has(moment.id)) return Object.freeze([]); ids.add(moment.id); entries.set(key, entry);
  }
  for (const record of history.outgoing) {
    if (!recordAudience(record, conversation, audience)) continue;
    const moment = decodePrivateMoment(record.plaintext); if (!moment || moment.audience !== audience || moment.id !== record.operation) continue;
    const key = `self:${record.operation}`, prior = entries.get(key);
    if (prior) { if (prior.id !== moment.id || prior.caption !== moment.caption || JSON.stringify(prior.media) !== JSON.stringify(moment.media)) return Object.freeze([]); entries.set(key, Object.freeze({ ...prior, status: record.status })); continue; }
    if (ids.has(moment.id)) return Object.freeze([]); ids.add(moment.id); entries.set(key, Object.freeze({ id: moment.id, messageId: key, operation: record.operation, own: true, author: 'self', audience, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}), ...(record.sequence == null ? {} : { sequence: record.sequence }), ...(record.createdAt == null ? {} : { createdAt: record.createdAt * 1000 }), status: record.status }));
  }
  const authors = new Map([...entries.values()].map(entry => [`${entry.audience}:${entry.id}`, entry.author]));
  const deleted = new Set<string>();
  for (const record of [...history.incoming, ...history.outgoing]) {
    if (!recordAudience(record, conversation, audience)) continue;
    const deletion = decodePrivateMomentDeletion(record.plaintext); if (!deletion || deletion.audience !== audience || deletion.id !== record.operation) continue;
    const identity = 'status' in record ? 'self' : record.direction === 'outgoing' ? 'self' : record.sender?.identity;
    if (identity && authors.get(`${audience}:${deletion.momentId}`) === identity) deleted.add(`${identity}:${deletion.momentId}`);
  }
  return Object.freeze([...entries.values()].filter(entry => !deleted.has(`${entry.author}:${entry.id}`)).sort((a,b)=>(a.sequence??Number.MAX_SAFE_INTEGER)-(b.sequence??Number.MAX_SAFE_INTEGER)||(a.createdAt??0)-(b.createdAt??0)));
}
export function selectPrivateMomentReactions(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, conversation: string, audience: string, moment: Pick<PrivateMomentEntry, 'id' | 'audience'>): readonly PrivateMomentReaction[] {
  if (!validAudience(audience) || moment.audience !== audience || !idPattern.test(moment.id)) throw new Error('INVALID_PRIVATE_CONTEXT');
  const latest = new Map<string, { emoji: PrivateMomentEmoji; active: boolean; order: number; operation: string }>();
  for (const record of [...history.incoming, ...history.outgoing]) {
    if (!recordAudience(record, conversation, audience)) continue;
    const reaction = decodePrivateMomentReaction(record.plaintext); if (!reaction || reaction.audience !== audience || reaction.momentId !== moment.id || reaction.id !== record.operation) continue;
    const own = 'status' in record, identity = own ? 'self' : record.sender?.identity; if (!identity) continue;
    const order = record.sequence ?? (record.createdAt == null ? 0 : record.createdAt), prior = latest.get(identity);
    if (prior && (order < prior.order || order === prior.order && reaction.id <= prior.operation)) continue;
    latest.set(identity, { emoji: reaction.emoji, active: reaction.active, order, operation: reaction.id });
  }
  const counts = new Map<PrivateMomentEmoji, { count: number; reactedByMe: boolean }>();
  for (const [identity, reaction] of latest) if (reaction.active) { const current = counts.get(reaction.emoji) ?? { count: 0, reactedByMe: false }; current.count++; if (identity === 'self') current.reactedByMe = true; counts.set(reaction.emoji, current); }
  return Object.freeze([...counts].map(([emoji, value]) => Object.freeze({ emoji, ...value })).sort((a,b)=>emojis.indexOf(a.emoji)-emojis.indexOf(b.emoji)));
}

type PrivateContext = { conversation: string; audience: string; recipients: readonly { accountId: string }[] };
type PrivatePorts = { account(): string; operation(): string; context(input: { targetId: string }): Promise<PrivateContext>; history(): Promise<Pick<HistorySnapshot, 'incoming' | 'outgoing'>>; send(draft: { targetId: string; operation: string; plaintext: string }): Promise<unknown> };
export function createPrivateMomentPublisher(ports: PrivatePorts, peerId: string) {
  if (!idPattern.test(peerId)) throw new Error('INVALID_INPUT'); const binding = ports.account(); let tail: Promise<unknown> = Promise.resolve();
  function check() { if (ports.account() !== binding) throw new Error('SESSION_CHANGED'); }
  async function checked<T>(work: () => Promise<T>) { check(); const result = await work(); check(); return result; }
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(async () => { check(); return work(); }); tail = result.catch(() => {}); return result; }
  async function current() {
    const value = await checked(() => ports.context({ targetId: peerId }));
    if (!/^private:[a-f0-9]{64}$/.test(value.conversation) || !validAudience(value.audience) || value.recipients.length !== 1 || value.recipients[0].accountId !== peerId) throw new Error('CONTEXT_MISMATCH');
    return value;
  }
  async function pending() {
    const context = await current(), snapshot = await checked(ports.history);
    const queued = snapshot.outgoing.filter(record => record.conversation === context.conversation && record.audience === context.audience && record.target === peerId && record.status === 'queued' && record.event === null && decodePrivateMoment(record.plaintext));
    if (queued.length > 1) throw new Error('MOMENT_PENDING_INVALID');
    const record = queued[0]; if (!record) return undefined;
    const moment = decodePrivateMoment(record.plaintext); if (!moment || moment.id !== record.operation || moment.audience !== context.audience) throw new Error('MOMENT_PENDING_INVALID');
    return Object.freeze({ operation: record.operation, plaintext: record.plaintext, moment });
  }
  async function post(caption: string, media?: MediaDescriptor, requestedOperation?: string) {
    if (await pending()) throw new Error('MOMENT_PENDING');
    const context = await current(), operation = requestedOperation ?? ports.operation(), plaintext = encodePrivateMoment({ id: operation, audience: context.audience, caption, ...(media ? { media } : {}) });
    return checked(() => ports.send({ targetId: peerId, operation, plaintext }));
  }
  async function promote(sourceOperation: string) {
    const context = await current(), snapshot = await checked(ports.history);
    const source = snapshot.outgoing.filter(record => record.operation === sourceOperation && record.conversation === context.conversation && record.audience === context.audience && record.target === peerId && record.circle === null && (record.status === 'sent' || record.status === 'delivered') && !!record.event);
    if (source.length !== 1) throw new Error('MOMENT_SOURCE_INVALID');
    const plaintext = source[0].plaintext, photo = decodePrivatePhotoMessage(plaintext);
    if (photo ? photo.id !== sourceOperation || photo.audience !== context.audience : !text(plaintext, 280, false) || decodePrivateMoment(plaintext) || decodePrivateMomentReaction(plaintext) || decodePrivateMomentReply(plaintext) || decodePrivateMomentDeletion(plaintext) || decodeCircleMoment(plaintext) || decodeCircleMomentReaction(plaintext) || decodeCircleMomentReply(plaintext) || decodeCircleMomentDeletion(plaintext) || decodeCircleStickerMessage(plaintext) || decodeCirclePhotoMessage(plaintext)) throw new Error('MOMENT_SOURCE_INVALID');
    const operation = ports.operation(), body = photo ? encodePrivateMoment({ id: operation, audience: context.audience, caption: photo.caption, media: photo.media }) : encodePrivateMoment({ id: operation, audience: context.audience, caption: plaintext.trim() });
    return checked(() => ports.send({ targetId: peerId, operation, plaintext: body }));
  }
  async function accessible(momentId: string) {
    const context = await current(), snapshot = await checked(ports.history), moment = selectPrivateMoments(snapshot, context.conversation, context.audience).find(entry => entry.id === momentId);
    if (!moment) throw new Error('MOMENT_NOT_ACCESSIBLE'); return { context, snapshot, moment };
  }
  return {
    post: (caption: string, media?: MediaDescriptor, operation?: string) => serial(() => post(caption, media, operation)),
    promote: (operation: string) => serial(() => promote(operation)),
    react: (momentId: string, emoji: PrivateMomentEmoji) => serial(async () => { const { context, snapshot, moment } = await accessible(momentId), currentReactions = selectPrivateMomentReactions(snapshot, context.conversation, context.audience, moment), mine = currentReactions.find(item => item.reactedByMe && item.emoji === emoji), operation = ports.operation(); return checked(() => ports.send({ targetId: peerId, operation, plaintext: encodePrivateMomentReaction({ id: operation, audience: context.audience, momentId, emoji, active: !mine }) })); }),
    reply: (momentId: string, value: string) => serial(async () => { const { context, moment } = await accessible(momentId), operation = ports.operation(); return checked(() => ports.send({ targetId: peerId, operation, plaintext: encodePrivateMomentReply({ id: operation, audience: context.audience, text: value, moment: { id: moment.id, audience: moment.audience, caption: moment.caption, ...(moment.media ? { media: moment.media } : {}) } }) })); }),
    remove: (momentId: string) => serial(async () => { const { context, moment } = await accessible(momentId); if (!moment.own) throw new Error('MOMENT_NOT_ACCESSIBLE'); const operation = ports.operation(); return checked(() => ports.send({ targetId: peerId, operation, plaintext: encodePrivateMomentDeletion({ id: operation, audience: context.audience, momentId }) })); }),
    pending: () => serial(pending),
    retry: () => serial(async () => { await current(); const value = await pending(); if (!value) throw new Error('NO_PENDING_MOMENT'); return checked(() => ports.send({ targetId: peerId, operation: value.operation, plaintext: value.plaintext })); }),
  };
}
