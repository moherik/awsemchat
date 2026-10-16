import { parseSnapshotHeader } from '../../security/snapshot-header.ts';
import { parseCollectionChange } from '../../security/collection-change.ts';
import type { Session } from '../auth/api.ts';
import type { CollectionSnapshotHeader, CollectionChange, CollectionMetadata, ContentType, PeerKeys, Redaction, RedactionTarget } from '../../security/durable-encryption';
import type { Ciphertext } from '../../security/encryption-adapter';

export class MessageError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = 'MessageError'; }
}
export type ContextInput = { targetId?: string; circleId?: string };
export type RecipientBinding = { accountId: string; generation: number; keys: PeerKeys; intervalId?: string };
export type ConversationContext = { collectionRevision?: number; profileRevision?: number; conversation: string; audience: string; sender: PeerKeys; recipients: RecipientBinding[]; circleId?: string; epoch?: number };
export type SentEvent = { id: string; operation: string; status: 'sent' };
export type ProfileCancellation = { state: 'cancelled'; operation: string } | { state: 'committed'; operation: string; event: SentEvent };
export type EventStatus = { id: string; operation: string; status: 'sent' | 'delivered' };
export type Delivery = CollectionMetadata & { profileRevision?: number; contentType?: ContentType; id: string; operation: string; conversation: string; audience: string; senderId: string; senderGeneration: number; sender: PeerKeys; recipientKeys: PeerKeys; message: Ciphertext };
export type CollectionManifestInput = { circleId: string; epoch: number; revision: number; cursor?: string; limit?: number };
export type CollectionManifest = { circleId: string; epoch: number; revision: number; items: { id: string; kind: 'sticker' | 'emoji' }[]; cursor?: string; more: boolean };
export type InboxPage = { items: Delivery[]; cursor?: string; more: boolean };
export type RedactionPage = { items: Redaction[]; cursor: string; more: boolean };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MessageError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function keys(value: unknown): PeerKeys {
  const v = object(value), key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/.test(value);
  if (!key(v.identity) || !key(v.signingIdentity)) throw new MessageError('INVALID_RESPONSE');
  return { identity: v.identity, signingIdentity: v.signingIdentity };
}
function validPeerKeys(value: unknown): value is PeerKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const key = (input: unknown) => typeof input === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/.test(input);
  return Object.keys(v).sort().join(',') === 'identity,signingIdentity' && key(v.identity) && key(v.signingIdentity);
}
function parseContext(value: unknown, input: ContextInput): ConversationContext {
  const v = object(value);
  if (!id(v.conversation) || !id(v.audience) || !Array.isArray(v.recipients) || v.recipients.length > 19) throw new MessageError('INVALID_RESPONSE');
  const circle = input.circleId !== undefined;
  if (v.collectionRevision !== undefined && (!circle || !Number.isSafeInteger(v.collectionRevision) || (v.collectionRevision as number) < 0)) throw new MessageError('INVALID_RESPONSE');
  if (v.profileRevision !== undefined && (!circle || !Number.isSafeInteger(v.profileRevision) || (v.profileRevision as number) < 0)) throw new MessageError('INVALID_RESPONSE');
  if (circle ? v.circleId !== input.circleId || v.conversation !== input.circleId || !positive(v.epoch) || v.audience !== `circle:${v.epoch}` :
    v.circleId !== undefined || v.epoch !== undefined || !/^private:[0-9a-f]{64}$/.test(v.conversation) || !v.audience.startsWith('friend:') || v.recipients.length !== 1) throw new MessageError('INVALID_RESPONSE');
  const recipients = v.recipients.map(value => {
    const peer = object(value);
    if (!id(peer.accountId) || !positive(peer.generation) || (circle ? !id(peer.intervalId) : peer.intervalId !== undefined)) throw new MessageError('INVALID_RESPONSE');
    return { accountId: peer.accountId, generation: peer.generation, keys: keys(peer.keys), ...(circle ? { intervalId: peer.intervalId as string } : {}) };
  });
  if (new Set(recipients.map(peer => peer.accountId)).size !== recipients.length || (!circle && recipients[0].accountId !== input.targetId)) throw new MessageError('INVALID_RESPONSE');
  return { conversation: v.conversation, audience: v.audience, sender: keys(v.sender), recipients, ...(v.collectionRevision === undefined ? {} : { collectionRevision: v.collectionRevision as number }), ...(v.profileRevision === undefined ? {} : { profileRevision: v.profileRevision as number }), ...(circle ? { circleId: v.circleId as string, epoch: v.epoch as number } : {}) };
}
function parseInbox(value: unknown, cursor: string, limit: number): InboxPage {
  const v = object(value);
  if (!Array.isArray(v.items) || v.items.length > limit || typeof v.more !== 'boolean' ||
    (v.cursor !== undefined && !id(v.cursor)) || (v.more && (!id(v.cursor) || v.cursor === cursor)) || (v.items.length > 0 && !id(v.cursor))) throw new MessageError('INVALID_RESPONSE');
  const items = v.items.map((value): Delivery => {
    const d = object(value), m = object(d.message);
    if (d.contentType !== undefined && d.contentType !== 'text' && d.contentType !== 'ping' && d.contentType !== 'pong' && d.contentType !== 'redaction-control' && d.contentType !== 'private-profile' && d.contentType !== 'now-playing' && d.contentType !== 'circle-profile' && d.contentType !== 'circle-member-profile' && d.contentType !== 'circle-collection' && d.contentType !== 'circle-collection-snapshot') throw new MessageError('INVALID_RESPONSE');
    if (d.contentType === 'private-profile' && (!/^private:[0-9a-f]{64}$/.test(String(d.conversation)) || !/^friend:[A-Za-z0-9._:-]{1,128}$/.test(String(d.audience)))) throw new MessageError('INVALID_RESPONSE');
    if (d.contentType === 'now-playing' && (!/^private:[0-9a-f]{64}$/.test(String(d.conversation)) || !/^friend:[A-Za-z0-9._:-]{1,128}$/.test(String(d.audience)))) throw new MessageError('INVALID_RESPONSE');
    if (d.contentType === 'circle-member-profile' && (!/^[A-Za-z0-9._:-]{1,128}$/.test(String(d.conversation)) || String(d.conversation).startsWith('private:') || !/^circle:[1-9][0-9]*$/.test(String(d.audience)))) throw new MessageError('INVALID_RESPONSE');
    let change: CollectionChange | undefined; let snapshot: CollectionSnapshotHeader | undefined;
    if (d.contentType === 'circle-collection') {
      if (!positive(d.collectionRevision) || !/^circle:[1-9][0-9]*$/.test(String(d.audience)) || String(d.conversation).startsWith('private:')) throw new MessageError('INVALID_RESPONSE');
      change = parseCollectionChange(d.collectionChange);
      if (!change) throw new MessageError('INVALID_RESPONSE');
    } else if (d.contentType === 'circle-collection-snapshot') {
      snapshot = parseSnapshotHeader(d.collectionSnapshot);
      if (!snapshot || !Number.isSafeInteger(d.collectionRevision) || (d.collectionRevision as number) < 0 || d.collectionChange !== undefined || !/^circle:[1-9][0-9]*$/.test(String(d.audience)) || String(d.conversation).startsWith('private:')) throw new MessageError('INVALID_RESPONSE');
    } else if (d.collectionRevision !== undefined || d.collectionChange !== undefined) throw new MessageError('INVALID_RESPONSE');
    if (d.contentType !== 'circle-collection-snapshot' && d.collectionSnapshot !== undefined) throw new MessageError('INVALID_RESPONSE');
    if (d.profileRevision !== undefined && (d.contentType !== 'circle-profile' || !positive(d.profileRevision))) throw new MessageError('INVALID_RESPONSE');
    if (!id(d.id) || !id(d.operation) || !id(d.conversation) || !id(d.audience) || !id(d.senderId) || !positive(d.senderGeneration) ||
      (m.kind !== 0 && m.kind !== 1) || typeof m.body !== 'string' || m.body.length < 2 || m.body.length > 65536 || !/^[A-Za-z0-9+/]+$/.test(m.body) ||
      m.body.length % 4 === 1 || (m.body.length % 4 === 2 && !/[AQgw]$/.test(m.body)) || (m.body.length % 4 === 3 && !/[AEIMQUYcgkosw048]$/.test(m.body))) throw new MessageError('INVALID_RESPONSE');
    return { ...(snapshot ? { collectionSnapshot: snapshot, collectionRevision: d.collectionRevision as number } : {}), ...(change ? { collectionChange: change, collectionRevision: d.collectionRevision as number } : {}), id: d.id, operation: d.operation, conversation: d.conversation, audience: d.audience, senderId: d.senderId, senderGeneration: d.senderGeneration,
      ...(d.profileRevision === undefined ? {} : { profileRevision: d.profileRevision as number }), ...(d.contentType === undefined ? {} : { contentType: d.contentType }), sender: keys(d.sender), recipientKeys: keys(d.recipientKeys), message: { kind: m.kind, body: m.body } };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new MessageError('INVALID_RESPONSE');
  return { items, ...(v.cursor === undefined ? {} : { cursor: v.cursor as string }), more: v.more };
}
function parseRedaction(value: unknown): Redaction {
  const item = object(value);
  const required = ['audience', 'conversation', 'cursor', 'eventId', 'operation', 'sender'];
  if (Object.keys(item).sort().join(',') !== required.join(',') || required.some(key => !(key in item)) ||
    !id(item.eventId) || !id(item.conversation) || !id(item.audience) || !id(item.operation) ||
    typeof item.cursor !== 'string' || (item.cursor !== '' && !id(item.cursor))) throw new MessageError('INVALID_RESPONSE');
  return { eventId: item.eventId, conversation: item.conversation, audience: item.audience, operation: item.operation, sender: keys(item.sender), cursor: item.cursor };
}
function parseRedactionPage(value: unknown, cursor: string, limit: number): RedactionPage {
  const page = object(value);
  if (Object.keys(page).some(key => !['items', 'cursor', 'more'].includes(key)) ||
    !Array.isArray(page.items) || page.items.length > limit || typeof page.more !== 'boolean' ||
    typeof page.cursor !== 'string' || (page.cursor !== '' && !id(page.cursor)) ||
    (page.more && (page.items.length === 0 || page.cursor === '' || page.cursor === cursor)) ||
    (page.items.length > 0 && page.cursor === '')) throw new MessageError('INVALID_RESPONSE');
  const items = page.items.map(parseRedaction);
  if (new Set(items.map(item => item.eventId)).size !== items.length) throw new MessageError('INVALID_RESPONSE');
  return { items, cursor: page.cursor, more: page.more };
}
const codes = new Set(['INVALID_INPUT', 'DENIED', 'OPERATION_CONFLICT', 'OPERATION_CANCELLED', 'KEYS_UNAVAILABLE', 'UNAVAILABLE', 'SESSION_REVOKED', 'REDACTION_CONFLICT', 'MESSAGE_REDACTED']);
export function createMessageAPI(origin: string, session: () => Session, development = false) {
  let url: URL;
  try { url = new URL(origin); } catch { throw new MessageError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new MessageError('CONFIGURATION');
  async function request(path: string, payload?: object, responseLimit = 32768): Promise<unknown> {
    const before = session(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${url.origin}${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${before.accessToken}`, Accept: 'application/json', ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: payload === undefined ? undefined : JSON.stringify(payload), redirect: 'error', signal: controller.signal });
      const raw = await response.text(), after = session();
      if (before.account.id !== after.account.id || before.deviceId !== after.deviceId || before.generation !== after.generation || before.accessToken !== after.accessToken) throw new MessageError('SESSION_CHANGED');
      if (raw.length > responseLimit) throw new MessageError('INVALID_RESPONSE');
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new MessageError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE'); }
      if (!response.ok) { const v = object(value); throw new MessageError(typeof v.code === 'string' && codes.has(v.code) ? v.code : 'UNAVAILABLE'); }
      if (response.status !== 200) throw new MessageError('INVALID_RESPONSE');
      return value;
    } catch (error) {
      if (error instanceof MessageError) throw error;
      if (error instanceof Error && 'code' in error) throw new MessageError(error.code === 'SESSION_REVOKED' ? 'SESSION_REVOKED' : 'SESSION_CHANGED');
      throw new MessageError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  return {
    async collectionManifest(input: CollectionManifestInput): Promise<CollectionManifest> {
      const bound = { circleId: input.circleId, epoch: input.epoch, revision: input.revision, cursor: input.cursor ?? '', limit: input.limit ?? 50 };
      if (!id(bound.circleId) || bound.circleId === '.' || bound.circleId === '..' || !positive(bound.epoch) || !Number.isSafeInteger(bound.revision) || bound.revision < 0 || !positive(bound.limit) || bound.limit > 50 || (bound.cursor !== '' && (!id(bound.cursor) || bound.cursor === '.' || bound.cursor === '..'))) throw new MessageError('INVALID_INPUT');
      const value = object(await request('/v1/messages/collections/manifest', bound));
      if (Object.keys(value).some(key => !['circleId', 'epoch', 'revision', 'items', 'cursor', 'more'].includes(key)) || value.circleId !== bound.circleId || value.epoch !== bound.epoch || value.revision !== bound.revision || !Array.isArray(value.items) || value.items.length > bound.limit || typeof value.more !== 'boolean') throw new MessageError('INVALID_RESPONSE');
      let previous = bound.cursor;
      const items = value.items.map((raw): CollectionManifest['items'][number] => {
        const item = object(raw);
        if (Object.keys(item).sort().join(',') !== 'id,kind' || !id(item.id) || item.id === '.' || item.id === '..' || item.id <= previous || (item.kind !== 'sticker' && item.kind !== 'emoji')) throw new MessageError('INVALID_RESPONSE');
        previous = item.id; return { id: item.id, kind: item.kind };
      });
      if (value.more ? items.length === 0 || value.cursor !== previous : value.cursor !== undefined) throw new MessageError('INVALID_RESPONSE');
      return { circleId: bound.circleId, epoch: bound.epoch, revision: bound.revision, items, more: value.more, ...(value.more ? { cursor: previous } : {}) };
    },
    async cancelProfile(envelope: string): Promise<ProfileCancellation> {
      if (typeof envelope !== 'string' || envelope.length > 2 * 1024 * 1024) throw new MessageError('INVALID_INPUT');
      let operation: unknown;
      try { const input = JSON.parse(envelope); if (input.contentType !== 'circle-profile') throw new Error(); operation = input.operation; } catch { throw new MessageError('INVALID_INPUT'); }
      if (!id(operation)) throw new MessageError('INVALID_INPUT');
      const value = object(await request('/v1/messages/profiles/cancel', { envelope }));
      if (value.operation !== operation) throw new MessageError('INVALID_RESPONSE');
      if (value.state === 'cancelled' && value.event === undefined) return { state: 'cancelled', operation };
      if (value.state !== 'committed') throw new MessageError('INVALID_RESPONSE');
      const event = object(value.event);
      if (!id(event.id) || event.operation !== operation || event.status !== 'sent') throw new MessageError('INVALID_RESPONSE');
      return { state: 'committed', operation, event: { id: event.id, operation, status: 'sent' } };
    },
    async cancelCollection(envelope: string): Promise<ProfileCancellation> {
      if (typeof envelope !== 'string' || envelope.length > 2 * 1024 * 1024) throw new MessageError('INVALID_INPUT');
      let operation: unknown;
      try { const input = JSON.parse(envelope); if (input.contentType !== 'circle-collection') throw new Error(); operation = input.operation; } catch { throw new MessageError('INVALID_INPUT'); }
      if (!id(operation)) throw new MessageError('INVALID_INPUT');
      const value = object(await request('/v1/messages/collections/cancel', { envelope }));
      if (value.operation !== operation) throw new MessageError('INVALID_RESPONSE');
      if (value.state === 'cancelled' && value.event === undefined) return { state: 'cancelled', operation };
      if (value.state !== 'committed') throw new MessageError('INVALID_RESPONSE');
      const event = object(value.event);
      if (!id(event.id) || event.operation !== operation || event.status !== 'sent') throw new MessageError('INVALID_RESPONSE');
      return { state: 'committed', operation, event: { id: event.id, operation, status: 'sent' } };
    },
    async status(eventId: string): Promise<EventStatus> {
      if (!id(eventId)) throw new MessageError('INVALID_INPUT');
      const value = object(await request('/v1/messages/status', { eventId }));
      if (value.id !== eventId || !id(value.operation) || (value.status !== 'sent' && value.status !== 'delivered')) throw new MessageError('INVALID_RESPONSE');
      return { id: eventId, operation: value.operation, status: value.status };
    },
    async acknowledge(eventId: string): Promise<void> {
      if (!id(eventId)) throw new MessageError('INVALID_INPUT');
      if (await request('/v1/messages/acknowledgements', { eventId }) !== null) throw new MessageError('INVALID_RESPONSE');
    },
    async inbox(cursor = '', limit = 25): Promise<InboxPage> {
      if ((cursor !== '' && !id(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new MessageError('INVALID_INPUT');
      return parseInbox(await request(`/v1/messages/inbox?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, undefined, 2 * 1024 * 1024), cursor, limit);
    },
    async history(conversation: string, audience: string, cursor = '', limit = 25): Promise<InboxPage> {
      if (!id(conversation) || conversation === '.' || conversation === '..' || !id(audience) || audience === '.' || audience === '..' ||
        (cursor !== '' && !id(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new MessageError('INVALID_INPUT');
      return parseInbox(await request(`/v1/messages/history?conversation=${encodeURIComponent(conversation)}&audience=${encodeURIComponent(audience)}&cursor=${encodeURIComponent(cursor)}&limit=${limit}`, undefined, 2 * 1024 * 1024), cursor, limit);
    },
    async redact(target: RedactionTarget): Promise<Redaction> {
      if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).length !== 1 ||
        ('eventId' in target ? !id(target.eventId) : !('legacy' in target) || !target.legacy ||
          Object.keys(target.legacy).sort().join(',') !== 'audience,conversation,operation,peerKeys' ||
          !id(target.legacy.conversation) || !id(target.legacy.audience) || !id(target.legacy.operation) || !validPeerKeys(target.legacy.peerKeys))) throw new MessageError('INVALID_INPUT');
      const value = parseRedaction(await request('/v1/messages/redactions', target));
      if ('eventId' in target && value.eventId !== target.eventId) throw new MessageError('INVALID_RESPONSE');
      if ('legacy' in target && (value.conversation !== target.legacy.conversation || value.audience !== target.legacy.audience || value.operation !== target.legacy.operation ||
        value.sender.identity !== target.legacy.peerKeys.identity || value.sender.signingIdentity !== target.legacy.peerKeys.signingIdentity)) throw new MessageError('INVALID_RESPONSE');
      return value;
    },
    async redactions(cursor = '', limit = 25): Promise<RedactionPage> {
      if ((cursor !== '' && !id(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new MessageError('INVALID_INPUT');
      const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      return parseRedactionPage(await request(`/v1/messages/redactions?${query}`, undefined, 256 * 1024), cursor, limit);
    },
    async context(input: ContextInput): Promise<ConversationContext> {
      if ((input.targetId === undefined) === (input.circleId === undefined) || !id(input.targetId ?? input.circleId)) throw new MessageError('INVALID_INPUT');
      const payload = input.circleId === undefined ? { targetId: input.targetId } : { circleId: input.circleId };
      return parseContext(await request('/v1/messages/context', payload), input);
    },
    async send(envelope: string): Promise<SentEvent> {
      if (typeof envelope !== 'string' || envelope.length > 2 * 1024 * 1024) throw new MessageError('INVALID_INPUT');
      let operation: unknown;
      try { operation = JSON.parse(envelope).operation; } catch { throw new MessageError('INVALID_INPUT'); }
      if (!id(operation)) throw new MessageError('INVALID_INPUT');
      const value = object(await request('/v1/messages', { envelope }));
      if (!id(value.id) || value.operation !== operation || value.status !== 'sent') throw new MessageError('INVALID_RESPONSE');
      return { id: value.id, operation, status: 'sent' };
    },
  };
}
