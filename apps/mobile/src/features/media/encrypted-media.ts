import { fromByteArray, toByteArray } from 'base64-js';
import type { ArchiveCodec } from '../backup/history-backup';
import type { HistoryRecord } from '../../storage/history-types';

export type MediaDescriptor = Readonly<{ version: 1; id: string; key: string; size: number; mimeType: string }>;
export type PreparedMedia = Readonly<{ descriptor: MediaDescriptor; ciphertext: string }>;
export type OperationCancellation = Readonly<{ state: 'cancelled' } | { state: 'committed'; eventId: string }>;
export type CiphertextStorage = { put(id: string, ciphertext: string, operationID: string): Promise<void>; get(id: string): Promise<string>; cancel(operationID: string): Promise<OperationCancellation> };
type Ports = { binding(): string; objectId(): string; codec: ArchiveCodec; storage: CiphertextStorage };
const maxBytes = 2 * 1024 * 1024, chunkBytes = 16 * 1024, maxCiphertext = 8 * 1024 * 1024;
const types = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const objectId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
const base64 = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
function invalid(): never { throw new Error('INVALID_MEDIA'); }
export function validateMediaDescriptor(value: MediaDescriptor): MediaDescriptor {
  if (!value || value.version !== 1 || !objectId(value.id) || !/^[a-f0-9]{64}$/.test(value.key) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > maxBytes || !types.has(value.mimeType)) invalid();
  return Object.freeze({ version: 1, id: value.id, key: value.key, size: value.size, mimeType: value.mimeType });
}
const descriptor = validateMediaDescriptor;
export function createEncryptedMedia(ports: Ports) {
  const preparedOwners = new WeakMap<PreparedMedia, string>();
  function check(bound: string) { if (ports.binding() !== bound) throw new Error('SESSION_CHANGED'); }
  function context(id: string) { return `awsemchat.media.v1:${id}`; }
  function wrap(id: string, eventId: string, payload: string): HistoryRecord {
    const binding = context(id);
    return { eventId, conversationId: binding, originalAudience: [binding], membershipInterval: binding, receivedAt: 0, payload };
  }
  async function decode(value: MediaDescriptor, ciphertext: string, bound: string): Promise<Uint8Array> {
    if (!base64(ciphertext) || ciphertext.length > maxCiphertext) invalid();
    const { records } = await ports.codec.decode(context(value.id), ciphertext, value.key); check(bound);
    const count = Math.ceil(value.size / chunkBytes);
    if (records.length !== count + 1) invalid();
    for (let i = 0; i < records.length; i++) {
      const record = records[i], binding = context(value.id);
      if (!record || record.eventId !== (i === 0 ? 'manifest' : `chunk-${i - 1}`) || record.conversationId !== binding || record.membershipInterval !== binding || record.receivedAt !== 0 || record.originalAudience.length !== 1 || record.originalAudience[0] !== binding || typeof record.payload !== 'string') invalid();
    }
    let manifest: Record<string, unknown>;
    try { manifest = JSON.parse(records[0].payload); } catch { return invalid(); }
    if (!manifest || manifest.version !== 1 || manifest.id !== value.id || manifest.size !== value.size || manifest.mimeType !== value.mimeType || manifest.chunks !== count) invalid();
    const bytes = new Uint8Array(value.size);
    for (let i = 0; i < count; i++) {
      const payload = records[i + 1].payload;
      if (!base64(payload) || payload.length > 4 * Math.ceil(chunkBytes / 3)) invalid();
      const chunk = toByteArray(payload);
      if (fromByteArray(chunk) !== payload || chunk.length !== Math.min(chunkBytes, value.size - i * chunkBytes)) invalid();
      bytes.set(chunk, i * chunkBytes);
    }
    check(bound); return bytes;
  }
  return {
    async restore(input: PreparedMedia): Promise<PreparedMedia> {
      const bound = ports.binding(), value = descriptor(input.descriptor), ciphertext = input.ciphertext;
      await decode(value, ciphertext, bound);
      const prepared = Object.freeze({ descriptor: value, ciphertext });
      preparedOwners.set(prepared, bound); return prepared;
    },
    async prepare(input: { bytes: Uint8Array; mimeType: string }): Promise<PreparedMedia> {
      const bound = ports.binding();
      if (!(input.bytes instanceof Uint8Array) || input.bytes.length < 1 || input.bytes.length > maxBytes || !types.has(input.mimeType)) invalid();
      const bytes = input.bytes.slice(), id = ports.objectId(), mimeType = input.mimeType;
      if (!objectId(id)) invalid();
      const chunks = Math.ceil(bytes.length / chunkBytes);
      const records = [wrap(id, 'manifest', JSON.stringify({ version: 1, id, size: bytes.length, mimeType, chunks }))];
      for (let i = 0; i < chunks; i++) records.push(wrap(id, `chunk-${i}`, fromByteArray(bytes.subarray(i * chunkBytes, (i + 1) * chunkBytes))));
      const sealed = await ports.codec.encode(context(id), records); check(bound);
      const value = descriptor({ version: 1, id, key: sealed.recoveryKey, size: bytes.length, mimeType });
      if (!base64(sealed.archive) || sealed.archive.length > maxCiphertext) invalid();
      const prepared = Object.freeze({ descriptor: value, ciphertext: sealed.archive });
      preparedOwners.set(prepared, bound); return prepared;
    },
    async upload(prepared: PreparedMedia, operationID: string): Promise<MediaDescriptor> {
      const bound = ports.binding();
      if (!objectId(operationID)) invalid();
      if (preparedOwners.get(prepared) !== bound) throw new Error('SESSION_CHANGED');
      const value = descriptor(prepared.descriptor);
      await decode(value, prepared.ciphertext, bound);
      await ports.storage.put(value.id, prepared.ciphertext, operationID); check(bound);
      return value;
    },
    async cancel(operationID: string): Promise<OperationCancellation> {
      const bound = ports.binding(); if (!objectId(operationID)) invalid();
      const result = await ports.storage.cancel(operationID); check(bound);
      if (!result || result.state === 'cancelled') return Object.freeze({ state: 'cancelled' });
      if (result.state === 'committed' && objectId(result.eventId)) return Object.freeze({ state: 'committed', eventId: result.eventId });
      invalid();
    },
    async download(input: MediaDescriptor): Promise<Uint8Array> {
      const bound = ports.binding(), value = descriptor(input);
      const ciphertext = await ports.storage.get(value.id); check(bound);
      return decode(value, ciphertext, bound);
    },
  };
}
