import { assembleCollectionSnapshot, prepareCollectionSnapshot, type SnapshotPart } from './collection-snapshot.ts';
import type { MessageDraft } from '../messages/send';
import type { SentEvent } from '../messages/api';
export type SnapshotPublication = Readonly<{ version: 1; binding: string; circleId: string; parts: readonly SnapshotPart[]; operations: readonly string[] }>;
export type SnapshotPublicationVault = { read(): Promise<unknown>; write(value: SnapshotPublication): Promise<void>; clear(): Promise<void> };
type Ports = { account(): string; operation(): string; vault: SnapshotPublicationVault; send(draft: MessageDraft): Promise<SentEvent> };
const queues = new WeakMap<SnapshotPublicationVault, Promise<unknown>>();
function fail(code: string): never { throw new Error(code); }
function copyParts(value: unknown): readonly SnapshotPart[] {
  if (!Array.isArray(value) || !value.length || value.length > 256) fail('INVALID_SNAPSHOT');
  const first = value[0] as SnapshotPart;
  const topology = value.flatMap((part: SnapshotPart) => { if (!Array.isArray(part?.items)) fail('INVALID_SNAPSHOT'); return part.items.map(({ id, kind }) => ({ id, kind })); });
  const assembled = assembleCollectionSnapshot(first, value, topology);
  if (assembled.state !== 'ready') fail('INVALID_SNAPSHOT');
  const copied = prepareCollectionSnapshot(first, assembled.items, topology, value.map(part => part.items.length));
  // Preserve the original part boundaries: exact ciphertext retries depend on them.
  if (copied.length !== value.length || value.some((part, index) => part.part !== index || part.parts !== value.length || part.items.length > 50)) fail('INVALID_SNAPSHOT');
  const byId = new Map(assembled.items.map(entry => [entry.id, entry]));
  return Object.freeze(value.map(part => Object.freeze({ version: 1 as const, snapshot: part.snapshot, circleId: part.circleId, epoch: part.epoch, revision: part.revision, part: part.part, parts: part.parts, items: Object.freeze(part.items.map((entry: SnapshotPart['items'][number]) => {
    const owned = byId.get(entry.id)!;
    return owned;
  })) })));
}
export function validateSnapshotPublication(value: unknown, binding: string, circleId: string): SnapshotPublication {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VAULT_INVALID');
  const raw = value as SnapshotPublication;
  if (Object.keys(raw).sort().join(',') !== 'binding,circleId,operations,parts,version' || raw.version !== 1 || raw.binding !== binding || raw.circleId !== circleId || !Array.isArray(raw.operations)) fail('VAULT_INVALID');
  let parts: readonly SnapshotPart[]; try { parts = copyParts(raw.parts); } catch { return fail('VAULT_INVALID'); }
  if (parts[0].circleId !== circleId || raw.operations.length !== parts.length || new Set(raw.operations).size !== parts.length || raw.operations.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id) || id === '.' || id === '..')) fail('VAULT_INVALID');
  return Object.freeze({ version: 1, binding, circleId, parts, operations: Object.freeze([...raw.operations]) });
}
export function createCollectionSnapshotPublisher(ports: Ports, circleId: string) {
  const binding = ports.account();
  function check() { if (ports.account() !== binding) fail('SESSION_CHANGED'); }
  async function checked<T>(job: () => Promise<T>) { check(); const value = await job(); check(); return value; }
  function serial<T>(job: () => Promise<T>) { const result = (queues.get(ports.vault) ?? Promise.resolve()).then(() => { check(); return job(); }); queues.set(ports.vault, result.catch(() => {})); return result; }
  async function pending() { const value = await checked(ports.vault.read); return value === null ? undefined : validateSnapshotPublication(value, binding, circleId); }
  async function resume() {
    const job = await pending(); if (!job) return;
    for (const part of job.parts) {
      const operation = job.operations[part.part];
      const event = await checked(() => ports.send({ circleId, expectedEpoch: part.epoch, operation, plaintext: JSON.stringify(part), contentType: 'circle-collection-snapshot', collectionRevision: part.revision, collectionSnapshot: { id: part.snapshot, part: part.part, parts: part.parts, items: part.items.map(({ id, kind }) => ({ id, kind })) } }));
      if (event.operation !== operation) fail('INVALID_RESPONSE');
    }
    await checked(ports.vault.clear);
  }
  return {
    pending: () => serial(pending),
    resume: () => serial(resume),
    publish(input: readonly SnapshotPart[], operationIDs?: readonly string[]) {
      let parts: readonly SnapshotPart[]; try { parts = copyParts(input); } catch (error) { return Promise.reject(error); }
      return serial(async () => {
        if (await pending()) fail('SNAPSHOT_PENDING');
        const operations = operationIDs ?? parts.map(() => ports.operation());
        if (operations.length !== parts.length || operations.some(id => typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(id) || id === '.' || id === '..')) fail('INVALID_SNAPSHOT');
        const job = validateSnapshotPublication({ version: 1, binding, circleId, parts, operations }, binding, circleId);
        await checked(() => ports.vault.write(job));
        await resume();
      });
    },
  };
}
