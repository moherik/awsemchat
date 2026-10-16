import { parseSnapshotHeader } from '../../security/snapshot-header.ts';
import { parseCollectionChange } from '../../security/collection-change.ts';
import type { ContentType, DurableHistory, PendingRedaction } from '../../security/durable-encryption';
import type { HistoryRecord } from '../../storage/history-types';
import { parsePersonalSticker, type PersonalSticker } from '../stickers/personal-stickers.ts';
import { validateConversationPreferences, type ConversationPreferences } from '../messages/conversation-preferences.ts';

type AccountBinding = { id: string; binding: string };
export type ArchiveCodec = {
  encode(account: string, records: HistoryRecord[]): Promise<{ archive: string; recoveryKey: string }>;
  decode(account: string, archive: string, recoveryKey: string): Promise<{ records: HistoryRecord[] }>;
};
type Ports = {
  account(): AccountBinding;
  history: { exportHistory(): Promise<DurableHistory[]>; importHistory(records: DurableHistory[]): Promise<unknown> };
  pendingRedactions(): Promise<PendingRedaction[]>;
  stickers?: { exportStickers(): Promise<readonly unknown[]>; importStickers(values: PersonalSticker[]): Promise<unknown> };
  preferences?: { export(): Promise<unknown>; import(values: ConversationPreferences): Promise<unknown> };
  redactions: { redactions(cursor: string, limit: number): Promise<{ items: unknown[]; cursor: string; more: boolean }> };
  codec: ArchiveCodec;
};
const context = 'awsemchat.history-backup.v1';
const stickerContext = 'awsemchat.personal-stickers.v1';
const preferenceContext = 'awsemchat.chat-preferences.v1';
const stickerChunkSize = 160 * 1024;
function invalid(): never { throw new Error('INVALID_BACKUP'); }
function preferenceRecord(value: unknown, account: string): HistoryRecord {
  let values: ConversationPreferences;
  try { values = validateConversationPreferences(value); } catch { return invalid(); }
  return { eventId: 'chat-preferences-v1', conversationId: preferenceContext, originalAudience: [account],
    membershipInterval: 'local-preferences', receivedAt: 0, payload: JSON.stringify({ version: 1, values }) };
}
function restoredPreferences(record: HistoryRecord, account: string): ConversationPreferences {
  if (record.eventId !== 'chat-preferences-v1' || record.membershipInterval !== 'local-preferences' || record.receivedAt !== 0 ||
      !Array.isArray(record.originalAudience) || record.originalAudience.length !== 1 || record.originalAudience[0] !== account) return invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(record.payload); } catch { return invalid(); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return invalid();
  const data = decoded as Record<string, unknown>;
  if (Object.keys(data).sort().join(',') !== 'values,version' || data.version !== 1) return invalid();
  try { return validateConversationPreferences(data.values); } catch { return invalid(); }
}
function byteLength(value: string) {
  let length = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return length;
}
function stickerRecords(values: readonly unknown[], account: string): HistoryRecord[] {
  if (!Array.isArray(values) || values.length > 10_000) throw new Error('CAPACITY');
  const stickers = values.map(parsePersonalSticker);
  if (new Set(stickers.map(value => value.id)).size !== stickers.length) return invalid();
  const output: HistoryRecord[] = [];
  stickers.forEach((sticker, stickerIndex) => {
    const image = sticker.artwork.image;
    const parts = Math.ceil(image.length / stickerChunkSize);
    const metadata = { id: sticker.id, artwork: { ...sticker.artwork, image: '' } };
    for (let part = 0; part < parts; part++) {
      const payload = JSON.stringify({ kind: 'personal-sticker.v1', stickerIndex, part, parts,
        data: image.slice(part * stickerChunkSize, (part + 1) * stickerChunkSize), ...(part === 0 ? { sticker: metadata } : {}) });
      if (byteLength(payload) > 256 * 1024) throw new Error('CAPACITY');
      output.push({ eventId: `sticker-${stickerIndex}-${part}`, conversationId: stickerContext,
        originalAudience: [account], membershipInterval: 'personal-library', receivedAt: 0, payload });
    }
  });
  return output;
}
function restoredStickers(records: HistoryRecord[]): PersonalSticker[] {
  const groups = new Map<number, { parts: number; chunks: string[]; metadata?: unknown }>();
  for (const record of records) {
    if (record.conversationId !== stickerContext || record.membershipInterval !== 'personal-library' || record.receivedAt !== 0 ||
        !Array.isArray(record.originalAudience) || record.originalAudience.length !== 1 ||
        !/^sticker-[0-9]+-[0-9]+$/.test(record.eventId) || byteLength(record.payload) > 256 * 1024) return invalid();
    let value: unknown;
    try { value = JSON.parse(record.payload); } catch { return invalid(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const item = value as Record<string, unknown>;
    const match = /^sticker-([0-9]+)-([0-9]+)$/.exec(record.eventId)!;
    const stickerIndex = Number(match[1]), part = Number(match[2]);
    if (Object.keys(item).sort().join(',') !== (part === 0 ? 'data,kind,part,parts,sticker,stickerIndex' : 'data,kind,part,parts,stickerIndex') ||
        item.kind !== 'personal-sticker.v1' || item.stickerIndex !== stickerIndex || item.part !== part ||
        !Number.isSafeInteger(item.parts) || (item.parts as number) < 1 || (item.parts as number) > 18 || part >= (item.parts as number) ||
        typeof item.data !== 'string' || !item.data || (part === 0 ? !item.sticker : item.sticker !== undefined)) return invalid();
    const group = groups.get(stickerIndex) ?? { parts: item.parts as number, chunks: [] };
    if (group.parts !== item.parts || group.chunks[part] !== undefined) return invalid();
    group.chunks[part] = item.data;
    if (part === 0) group.metadata = item.sticker;
    groups.set(stickerIndex, group);
  }
  const indexes = [...groups.keys()].sort((a, b) => a - b);
  if (indexes.some((value, index) => value !== index)) return invalid();
  return indexes.map(index => {
    const group = groups.get(index)!;
    if (group.chunks.length !== group.parts || Array.from({ length: group.parts }, (_, part) => group.chunks[part]).some(value => typeof value !== 'string') || !group.metadata || typeof group.metadata !== 'object') return invalid();
    const meta = group.metadata as Record<string, unknown>;
    if (Object.keys(meta).sort().join(',') !== 'artwork,id' || !meta.artwork || typeof meta.artwork !== 'object' || Array.isArray(meta.artwork)) return invalid();
    return parsePersonalSticker({ id: meta.id, artwork: { ...(meta.artwork as Record<string, unknown>), image: group.chunks.join('') } });
  });
}
function history(value: unknown): DurableHistory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const data = value as Record<string, unknown>;
  const sender = data.sender as Record<string, unknown> | undefined;
  for (const field of ['operation', 'conversation', 'audience', 'plaintext']) {
    if (typeof data[field] !== 'string') return invalid();
  }
  if (!sender || typeof sender.identity !== 'string' || typeof sender.signingIdentity !== 'string' ||
    (data.serverEventId !== undefined && (typeof data.serverEventId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(data.serverEventId))) ||
    (data.contentType !== undefined && data.contentType !== 'text' && data.contentType !== 'redaction-control' && data.contentType !== 'circle-profile' && data.contentType !== 'circle-collection' && data.contentType !== 'circle-collection-snapshot') ||
    (data.profileRevision !== undefined && (data.contentType !== 'circle-profile' || !Number.isSafeInteger(data.profileRevision) || (data.profileRevision as number) < 1)) ||
    (data.profileAccepted !== undefined && (data.contentType !== 'circle-profile' || typeof data.profileAccepted !== 'boolean')) ||
    (data.direction !== undefined && data.direction !== 'incoming' && data.direction !== 'outgoing') ||
    (data.createdAt !== undefined && (!Number.isSafeInteger(data.createdAt) || (data.createdAt as number) < 0))) return invalid();
  const change = data.contentType === 'circle-collection' ? parseCollectionChange(data.collectionChange) : undefined;
  const snapshot = data.contentType === 'circle-collection-snapshot' ? parseSnapshotHeader(data.collectionSnapshot) : undefined;
  if (data.contentType === 'circle-collection') {
    if (!Number.isSafeInteger(data.collectionRevision) || (data.collectionRevision as number) < 1 || !change || data.collectionSnapshot !== undefined) return invalid();
  } else if (data.contentType === 'circle-collection-snapshot') {
    if (!Number.isSafeInteger(data.collectionRevision) || (data.collectionRevision as number) < 0 || !snapshot || data.collectionChange !== undefined) return invalid();
  } else if (data.collectionRevision !== undefined || data.collectionChange !== undefined || data.collectionSnapshot !== undefined || data.collectionAccepted !== undefined) return invalid();
  if (data.collectionAccepted !== undefined && typeof data.collectionAccepted !== 'boolean') return invalid();
  return {
    ...(snapshot ? { collectionSnapshot: snapshot, collectionRevision: data.collectionRevision as number, ...(data.collectionAccepted === undefined ? {} : { collectionAccepted: data.collectionAccepted as boolean }) } : {}),
    ...(change ? { collectionChange: change, collectionRevision: data.collectionRevision as number, ...(data.collectionAccepted === undefined ? {} : { collectionAccepted: data.collectionAccepted as boolean }) } : {}),
    operation: data.operation as string, conversation: data.conversation as string,
    audience: data.audience as string, plaintext: data.plaintext as string,
    ...(data.serverEventId === undefined ? {} : { serverEventId: data.serverEventId as string }),
    sender: { identity: sender.identity, signingIdentity: sender.signingIdentity }, archival: true,
    ...(data.contentType === undefined ? {} : { contentType: data.contentType as ContentType }),
    ...(data.profileRevision === undefined ? {} : { profileRevision: data.profileRevision as number }),
    ...(data.profileAccepted === undefined ? {} : { profileAccepted: data.profileAccepted as boolean }),
    ...(data.direction === undefined ? {} : { direction: data.direction }),
    ...(data.createdAt === undefined ? {} : { createdAt: data.createdAt as number }),
  };
}

type BackupRedaction = { eventId: string; conversation: string; audience: string; operation: string; sender: { identity: string; signingIdentity: string } };
const keyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/;
function redactionPage(value: unknown, cursor: string, limit: number): { items: BackupRedaction[]; cursor: string; more: boolean } {
  const invalidLedger = () => { throw new Error('INVALID_REDACTION_LEDGER'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidLedger();
  const page = value as Record<string, unknown>;
  if (Object.keys(page).sort().join(',') !== 'cursor,items,more' || !Array.isArray(page.items) || page.items.length > limit ||
    typeof page.cursor !== 'string' || (page.cursor !== '' && !/^[A-Za-z0-9._:-]{1,128}$/.test(page.cursor)) || typeof page.more !== 'boolean' ||
    (page.more && (page.items.length === 0 || !page.cursor || page.cursor === cursor)) || (page.items.length > 0 && !page.cursor)) return invalidLedger();
  const seen = new Set<string>();
  const items = page.items.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidLedger();
    const item = value as Record<string, unknown>, sender = item.sender as Record<string, unknown> | undefined;
    if (Object.keys(item).sort().join(',') !== 'audience,conversation,cursor,eventId,operation,sender' ||
      !['eventId', 'conversation', 'audience', 'operation'].every(field => typeof item[field] === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(item[field] as string)) ||
      typeof item.cursor !== 'string' || (item.cursor !== '' && !/^[A-Za-z0-9._:-]{1,128}$/.test(item.cursor)) || !sender ||
      Object.keys(sender).sort().join(',') !== 'identity,signingIdentity' || !keyPattern.test(String(sender.identity)) || !keyPattern.test(String(sender.signingIdentity))) return invalidLedger();
    if (seen.has(item.eventId as string)) return invalidLedger();
    seen.add(item.eventId as string);
    return { eventId: item.eventId as string, conversation: item.conversation as string, audience: item.audience as string,
      operation: item.operation as string, sender: { identity: sender.identity as string, signingIdentity: sender.signingIdentity as string } };
  });
  return { items, cursor: page.cursor, more: page.more };
}
async function readRedactions(ports: Ports, assertBinding: (bound: AccountBinding) => void, bound: AccountBinding): Promise<BackupRedaction[]> {
  let cursor = '';
  const items: BackupRedaction[] = [], seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
    assertBinding(bound);
    let value: unknown;
    try { value = await ports.redactions.redactions(cursor, 100); }
    catch (error) { assertBinding(bound); throw error; }
    assertBinding(bound);
    const page = redactionPage(value, cursor, 100);
    for (const item of page.items) {
      if (seen.has(item.eventId)) throw new Error('INVALID_REDACTION_LEDGER');
      seen.add(item.eventId);
      items.push(item);
    }
    if (!page.more) return items;
    cursor = page.cursor;
  }
  throw new Error('INVALID_REDACTION_LEDGER');
}
function reconcileRedactions(records: DurableHistory[], redactions: BackupRedaction[]): DurableHistory[] {
  const descriptor = (record: DurableHistory, item: BackupRedaction) => record.conversation === item.conversation && record.audience === item.audience &&
    record.operation === item.operation && record.sender.identity === item.sender.identity && record.sender.signingIdentity === item.sender.signingIdentity;
  const matchedLegacy = new Map<BackupRedaction, number>();
  for (const item of redactions) matchedLegacy.set(item, records.filter(record => record.serverEventId === undefined && descriptor(record, item)).length);
  const legacyMatches = records.map(record => record.serverEventId === undefined ? redactions.filter(item => descriptor(record, item)).length : 0);
  if ([...matchedLegacy.values()].some(count => count > 1) || legacyMatches.some(count => count > 1)) throw new Error('AMBIGUOUS_REDACTION');
  return records.filter(record => {
    const byId = record.serverEventId === undefined ? undefined : redactions.find(item => item.eventId === record.serverEventId);
    if (byId) {
      if (!descriptor(record, byId)) throw new Error('INVALID_REDACTION_LEDGER');
      return false;
    }
    return !redactions.some(item => record.serverEventId === undefined && descriptor(record, item));
  });
}
function pendingTarget(record: DurableHistory, target: PendingRedaction['target']): boolean {
  if ('eventId' in target) return record.serverEventId === target.eventId;
  return record.serverEventId === undefined && record.conversation === target.legacy.conversation && record.audience === target.legacy.audience &&
    record.operation === target.legacy.operation && record.sender.identity === target.legacy.peerKeys.identity && record.sender.signingIdentity === target.legacy.peerKeys.signingIdentity;
}

