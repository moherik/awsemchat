import type { createSocialAPI, MembershipMutation, MembershipResult } from './api';
export type PendingMembership = Readonly<{ version: 1; binding: string; circleId: string; input: MembershipMutation; result?: MembershipResult }>;
export type MembershipVault = { read(): Promise<unknown>; write(value: PendingMembership): Promise<void>; clear(): Promise<void> };
type Ports = { account(): { id: string; binding: string }; operation(): string; vault: MembershipVault; api: Pick<ReturnType<typeof createSocialAPI>, 'circle' | 'mutateMembership' | 'cancelMembership'> };
const queues = new WeakMap<MembershipVault, Promise<void>>();
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
export function createCircleMembership(ports: Ports, circleId: string) {
  if (!id(circleId)) fail('INVALID_INPUT');
  const bound = ports.account();
  function check() { const current = ports.account(); if (current.id !== bound.id || current.binding !== bound.binding) fail('SESSION_CHANGED'); }
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const result = (queues.get(ports.vault) ?? Promise.resolve()).then(async () => { check(); const value = await job(); check(); return value; });
    queues.set(ports.vault, result.then(() => {}, () => {})); return result;
  }
  async function pending(): Promise<PendingMembership | undefined> {
    const value = await ports.vault.read(); check(); if (value === null) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VAULT_INVALID');
    const record = value as PendingMembership, input = record.input;
    if (record.version !== 1 || record.binding !== bound.binding || record.circleId !== circleId || !input || !id(input.operationId) || !id(input.actorInterval) || !Number.isSafeInteger(input.expectedEpoch) || input.expectedEpoch < 1 || !['leave', 'remove', 'handoff'].includes(input.action)) fail('VAULT_INVALID');
    if (input.action === 'leave' ? input.targetId !== undefined || input.targetInterval !== undefined : !id(input.targetId) || !id(input.targetInterval) || input.targetId === bound.id) fail('VAULT_INVALID');
    if (record.result && (record.result.operationId !== input.operationId || record.result.circleId !== circleId || record.result.action !== input.action || typeof record.result.closed !== 'boolean' || input.action !== 'leave' && record.result.closed || record.result.cancelled !== undefined && typeof record.result.cancelled !== 'boolean' || record.result.cancelled === true && record.result.closed)) fail('VAULT_INVALID');
    return Object.freeze({ version: 1, binding: record.binding, circleId, input: Object.freeze({ ...input }), ...(record.result ? { result: Object.freeze({ ...record.result }) } : {}) });
  }
  async function save(record: PendingMembership) { check(); await ports.vault.write(record); check(); }
  async function finish(cancel: boolean) {
    const record = await pending(); if (!record) fail('NO_PENDING_MEMBERSHIP');
    if (record.result) return record.result;
    const result = await (cancel ? ports.api.cancelMembership : ports.api.mutateMembership)(circleId, record.input); check();
    if (result.operationId !== record.input.operationId || result.circleId !== circleId || result.action !== record.input.action || typeof result.closed !== 'boolean' || result.cancelled === true && result.closed) fail('INVALID_RESPONSE');
    await save(Object.freeze({ ...record, result: Object.freeze({ ...result }) })); return result;
  }
  return {
    pending: () => serial(pending),
    prepare: (action: MembershipMutation['action'], targetId?: string, expected?: { epoch: number; actorInterval: string; targetInterval?: string }) => serial(async () => {
      if (await pending()) fail('MEMBERSHIP_PENDING');
      const details = await ports.api.circle(circleId); check();
      const own = details.members.find(member => member.accountId === bound.id);
      if (!own) fail('DENIED');
      if (action === 'leave') {
        if (targetId !== undefined) fail('INVALID_INPUT');
        if (own.role === 'admin' && details.memberCount > 1 && details.members.filter(member => member.role === 'admin').length === 1) fail('ADMIN_HANDOFF_REQUIRED');
      } else if (action !== 'remove' && action !== 'handoff') fail('INVALID_INPUT');
      else if (own.role !== 'admin' || targetId === bound.id) fail('DENIED');
      const target = action === 'leave' ? undefined : details.members.find(member => member.accountId === targetId);
      if (action !== 'leave' && !target) fail('DENIED');
      if (expected && (details.epoch !== expected.epoch || own.intervalId !== expected.actorInterval || target?.intervalId !== expected.targetInterval)) fail('MEMBERSHIP_CHANGED');
      const operationId = ports.operation(); if (!id(operationId)) fail('INVALID_INPUT');
      const input: MembershipMutation = Object.freeze({ operationId, action, actorInterval: own.intervalId, expectedEpoch: details.epoch, ...(target ? { targetId: target.accountId, targetInterval: target.intervalId } : {}) });
      const record: PendingMembership = Object.freeze({ version: 1, binding: bound.binding, circleId, input });
      await save(record); return record;
    }),
    execute: () => serial(() => finish(false)),
    cancel: () => serial(() => finish(true)),
    acknowledge: () => serial(async () => { const record = await pending(); if (!record?.result) fail('MEMBERSHIP_PENDING'); await ports.vault.clear(); check(); }),
  };
}
