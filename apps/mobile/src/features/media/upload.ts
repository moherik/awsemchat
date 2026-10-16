import type { createEncryptedMedia, OperationCancellation, PreparedMedia } from './encrypted-media';

export type CollectionUploadIntent = Readonly<{ action: 'add' | 'snapshot-refresh'; id: string; kind: 'sticker' | 'emoji'; label: string; revision: number; operation: string }>;
export type MomentUploadIntent = Readonly<{ operation: string; caption: string }>;
export type ChatImageUploadIntent = Readonly<{ operation: string; caption: string }>;
export type ChatStickerUploadIntent = Readonly<{ operation: string; item: string; label: string }>;
export type ProfileUploadIntent = Readonly<{ operation: string; revision: number }>;
export type PendingMediaUpload = Readonly<{ version: 1; binding: string; circleId: string; epoch: number; operationID: string; uploadAttempted: boolean; profileRevision?: number; profileIntent?: ProfileUploadIntent; collectionIntent?: CollectionUploadIntent; momentIntent?: MomentUploadIntent; chatImageIntent?: ChatImageUploadIntent; chatStickerIntent?: ChatStickerUploadIntent; prepared: PreparedMedia; phase: 'prepared' | 'uploaded' }>;
export type MediaUploadVault = { read(): Promise<unknown>; write(value: PendingMediaUpload): Promise<void>; clear(): Promise<void> };
type Ports = { account(): { id: string; binding: string }; operation(): string; vault: MediaUploadVault; media(epoch: number): Pick<ReturnType<typeof createEncryptedMedia>, 'prepare' | 'restore' | 'upload' | 'cancel'> };
const queues = new WeakMap<MediaUploadVault, Promise<void>>();
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
function fail(code: string): never { throw new Error(code); }