export function createHistoryBackup(ports: Ports) {
  function assertBinding(bound: AccountBinding) {
    const current = ports.account();
    if (current.id !== bound.id || current.binding !== bound.binding) throw new Error('SESSION_REVOKED');
  }
  return {
    async create(save: (encryptedArchive: string) => Promise<void>) {
      const bound = { ...ports.account() };
      const pending = await ports.pendingRedactions();
      assertBinding(bound);
      const records = (await ports.history.exportHistory()).filter(record => !pending.some(item => pendingTarget(record, item.target)));
      assertBinding(bound);
      const stickers = ports.stickers ? await ports.stickers.exportStickers() : [];
      assertBinding(bound);
      const historyRecords: HistoryRecord[] = records.map((record, index) => ({
        eventId: `entry-${index}`, conversationId: context, originalAudience: [bound.id],
        membershipInterval: 'history-only', receivedAt: 0, payload: JSON.stringify(history(record)),
      }));
      const personalRecords = stickerRecords(stickers, bound.id);
      const savedPreferences = ports.preferences ? [preferenceRecord(await ports.preferences.export(), bound.id)] : [];
      assertBinding(bound);
      if (historyRecords.length + personalRecords.length + savedPreferences.length > 768) throw new Error('CAPACITY');
      const wrapped = [...historyRecords, ...personalRecords, ...savedPreferences];
      const sealed = await ports.codec.encode(bound.id, wrapped);
      assertBinding(bound);
      await save(sealed.archive);
      assertBinding(bound);
      return { recoveryKey: sealed.recoveryKey, records: records.length, stickers: stickers.length };
    },
    async restore(archive: string, recoveryKey: string) {
      const bound = { ...ports.account() };
      const decoded = await ports.codec.decode(bound.id, archive, recoveryKey);
      assertBinding(bound);
      if (!Array.isArray(decoded.records) || decoded.records.length > 768) return invalid();
      const redactions = await readRedactions(ports, assertBinding, bound);
      const seen = new Set<string>();
      const messageRecords: DurableHistory[] = [];
      const stickerRecordsToRestore: HistoryRecord[] = [];
      const savedPreferences: ConversationPreferences[] = [];
      decoded.records.forEach((record) => {
        if (record.conversationId === stickerContext) {
          if (record.originalAudience?.length !== 1 || record.originalAudience[0] !== bound.id) return invalid();
          stickerRecordsToRestore.push(record); return;
        }
        if (record.conversationId === preferenceContext) {
          savedPreferences.push(restoredPreferences(record, bound.id)); return;
        }
        if (record.conversationId !== context || record.membershipInterval !== 'history-only' ||
          record.receivedAt !== 0 || !Array.isArray(record.originalAudience) ||
          record.originalAudience.length !== 1 || record.originalAudience[0] !== bound.id ||
          !/^entry-[0-9]+$/.test(record.eventId) || seen.has(record.eventId)) return invalid();
        seen.add(record.eventId);
        let parsed: unknown;
        try { parsed = JSON.parse(record.payload); } catch { return invalid(); }
        messageRecords.push(history(parsed));
      });
      const stickers = restoredStickers(stickerRecordsToRestore);
      if (savedPreferences.length > 1 || (savedPreferences.length && !ports.preferences)) return invalid();
      if (!ports.stickers && stickerRecordsToRestore.length) return invalid();
      const visibleMessages = reconcileRedactions(messageRecords, redactions);
      assertBinding(bound);
      await ports.history.importHistory(visibleMessages);
      assertBinding(bound);
      if (ports.stickers) await ports.stickers.importStickers(stickers);
      assertBinding(bound);
      if (savedPreferences.length && ports.preferences) await ports.preferences.import(savedPreferences[0]);
      assertBinding(bound);
      return { records: visibleMessages.length, stickers: stickers.length };
    },
  };
}
