import type { Details, createSocialAPI } from './api';
import type { ConversationContext, SentEvent } from '../messages/api';
import type { MessageDraft } from '../messages/send';
import type { HistorySnapshot } from '../messages/history-store';
import { decodeCircleProfile, encodeCircleProfile, selectCircleProfile, type CircleAvatar, type CircleProfile, type CircleProfileSelection } from './circle-profile.ts';

type PendingProfile = Readonly<{ operation: string; revision: number; plaintext: string; profile: CircleProfile }>;
export type CircleDetailsSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error'; busy: boolean; canEdit: boolean;
  details?: Details; profile?: CircleProfileSelection; pending?: PendingProfile; error?: string;
}>;
type Ports = {
  account(): { binding: string; id: string };
  operation(): string;
  api: Pick<ReturnType<typeof createSocialAPI>, 'circle'> & { context(input: { circleId: string }): Promise<ConversationContext> };
  history(): Promise<Pick<HistorySnapshot, 'incoming' | 'outgoing'>>;
  send(draft: MessageDraft): Promise<SentEvent>;
  rebindAvatar?(avatar: CircleAvatar, epoch: number, revision: number, operation: string): Promise<CircleAvatar>;
  avatarCommitted?(avatar: CircleAvatar, revision: number): Promise<void>;
  recoverProfile?(draft: MessageDraft): Promise<'cancelled' | 'committed'>;
};
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
export function createCircleDetails(ports: Ports, circleId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') fail('INVALID_INPUT');
  const bound = ports.account();
  let state: CircleDetailsSnapshot = Object.freeze({ phase: 'idle', busy: false, canEdit: false });
  const listeners = new Set<() => void>();
  function publish(value: CircleDetailsSnapshot) { state = Object.freeze(value); for (const listener of listeners) listener(); }
  function check() {
    const current = ports.account();
    if (current.binding !== bound.binding || current.id !== bound.id) fail('SESSION_CHANGED');
  }
  async function checked<T>(job: () => Promise<T>): Promise<T> { check(); const result = await job(); check(); return result; }
  function project(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>) {
    const queued = history.outgoing.filter(record => record.conversation === circleId && record.contentType === 'circle-profile' && record.status === 'queued');
    if (queued.length > 1) fail('PROFILE_PENDING_INVALID');
    const record = queued[0];
    let pending: PendingProfile | undefined;
    if (record) {
      const profile = decodeCircleProfile(record.plaintext);
      if (!profile || record.circle !== circleId || record.target !== null || record.event !== null ||
        typeof record.profileRevision !== 'number' || !Number.isSafeInteger(record.profileRevision) || record.profileRevision < 1 ||
        !/^[A-Za-z0-9._:-]{1,128}$/.test(record.operation)) fail('PROFILE_PENDING_INVALID');
      pending = Object.freeze({ operation: record.operation, revision: record.profileRevision, plaintext: record.plaintext, profile });
    }
    return { profile: selectCircleProfile(history, circleId), pending };
  }
  async function load() {
    const details = await checked(() => ports.api.circle(circleId));
    if (details.id !== circleId) fail('CONTEXT_MISMATCH');
    publish({ ...state, details, canEdit: false, busy: true });
    const context = await checked(() => ports.api.context({ circleId }));
    const history = await checked(ports.history);
    const projection = project(history);
    if (projection.profile.state === 'ready' && projection.profile.profile.avatar && ports.avatarCommitted) {
      const { profile, revision } = projection.profile;
      await checked(() => ports.avatarCommitted!(profile.avatar!, revision));
    }
    if (details.id !== circleId || context.circleId !== circleId || context.conversation !== circleId || details.epoch !== context.epoch) fail('CONTEXT_MISMATCH');
    const admin = details.members.some(member => member.accountId === bound.id && member.role === 'admin');
    const canEdit = admin && !projection.pending && projection.profile.state === 'ready' &&
      projection.profile.revision === context.profileRevision && projection.profile.revision < Number.MAX_SAFE_INTEGER;
    publish({ phase: 'ready', busy: true, canEdit, details, ...projection });
    return { details, context, ...projection, admin, history };
  }
  async function run<T>(job: () => Promise<T>): Promise<T> {
    if (state.busy) fail('BUSY');
    publish({ ...state, phase: state.details ? state.phase : 'loading', busy: true, canEdit: false, error: undefined });
    try { check(); const result = await job(); check(); return result; }
    catch (error) {
      let changed = false;
      try { check(); } catch { changed = true; }
      const code = error instanceof Error ? error.message : 'UNAVAILABLE';
      if (changed) publish({ phase: 'error', busy: true, canEdit: false, error: 'SESSION_CHANGED' });
      else {
        let projection: ReturnType<typeof project> | undefined;
        try { projection = project(await checked(ports.history)); } catch { /* Failed recovery reads keep editing disabled. */ }
        try { check(); } catch { publish({ phase: 'error', busy: true, canEdit: false, error: 'SESSION_CHANGED' }); throw error; }
        publish({ ...state, ...projection, phase: 'error', busy: true, canEdit: false, error: code });
      }
      throw error;
    } finally { publish({ ...state, busy: false }); }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => run(async () => { await load(); }),
    recover: () => run(async () => {
      const projection = project(await checked(ports.history));
      if (!projection.pending) return;
      if (!ports.recoverProfile) fail('UNAVAILABLE');
      const saved = projection.pending;
      const result = await checked(() => ports.recoverProfile!({ circleId, operation: saved.operation, plaintext: saved.plaintext, contentType: 'circle-profile', profileRevision: saved.revision }));
      const next = project(await checked(ports.history));
      if (next.pending?.operation === saved.operation) fail('PROFILE_PENDING');
      if (result === 'committed' && next.profile.state === 'ready' && next.profile.profile.avatar && ports.avatarCommitted) {
        const { profile, revision } = next.profile; await checked(() => ports.avatarCommitted!(profile.avatar!, revision));
      }
      publish({ phase: 'ready', busy: true, canEdit: false, details: state.details, ...next }); return result;
    }),
    shareCurrentProfile: () => run(async () => {
      const current = await load();
      if (!current.admin) return;
      if (current.pending) {
        const saved = current.pending;
        await checked(() => ports.send({ circleId, operation: saved.operation, plaintext: saved.plaintext, contentType: 'circle-profile', profileRevision: saved.revision, ...(saved.profile.avatar ? { expectedEpoch: saved.profile.avatar.epoch } : {}) }));
        await load(); return;
      }
      if (!state.canEdit || current.profile.state !== 'ready') return;
      const revision = current.profile.revision;
      const epoch = `circle:${current.details.epoch}`;
      const received = current.history.incoming.some(record => record.conversation === circleId && record.contentType === 'circle-profile' && record.profileAccepted === true && record.profileRevision === revision && record.audience === epoch);
      const sent = current.history.outgoing.some(record => record.conversation === circleId && record.contentType === 'circle-profile' && record.status !== 'queued' && record.event && record.profileRevision === revision && record.audience === epoch);
      if (received || sent) return;
      const operation = ports.operation();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(operation) || operation === '.' || operation === '..') fail('INVALID_INPUT');
      let avatar = current.profile.profile.avatar;
      if (avatar && avatar.epoch !== current.details.epoch) {
        if (!ports.rebindAvatar) fail('AVATAR_EPOCH_CHANGED');
        avatar = await checked(() => ports.rebindAvatar!(avatar!, current.details.epoch, revision, operation));
        if (avatar.epoch !== current.details.epoch) fail('AVATAR_EPOCH_CHANGED');
      }
      const plaintext = encodeCircleProfile({ ...current.profile.profile, avatar });
      await checked(() => ports.send({ circleId, operation, plaintext, contentType: 'circle-profile', profileRevision: revision + 1, ...(avatar ? { expectedEpoch: avatar.epoch } : {}) }));
      await load();
    }),
    update: (expectedRevision: number, input: { name: string; description: string; avatar: CircleAvatar | null }, operationID?: string) => run(async () => {
      let plaintext = encodeCircleProfile(input), avatar = input.avatar;
      const current = await load();
      if (!current.admin) fail('DENIED');
      if (current.pending) fail('PROFILE_PENDING');
      if (!state.canEdit || current.profile.state !== 'ready' || current.profile.revision !== expectedRevision) fail('PROFILE_STALE');
      const operation = operationID ?? ports.operation();
      if (!/^[A-Za-z0-9._:-]{1,128}$/.test(operation) || operation === '.' || operation === '..') fail('INVALID_INPUT');
      if (avatar && avatar.epoch !== current.details.epoch) {
        if (avatar.epoch > current.details.epoch || JSON.stringify(avatar) !== JSON.stringify(current.profile.profile.avatar) || !ports.rebindAvatar) fail('AVATAR_EPOCH_CHANGED');
        avatar = await checked(() => ports.rebindAvatar!(avatar!, current.details.epoch, expectedRevision, operation));
        if (avatar.epoch !== current.details.epoch) fail('AVATAR_EPOCH_CHANGED');
        plaintext = encodeCircleProfile({ ...input, avatar });
      }
      await checked(() => ports.send({ circleId, operation, plaintext, contentType: 'circle-profile', profileRevision: expectedRevision + 1, ...(avatar ? { expectedEpoch: avatar.epoch } : {}) }));
      await load();
    }),
    retry: () => run(async () => {
      const current = await load();
      if (!current.admin) fail('DENIED');
      if (!current.pending) return;
      const saved = current.pending;
      await checked(() => ports.send({ circleId, operation: saved.operation, plaintext: saved.plaintext, contentType: 'circle-profile', profileRevision: saved.revision, ...(saved.profile.avatar ? { expectedEpoch: saved.profile.avatar.epoch } : {}) }));
      await load();
    }),
  };
}
