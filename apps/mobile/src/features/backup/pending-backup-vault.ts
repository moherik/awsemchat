import type { PendingBackup, PendingBackupVault } from './drive-backup';
export type PendingVaultPorts = {
  readMetadata(): Promise<string | null>; writeMetadata(value: string): Promise<void>; clearMetadata(): Promise<void>;
  writeFile(name: string, bytes: string): Promise<void>; readFile(name: string): Promise<string>; removeFile(name: string): Promise<void>;
  digest(bytes: string): Promise<string>; name(): string;
};
type Metadata = Omit<PendingBackup, 'archive'> & { file: string; digest: string };
function invalid(): never { throw new Error('VAULT_INVALID'); }
function validate(value: unknown): asserts value is Metadata {
  if (!value || typeof value !== 'object') return invalid();
  const data = value as Metadata;
  if (data.version !== 1 || typeof data.binding !== 'string' || !data.binding || data.binding.length > 256 ||
    typeof data.recoveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(data.recoveryKey) ||
    !Number.isSafeInteger(data.records) || data.records < 0 || data.records > 768 ||
    !/^[a-f0-9]{64}$/.test(data.digest) || !/^[a-z0-9-]{1,140}\.bin$/.test(data.file) ||
    (data.id !== null && (typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(data.id))) ||
    (data.uploadURI !== null && (typeof data.uploadURI !== 'string' || data.uploadURI.length > 4096)) ||
    (data.phase !== 'prepared' && data.phase !== 'uploaded') || (data.phase === 'uploaded' && !data.id)) return invalid();
}
export function createPendingBackupVault(ports: PendingVaultPorts, binding: string): PendingBackupVault {
  async function metadata(): Promise<Metadata | null> {
    const raw = await ports.readMetadata();
    if (raw === null) return null;
    let data: unknown;
    try { data = JSON.parse(raw); } catch { return invalid(); }
    validate(data);
    if (data.binding !== binding) throw new Error('SESSION_REVOKED');
    return data;
  }
  return {
    async read() {
      const saved = await metadata();
      if (!saved) return null;
      let archive: string;
      try { archive = await ports.readFile(saved.file); } catch { return invalid(); }
      if (archive.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(archive) || await ports.digest(archive) !== saved.digest) return invalid();
      const { file: _file, digest: _digest, ...job } = saved;
      return { ...job, archive };
    },
    async write(job) {
      if (job.binding !== binding) throw new Error('SESSION_REVOKED');
      const prior = await metadata();
      if (!job.archive || job.archive.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(job.archive)) return invalid();
      const digest = await ports.digest(job.archive);
      if (prior && (prior.digest !== digest || prior.recoveryKey !== job.recoveryKey || prior.records !== job.records ||
        (prior.id !== null && prior.id !== job.id) || (prior.phase === 'uploaded' && job.phase !== 'uploaded'))) throw new Error('OPERATION_CONFLICT');
      if (prior && await ports.digest(await ports.readFile(prior.file)) !== prior.digest) return invalid();
      const file = prior?.digest === digest ? prior.file : ports.name();
      const { archive: _archive, ...data } = job;
      const saved = { ...data, file, digest };
      validate(saved);
      if (prior?.digest !== digest) {
        await ports.writeFile(file, job.archive);
        if (await ports.digest(await ports.readFile(file)) !== digest) return invalid();
      }
      // A lost SecureStore reply may follow a committed pointer: retain its ciphertext.
      await ports.writeMetadata(JSON.stringify(saved));
      if (prior && prior.file !== file) await ports.removeFile(prior.file);
    },
    async clear() {
      const prior = await metadata();
      await ports.clearMetadata();
      if (prior) await ports.removeFile(prior.file);
    },
  };
}