export function validateMediaUpload(value: unknown, binding: string): PendingMediaUpload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VAULT_INVALID');
  const job = value as PendingMediaUpload, prepared = job.prepared, descriptor = prepared?.descriptor;
  if (job.version !== 1 || job.binding !== binding || !identifier(job.circleId) || !Number.isSafeInteger(job.epoch) || job.epoch < 1 || !identifier(job.operationID) || typeof job.uploadAttempted !== 'boolean' || job.phase === 'uploaded' && !job.uploadAttempted || (job.profileRevision !== undefined && (!Number.isSafeInteger(job.profileRevision) || job.profileRevision < 1)) ||
    (job.phase !== 'prepared' && job.phase !== 'uploaded') || !descriptor || descriptor.version !== 1 || !identifier(descriptor.id) ||
    typeof descriptor.key !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.key) || !Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > 2 * 1024 * 1024 ||
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(descriptor.mimeType) || typeof prepared.ciphertext !== 'string' || prepared.ciphertext.length > 8 * 1024 * 1024 ||
    prepared.ciphertext.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(prepared.ciphertext)) fail('VAULT_INVALID');
  let collectionIntent: CollectionUploadIntent | undefined;
  let momentIntent: MomentUploadIntent | undefined;
  let chatImageIntent: ChatImageUploadIntent | undefined;
  let chatStickerIntent: ChatStickerUploadIntent | undefined;
  let profileIntent: ProfileUploadIntent | undefined;
  if (job.collectionIntent !== undefined) {
    const intent = job.collectionIntent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).sort().join(',') !== 'action,id,kind,label,operation,revision' || job.profileRevision !== undefined || job.momentIntent !== undefined || job.chatImageIntent !== undefined || job.chatStickerIntent !== undefined || (intent.action !== 'add' && intent.action !== 'snapshot-refresh') || !identifier(intent.id) || !identifier(intent.operation) || (intent.kind !== 'sticker' && intent.kind !== 'emoji') || !Number.isSafeInteger(intent.revision) || intent.revision < 0 || intent.revision >= Number.MAX_SAFE_INTEGER || typeof intent.label !== 'string' || !intent.label.trim() || intent.label !== intent.label.trim() || [...intent.label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(intent.label) || (intent.kind === 'emoji' && !/^[a-z0-9_]{1,32}$/.test(intent.label))) fail('VAULT_INVALID');
    collectionIntent = Object.freeze({ action: intent.action, id: intent.id, kind: intent.kind, label: intent.label, revision: intent.revision, operation: intent.operation });
  }
  if (job.momentIntent !== undefined) {
    const intent = job.momentIntent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).sort().join(',') !== 'caption,operation' || job.profileRevision !== undefined || job.collectionIntent !== undefined || job.chatImageIntent !== undefined || job.chatStickerIntent !== undefined || !identifier(intent.operation) || typeof intent.caption !== 'string' || [...intent.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(intent.caption)) fail('VAULT_INVALID');
    momentIntent = Object.freeze({ operation: intent.operation, caption: intent.caption.trim() });
  }
  if (job.chatImageIntent !== undefined) {
    const intent = job.chatImageIntent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).sort().join(',') !== 'caption,operation' || job.profileRevision !== undefined || job.collectionIntent !== undefined || job.momentIntent !== undefined || job.chatStickerIntent !== undefined || !identifier(intent.operation) || typeof intent.caption !== 'string' || [...intent.caption].length > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(intent.caption)) fail('VAULT_INVALID');
    chatImageIntent = Object.freeze({ operation: intent.operation, caption: intent.caption.trim() });
  }
  if (job.chatStickerIntent !== undefined) {
    const intent = job.chatStickerIntent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).sort().join(',') !== 'item,label,operation' || job.profileRevision !== undefined || job.collectionIntent !== undefined || job.momentIntent !== undefined || job.chatImageIntent !== undefined || !identifier(intent.operation) || !identifier(intent.item) || typeof intent.label !== 'string' || !intent.label.trim() || intent.label !== intent.label.trim() || [...intent.label].length > 80 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(intent.label)) fail('VAULT_INVALID');
    chatStickerIntent = Object.freeze({ operation: intent.operation, item: intent.item, label: intent.label });
  }
  if (job.profileIntent !== undefined) {
    const intent = job.profileIntent;
    if (!intent || typeof intent !== 'object' || Array.isArray(intent) || Object.keys(intent).sort().join(',') !== 'operation,revision' || job.profileRevision !== intent.revision || collectionIntent !== undefined || momentIntent !== undefined || chatImageIntent !== undefined || chatStickerIntent !== undefined || !identifier(intent.operation) || !Number.isSafeInteger(intent.revision) || intent.revision < 1) fail('VAULT_INVALID');
    profileIntent = Object.freeze({ operation: intent.operation, revision: intent.revision });
  } else if (job.profileRevision !== undefined && collectionIntent === undefined && momentIntent === undefined && chatImageIntent === undefined && chatStickerIntent === undefined) fail('VAULT_INVALID');
  const operationID = profileIntent?.operation ?? collectionIntent?.operation ?? momentIntent?.operation ?? chatImageIntent?.operation ?? chatStickerIntent?.operation ?? job.operationID;
  if (!identifier(operationID) || [profileIntent?.operation, collectionIntent?.operation, momentIntent?.operation, chatImageIntent?.operation, chatStickerIntent?.operation].some(operation => operation !== undefined && operation !== operationID)) fail('VAULT_INVALID');
  return Object.freeze({ version: 1, binding, circleId: job.circleId, epoch: job.epoch, operationID, uploadAttempted: job.uploadAttempted, phase: job.phase, ...(collectionIntent === undefined ? {} : { collectionIntent }), ...(profileIntent === undefined ? {} : { profileIntent }), ...(job.profileRevision === undefined ? {} : { profileRevision: job.profileRevision }),
    ...(momentIntent === undefined ? {} : { momentIntent }), ...(chatImageIntent === undefined ? {} : { chatImageIntent }), ...(chatStickerIntent === undefined ? {} : { chatStickerIntent }),
    prepared: Object.freeze({ descriptor: Object.freeze({ version: 1, id: descriptor.id, key: descriptor.key, size: descriptor.size, mimeType: descriptor.mimeType }), ciphertext: prepared.ciphertext }) });
}

