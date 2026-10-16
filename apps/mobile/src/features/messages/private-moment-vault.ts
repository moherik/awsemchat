import type { PreparedMedia } from '../media/encrypted-media.ts';
import { validateMediaDescriptor } from '../media/encrypted-media.ts';
import type { PrivateMomentVaultValue } from './private-moment-editor';

export type PrivateVaultStorage = { readMetadata(): Promise<string | null>; writeMetadata(value: string): Promise<void>; clearMetadata(): Promise<void>; writeFile(name: string, value: string): Promise<void>; readFile(name: string): Promise<string>; removeFile(name: string): Promise<void>; digest(value: string): Promise<string>; name(): string };
type Metadata = Omit<PrivateMomentVaultValue, 'prepared'> & { descriptor: PreparedMedia['descriptor']; file: string; digest: string };
function invalid(): never { throw new Error('VAULT_INVALID'); }
export function createPrivateMomentVault(ports: PrivateVaultStorage, binding: string, peerId: string) {
  if (!/^[a-f0-9]{64}$/.test(binding) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId)) invalid();
  async function metadata(): Promise<Metadata | null> {
    const raw = await ports.readMetadata(); if (raw === null) return null; if (raw.length > 2048) invalid();
    let value: Metadata; try { value = JSON.parse(raw); } catch { return invalid(); }
    if (!value || Object.keys(value).sort().join(',') !== 'audience,binding,caption,conversation,descriptor,digest,file,operation,peerId,uploadAttempted,version' || value.version !== 1 || value.binding !== binding || value.peerId !== peerId || typeof value.file !== 'string' || !/^[a-z0-9-]{1,140}\.bin$/.test(value.file) || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest) || typeof value.conversation !== 'string' || !/^private:[a-f0-9]{64}$/.test(value.conversation) || typeof value.audience !== 'string' || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.audience) || typeof value.operation !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value.operation) || typeof value.caption !== 'string' || [...value.caption].length > 280 || typeof value.uploadAttempted !== 'boolean') invalid();
    try { value.descriptor = validateMediaDescriptor(value.descriptor); } catch { return invalid(); }
    return value;
  }
  async function load(value: Metadata): Promise<PrivateMomentVaultValue> {
    let ciphertext: string; try { ciphertext = await ports.readFile(value.file); } catch { return invalid(); }
    if (await ports.digest(ciphertext) !== value.digest) invalid();
    return Object.freeze({ version: 1, binding, peerId, conversation: value.conversation, audience: value.audience, operation: value.operation, caption: value.caption, uploadAttempted: value.uploadAttempted, prepared: Object.freeze({ descriptor: Object.freeze({ ...value.descriptor }), ciphertext }) });
  }
  return {
    async read() { const saved = await metadata(); return saved ? load(saved) : null; },
    async write(input: PrivateMomentVaultValue) {
      const prior = await metadata(), digest = await ports.digest(input.prepared.ciphertext); if (!/^[a-f0-9]{64}$/.test(digest)) invalid();
      const file = prior?.file ?? ports.name(); if (!/^[a-z0-9-]{1,140}\.bin$/.test(file)) invalid();
      if (prior) {
        const existing = await load(prior);
        if (prior.operation !== input.operation || prior.conversation !== input.conversation || prior.audience !== input.audience || prior.caption !== input.caption || prior.digest !== digest || JSON.stringify(prior.descriptor) !== JSON.stringify(input.prepared.descriptor) || prior.uploadAttempted && !input.uploadAttempted) throw new Error('OPERATION_CONFLICT');
        if (existing.prepared.ciphertext !== input.prepared.ciphertext) throw new Error('OPERATION_CONFLICT');
      } else { await ports.writeFile(file, input.prepared.ciphertext); }
      const value: Metadata = { version: 1, binding, peerId, conversation: input.conversation, audience: input.audience, operation: input.operation, caption: input.caption, uploadAttempted: input.uploadAttempted, descriptor: input.prepared.descriptor, file, digest };
      const raw = JSON.stringify(value); if (raw.length > 2048) invalid(); await ports.writeMetadata(raw);
    },
    async clear() { const saved = await metadata(); await ports.clearMetadata(); if (saved) await ports.removeFile(saved.file); },
  };
}
