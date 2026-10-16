import type { ArchiveCodec } from '../backup/history-backup';
import type { CircleCreationVault, PendingCircleCreation } from './circle-creation';

export type CircleCreationStorage = {
  readMetadata(): Promise<string | null>;
  writeMetadata(value: string): Promise<void>;
  clearMetadata(): Promise<void>;
  writeFile(name: string, bytes: string): Promise<void>;
  readFile(name: string): Promise<string>;
  removeFile(name: string): Promise<void>;
  name(): string;
  codec: ArchiveCodec;
};
type Pointer = { version: 1; binding: string; file: string; recoveryKey: string };
const context = 'awsemchat.pending-circle.v1';
function invalid(): never { throw new Error('VAULT_INVALID'); }
export function createCircleCreationVault(ports: CircleCreationStorage, binding: string): CircleCreationVault {
  if (!/^[a-f0-9]{64}$/.test(binding)) invalid();
  async function pointer(): Promise<Pointer | null> {
    const raw = await ports.readMetadata();
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      if (!value || value.version !== 1 || value.binding !== binding ||
        Object.keys(value).sort().join(',') !== 'binding,file,recoveryKey,version' ||
        typeof value.file !== 'string' || !/^[a-z0-9-]{1,140}\.bin$/.test(value.file) ||
        typeof value.recoveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.recoveryKey)) invalid();
      return value;
    } catch { return invalid(); }
  }
  async function load(saved: Pointer): Promise<unknown> {
    try {
      const archive = await ports.readFile(saved.file);
      if (archive.length > 128 * 1024) invalid();
      const { records } = await ports.codec.decode(binding, archive, saved.recoveryKey);
      if (records.length !== 1) invalid();
      const record = records[0];
      if (record.eventId !== 'creation' || record.conversationId !== context || record.membershipInterval !== context ||
        record.receivedAt !== 0 || record.originalAudience.length !== 1 || record.originalAudience[0] !== binding ||
        record.payload.length > 32 * 1024) invalid();
      const value = JSON.parse(record.payload);
      if (!value || value.binding !== binding) invalid();
      return value;
    } catch { return invalid(); }
  }
  return {
    async read() { const saved = await pointer(); return saved ? load(saved) : null; },
    async write(record: PendingCircleCreation) {
      if (record.binding !== binding) invalid();
      const prior = await pointer();
      if (prior) await load(prior);
      const payload = JSON.stringify(record);
      if (payload.length > 32 * 1024) invalid();
      const sealed = await ports.codec.encode(binding, [{ eventId: 'creation', conversationId: context,
        originalAudience: [binding], membershipInterval: context, receivedAt: 0, payload }]);
      const file = ports.name();
      if (!/^[a-z0-9-]{1,140}\.bin$/.test(file) || file === prior?.file) invalid();
      const saved: Pointer = { version: 1, binding, file, recoveryKey: sealed.recoveryKey };
      await ports.writeFile(file, sealed.archive);
      await load(saved);
      // An uncertain pointer commit must retain the new ciphertext for recovery.
      await ports.writeMetadata(JSON.stringify(saved));
      if (prior) await ports.removeFile(prior.file);
    },
    async clear() {
      const prior = await pointer();
      if (prior) await load(prior);
      await ports.clearMetadata();
      if (prior) await ports.removeFile(prior.file);
    },
  };
}
