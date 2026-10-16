import { validateSnapshotPublication, type SnapshotPublicationVault, type SnapshotPublication } from './collection-snapshot-publisher.ts';
import type { CircleCreationStorage } from './circle-creation-vault';
type Pointer = { version: 1; binding: string; circleId: string; file: string; recoveryKey: string };
const context = 'awsemchat.collection.snapshot-publication.v1';
function invalid(): never { throw new Error('VAULT_INVALID'); }
export function createSnapshotPublicationVault(ports: CircleCreationStorage, binding: string, circleId: string): SnapshotPublicationVault {
  if (!/^[a-f0-9]{64}$/.test(binding)) invalid();
  async function pointer(): Promise<Pointer | null> {
    const raw = await ports.readMetadata(); if (raw === null) return null;
    if (raw.length > 2048) invalid();
    try {
      const value = JSON.parse(raw);
      if (!value || Object.keys(value).sort().join(',') !== 'binding,circleId,file,recoveryKey,version' || value.version !== 1 || value.binding !== binding || value.circleId !== circleId || typeof value.file !== 'string' || !/^[a-z0-9-]{1,140}\.bin$/.test(value.file) || typeof value.recoveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.recoveryKey)) invalid();
      return value;
    } catch { return invalid(); }
  }
  async function load(saved: Pointer): Promise<SnapshotPublication> {
    try {
      const archive = await ports.readFile(saved.file);
      if (typeof archive !== 'string' || archive.length > 8 * 1024 * 1024) invalid();
      const { records } = await ports.codec.decode(binding, archive, saved.recoveryKey);
      if (!records.length || records.length > 256) invalid();
      const parts = [], operations = [];
      for (const [index, record] of records.entries()) {
        if (record.eventId !== `part-${index}` || record.conversationId !== context || record.membershipInterval !== circleId || record.receivedAt !== 0 || record.originalAudience.length !== 1 || record.originalAudience[0] !== binding || record.payload.length > 32 * 1024) invalid();
        const value = JSON.parse(record.payload);
        if (Object.keys(value).sort().join(',') !== 'operation,part') invalid();
        parts.push(value.part); operations.push(value.operation);
      }
      return validateSnapshotPublication({ version: 1, binding, circleId, parts, operations }, binding, circleId);
    } catch { return invalid(); }
  }
  return {
    async read() { const saved = await pointer(); return saved ? load(saved) : null; },
    async write(input) {
      const job = validateSnapshotPublication(input, binding, circleId), prior = await pointer();
      if (prior) { if (JSON.stringify(await load(prior)) !== JSON.stringify(job)) throw new Error('OPERATION_CONFLICT'); return; }
      const sealed = await ports.codec.encode(binding, job.parts.map((part, index) => ({ eventId: `part-${index}`, conversationId: context, membershipInterval: circleId, originalAudience: [binding], receivedAt: 0, payload: JSON.stringify({ part, operation: job.operations[index] }) })));
      const file = ports.name(); if (!/^[a-z0-9-]{1,140}\.bin$/.test(file)) invalid();
      const saved: Pointer = { version: 1, binding, circleId, file, recoveryKey: sealed.recoveryKey };
      await ports.writeFile(file, sealed.archive); await load(saved);
      await ports.writeMetadata(JSON.stringify(saved));
    },
    async clear() { const saved = await pointer(); if (saved) await load(saved); await ports.clearMetadata(); if (saved) await ports.removeFile(saved.file); },
  };
}
