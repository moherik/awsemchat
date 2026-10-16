import type { createHistoryBackup } from './history-backup';
import type { createDriveAPI } from './drive-api';
export type PendingBackup = {
  version: 1; binding: string; archive: string; recoveryKey: string; records: number;
  id: string | null; uploadURI: string | null; phase: 'prepared' | 'uploaded';
};
export type PendingBackupVault = { read(): Promise<PendingBackup | null>; write(job: PendingBackup): Promise<void>; clear(): Promise<void> };
const queues = new WeakMap<PendingBackupVault, Promise<unknown>>();
export function createDriveBackup(history: Pick<ReturnType<typeof createHistoryBackup>, 'create'>,
  api: Pick<ReturnType<typeof createDriveAPI>, 'generateId' | 'beginUpload' | 'upload' | 'uploadStatus' | 'download'>,
  vault: PendingBackupVault, binding: () => string) {
  function guard(bound: string) { if (binding() !== bound) throw new Error('SESSION_REVOKED'); }
  function serial<T>(work: (bound: string) => Promise<T>) {
    const bound = binding();
    const result = (queues.get(vault) ?? Promise.resolve()).then(async () => { guard(bound); return work(bound); });
    queues.set(vault, result.catch(() => {}));
    return result;
  }
  async function read(bound: string) {
    const job = await vault.read();
    guard(bound);
    if (job && job.binding !== bound) throw new Error('SESSION_REVOKED');
    return job;
  }
  async function persist(bound: string, job: PendingBackup) {
    guard(bound);
    await vault.write(job);
    guard(bound);
  }
  const result = (job: PendingBackup) => ({ phase: job.phase, records: job.records, recoveryKey: job.recoveryKey, id: job.id });
  return {
    prepare: () => serial(async bound => {
      const pending = await read(bound);
      if (pending) return result(pending);
      let archive = '';
      const saved = await history.create(async bytes => { guard(bound); archive = bytes; });
      guard(bound);
      const job: PendingBackup = { version: 1, binding: bound, archive, ...saved, id: null, uploadURI: null, phase: 'prepared' };
      await persist(bound, job);
      return result(job);
    }),
    upload: () => serial(async bound => {
      let job = await read(bound);
      if (!job) throw new Error('NO_PENDING_BACKUP');
      if (job.phase === 'uploaded') return result(job);
      if (!job.id) {
        const id = await api.generateId();
        guard(bound);
        job = { ...job, id };
        await persist(bound, job);
      }
      const id = job.id!;
      try {
        let offset = 0;
        let complete = false;
        if (job.uploadURI) {
          const status = await api.uploadStatus(id, job.uploadURI, job.archive.length);
          guard(bound);
          if (status.phase === 'complete') complete = true;
          else if (status.phase === 'expired') {
            job = { ...job, uploadURI: null };
            await persist(bound, job);
          } else offset = status.offset;
        }
        if (!job.uploadURI) {
          const uploadURI = await api.beginUpload(id, job.archive.length);
          guard(bound);
          job = { ...job, uploadURI };
          await persist(bound, job);
        }
        if (!complete) await api.upload(id, job.uploadURI!, job.archive, offset);
        guard(bound);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'DRIVE_CONFLICT') throw error;
        guard(bound);
        const existing = await api.download(id);
        guard(bound);
        if (existing !== job.archive) throw new Error('BACKUP_CONFLICT');
      }
      job = { ...job, phase: 'uploaded' };
      await persist(bound, job);
      return result(job);
    }),
    acknowledge: () => serial(async bound => {
      const job = await read(bound);
      if (!job || job.phase !== 'uploaded') throw new Error('BACKUP_PENDING');
      guard(bound);
      await vault.clear();
      guard(bound);
    }),
  };
}
