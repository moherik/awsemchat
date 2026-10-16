import { validateMediaUpload, type MediaUploadVault, type PendingMediaUpload } from './upload.ts';

export type UploadStorage = {
  readMetadata(): Promise<string | null>; writeMetadata(value: string): Promise<void>; clearMetadata(): Promise<void>;
  writeFile(name: string, ciphertext: string): Promise<void>; readFile(name: string): Promise<string>; removeFile(name: string): Promise<void>;
  digest(ciphertext: string): Promise<string>; name(): string;
};
type Metadata = Omit<PendingMediaUpload, 'prepared'> & { descriptor: PendingMediaUpload['prepared']['descriptor']; file: string; digest: string };
function invalid(): never { throw new Error('VAULT_INVALID'); }

export function createMediaUploadVault(ports: UploadStorage, binding: string): MediaUploadVault {
  if (!/^[a-f0-9]{64}$/.test(binding)) invalid();
  async function metadata(): Promise<Metadata | null> {
    const raw = await ports.readMetadata(); if (raw === null) return null;
    if (raw.length > 2048) invalid();
    let data: Metadata;
    try { data = JSON.parse(raw); } catch { return invalid(); }
    if (!data || data.binding !== binding || typeof data.file !== 'string' || !/^[a-z0-9-]{1,140}\.bin$/.test(data.file) ||
      typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest) ||
      Object.keys(data).sort().join(',') !== ['binding', 'circleId', 'descriptor', 'digest', 'epoch', 'file', 'operationID', 'phase', 'uploadAttempted', 'version', ...(data.profileRevision === undefined ? [] : ['profileRevision']), ...(data.profileIntent === undefined ? [] : ['profileIntent']), ...(data.collectionIntent === undefined ? [] : ['collectionIntent']), ...(data.momentIntent === undefined ? [] : ['momentIntent']), ...(data.chatImageIntent === undefined ? [] : ['chatImageIntent']), ...(data.chatStickerIntent === undefined ? [] : ['chatStickerIntent'])].sort().join(',')) invalid();
    return data;
  }
  async function load(data: Metadata): Promise<PendingMediaUpload> {
    let ciphertext: string;
    try { ciphertext = await ports.readFile(data.file); } catch { return invalid(); }
    const job = validateMediaUpload({ version: data.version, binding, circleId: data.circleId, epoch: data.epoch, phase: data.phase, operationID: data.operationID, uploadAttempted: data.uploadAttempted, profileRevision: data.profileRevision, profileIntent: data.profileIntent, collectionIntent: data.collectionIntent, momentIntent: data.momentIntent, chatImageIntent: data.chatImageIntent, chatStickerIntent: data.chatStickerIntent, prepared: { descriptor: data.descriptor, ciphertext } }, binding);
    if (await ports.digest(ciphertext) !== data.digest) invalid();
    return job;
  }
  return {
    async read() { const saved = await metadata(); return saved ? load(saved) : null; },
    async write(input) {
      const job = validateMediaUpload(input, binding), prior = await metadata();
      const digest = await ports.digest(job.prepared.ciphertext);
      if (!/^[a-f0-9]{64}$/.test(digest)) invalid();
      if (prior) {
        const previous = await load(prior);
        if (prior.circleId !== job.circleId || prior.epoch !== job.epoch || prior.operationID !== job.operationID || prior.profileRevision !== job.profileRevision || JSON.stringify(prior.profileIntent) !== JSON.stringify(job.profileIntent) || JSON.stringify(prior.collectionIntent) !== JSON.stringify(job.collectionIntent) || JSON.stringify(prior.momentIntent) !== JSON.stringify(job.momentIntent) || JSON.stringify(prior.chatImageIntent) !== JSON.stringify(job.chatImageIntent) || JSON.stringify(prior.chatStickerIntent) !== JSON.stringify(job.chatStickerIntent) || prior.digest !== digest || prior.uploadAttempted && !job.uploadAttempted ||
          JSON.stringify(previous.prepared.descriptor) !== JSON.stringify(job.prepared.descriptor) || prior.phase === 'uploaded' && job.phase !== 'uploaded') throw new Error('OPERATION_CONFLICT');
      }
      const file = prior?.file ?? ports.name();
      if (!/^[a-z0-9-]{1,140}\.bin$/.test(file)) invalid();
      const saved: Metadata = { version: 1, binding, circleId: job.circleId, epoch: job.epoch, operationID: job.operationID, uploadAttempted: job.uploadAttempted, phase: job.phase, descriptor: job.prepared.descriptor, file, digest, ...(job.profileIntent === undefined ? {} : { profileIntent: job.profileIntent }), ...(job.collectionIntent === undefined ? {} : { collectionIntent: job.collectionIntent }), ...(job.momentIntent === undefined ? {} : { momentIntent: job.momentIntent }), ...(job.chatImageIntent === undefined ? {} : { chatImageIntent: job.chatImageIntent }), ...(job.chatStickerIntent === undefined ? {} : { chatStickerIntent: job.chatStickerIntent }), ...(job.profileRevision === undefined ? {} : { profileRevision: job.profileRevision }) };
      const raw = JSON.stringify(saved); if (raw.length > 2048) invalid();
      if (!prior) { await ports.writeFile(file, job.prepared.ciphertext); await load(saved); }
      // A lost protected-pointer reply must leave the referenced ciphertext intact.
      await ports.writeMetadata(raw);
    },
    async clear() {
      const saved = await metadata(); if (saved) await load(saved);
      await ports.clearMetadata(); if (saved) await ports.removeFile(saved.file);
    },
  };
}
