import type { createSocialAPI } from './api';
import type { createAccountSender } from '../messages/account-sender';
import { decodeCircleProfile, encodeCircleProfile } from './circle-profile.ts';
export type CircleCreationDraft = { name: string; description: string; avatar: null; invitees: readonly string[] };
export type PendingCircleCreation = Readonly<{ version: 1; binding: string; createOperation: string; profileOperation: string; payload: string; invitees: readonly string[]; circleId?: string; profileSent: boolean; completed: boolean }>;
export type CircleCreationVault = { read(): Promise<unknown>; write(record: PendingCircleCreation): Promise<void>; clear(): Promise<void> };
type Ports = { vault: CircleCreationVault; binding(): string; operation(): string; api: Pick<ReturnType<typeof createSocialAPI>, 'createCircle' | 'circle' | 'invite'>; sender: Pick<ReturnType<typeof createAccountSender>, 'send'> };
const queues = new WeakMap<CircleCreationVault, Promise<void>>();
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function invitees(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 19 || value.some(item => !id(item)) || new Set(value).size !== value.length) fail('INVALID_INPUT');
  return Object.freeze([...value]);
}
export function createCircleCreation(ports: Ports) {
  function check(binding: string) { if (ports.binding() !== binding) fail('SESSION_CHANGED'); }
  function serial<T>(job: (binding: string) => Promise<T>): Promise<T> {
    let binding: string;
    try { binding = ports.binding(); } catch (error) { return Promise.reject(error); }
    const result = (queues.get(ports.vault) ?? Promise.resolve()).then(() => { check(binding); return job(binding); });
    queues.set(ports.vault, result.then(() => {}, () => {}));
    return result;
  }
  async function read(binding: string): Promise<PendingCircleCreation | undefined> {
    const value = await ports.vault.read(); check(binding);
    if (value === null) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VAULT_INVALID');
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || data.binding !== binding || !id(data.createOperation) || !id(data.profileOperation) || data.createOperation === data.profileOperation || typeof data.payload !== 'string' || !decodeCircleProfile(data.payload) || typeof data.profileSent !== 'boolean' || typeof data.completed !== 'boolean' || (data.circleId !== undefined && !id(data.circleId)) || (data.profileSent && data.circleId === undefined) || (data.completed && !data.profileSent)) fail('VAULT_INVALID');
    return Object.freeze({ version: 1, binding, createOperation: data.createOperation, profileOperation: data.profileOperation, payload: data.payload, invitees: invitees(data.invitees), ...(data.circleId === undefined ? {} : { circleId: data.circleId as string }), profileSent: data.profileSent, completed: data.completed });
  }
  async function save(record: PendingCircleCreation) { check(record.binding); await ports.vault.write(record); check(record.binding); }
  async function run(initial: PendingCircleCreation) {
    let record = initial;
    if (record.completed) return { circleId: record.circleId! };
    if (!record.circleId) {
      const circle = await ports.api.createCircle(record.createOperation); check(record.binding);
      if (circle.closed) fail('CIRCLE_CLOSED');
      record = Object.freeze({ ...record, circleId: circle.id }); await save(record);
    }
    const circleId = record.circleId!;
    if (!record.profileSent) {
      await ports.sender.send({ circleId, operation: record.profileOperation, plaintext: record.payload, contentType: 'circle-profile', profileRevision: 1 }); check(record.binding);
      record = Object.freeze({ ...record, profileSent: true }); await save(record);
    }
    const details = await ports.api.circle(circleId); check(record.binding);
    for (const peer of record.invitees) {
      if (details.members.some(member => member.accountId === peer)) continue;
      await ports.api.invite(circleId, peer); check(record.binding);
    }
    await save(Object.freeze({ ...record, completed: true }));
    return { circleId };
  }
  return {
    pending: () => serial(read),
    start: (draft: CircleCreationDraft) => serial(async binding => {
      const selected = invitees(draft.invitees);
      const payload = encodeCircleProfile({ name: draft.name, description: draft.description, avatar: draft.avatar });
      if (await read(binding)) fail('CREATION_PENDING');
      const createOperation = ports.operation(), profileOperation = ports.operation();
      if (!id(createOperation) || !id(profileOperation) || createOperation === profileOperation) fail('INVALID_INPUT');
      const record: PendingCircleCreation = Object.freeze({ version: 1, binding, createOperation, profileOperation, payload, invitees: selected, profileSent: false, completed: false });
      await save(record); return run(record);
    }),
    resume: () => serial(async binding => { const record = await read(binding); if (!record) fail('NO_PENDING_CREATION'); return run(record); }),
    finishWithoutInvitations: (circleId: string) => serial(async binding => {
      const record = await read(binding);
      if (!record?.profileSent || record.circleId !== circleId) fail('CREATION_PENDING');
      if (!record.completed) await save(Object.freeze({ ...record, completed: true }));
      return { circleId };
    }),
    acknowledge: (circleId: string) => serial(async binding => { const record = await read(binding); if (!record?.completed || record.circleId !== circleId) fail('CREATION_PENDING'); await ports.vault.clear(); check(binding); }),
  };
}