export function createCircleMediaUpload(ports: Ports, circleId: string) {
  if (!identifier(circleId)) fail('INVALID_INPUT');
  const bound = { ...ports.account() };
  function check() { const current = ports.account(); if (current.id !== bound.id || current.binding !== bound.binding) fail('SESSION_CHANGED'); }
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = (queues.get(ports.vault) ?? Promise.resolve()).then(async () => { check(); const value = await work(); check(); return value; });
    queues.set(ports.vault, result.then(() => {}, () => {})); return result;
  }
  async function pending() {
    const value = await ports.vault.read(); check(); if (value === null) return undefined;
    const job = validateMediaUpload(value, bound.binding);
    if (job.circleId !== circleId) fail('VAULT_INVALID');
    return job;
  }
  async function save(job: PendingMediaUpload) { check(); await ports.vault.write(job); check(); }
  return {
    pending: () => serial(pending),
    prepare: (input: { bytes: Uint8Array; mimeType: string }, epoch: number, profileRevision?: number, collectionIntent?: CollectionUploadIntent, momentIntent?: MomentUploadIntent, chatImageIntent?: ChatImageUploadIntent, chatStickerIntent?: ChatStickerUploadIntent, requestedOperation?: string) => {
      const intent = collectionIntent === undefined ? undefined : Object.freeze({ ...collectionIntent });
      const moment = momentIntent === undefined ? undefined : Object.freeze({ ...momentIntent });
      const chatImage = chatImageIntent === undefined ? undefined : Object.freeze({ ...chatImageIntent });
      const chatSticker = chatStickerIntent === undefined ? undefined : Object.freeze({ ...chatStickerIntent });
      return serial(async () => {
      if (await pending()) fail('MEDIA_PENDING');
      if (!Number.isSafeInteger(epoch) || epoch < 1) fail('INVALID_INPUT');
      const prepared = await ports.media(epoch).prepare(input); check();
      const operationID = requestedOperation ?? intent?.operation ?? moment?.operation ?? chatImage?.operation ?? chatSticker?.operation ?? ports.operation();
      if (requestedOperation !== undefined && [intent?.operation, moment?.operation, chatImage?.operation, chatSticker?.operation].some(operation => operation !== undefined && operation !== requestedOperation)) fail('INVALID_INPUT');
      const profileIntent = profileRevision === undefined ? undefined : Object.freeze({ operation: operationID, revision: profileRevision });
      const job = validateMediaUpload({ version: 1, binding: bound.binding, circleId, epoch, operationID, uploadAttempted: false, prepared, phase: 'prepared', ...(intent === undefined ? {} : { collectionIntent: intent }), ...(profileIntent === undefined ? {} : { profileIntent }), ...(moment === undefined ? {} : { momentIntent: moment }), ...(chatImage === undefined ? {} : { chatImageIntent: chatImage }), ...(chatSticker === undefined ? {} : { chatStickerIntent: chatSticker }), ...(profileRevision === undefined ? {} : { profileRevision }) }, bound.binding);
      await save(job); return job;
      });
    },
    upload: () => serial(async () => {
      const job = await pending(); if (!job) fail('NO_PENDING_MEDIA');
      const media = ports.media(job.epoch), restored = await media.restore(job.prepared); check();
      if (job.phase === 'uploaded') return restored.descriptor;
      const attemptedJob = job.uploadAttempted ? job : Object.freeze({ ...job, uploadAttempted: true });
      if (attemptedJob !== job) await save(attemptedJob);
      const result = await media.upload(restored, job.operationID); check();
      if (JSON.stringify(result) !== JSON.stringify(job.prepared.descriptor)) fail('INVALID_RESPONSE');
      await save(Object.freeze({ ...attemptedJob, phase: 'uploaded' })); return result;
    }),
    release: (expected: PendingMediaUpload) => {
      let original: PendingMediaUpload;
      try { original = validateMediaUpload(expected, bound.binding); } catch { return Promise.reject(new Error('MEDIA_CONFLICT')); }
      return serial(async () => {
        const job = await pending(); if (!job) return;
        if (JSON.stringify(job) !== JSON.stringify(original)) fail('MEDIA_CONFLICT');
        if (job.uploadAttempted) fail('UPLOAD_CANCELLATION_REQUIRED');
        await ports.vault.clear(); check();
      });
    },
    cancel: (): Promise<OperationCancellation> => serial(async () => {
      const job = await pending(); if (!job) return Object.freeze({ state: 'cancelled' });
      if (!job.uploadAttempted) { await ports.vault.clear(); check(); return Object.freeze({ state: 'cancelled' }); }
      const result = await ports.media(job.epoch).cancel(job.operationID); check();
      if (result.state === 'cancelled') { await ports.vault.clear(); check(); }
      return result;
    }),
    acknowledge: () => serial(async () => {
      const job = await pending(); if (job?.phase !== 'uploaded') fail('MEDIA_PENDING');
      await ports.vault.clear(); check();
    }),
  };
}
