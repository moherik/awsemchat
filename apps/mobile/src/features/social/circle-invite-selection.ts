import type { Contact, Details, createSocialAPI } from './api';
type Ports = { account(): { id: string; binding: string }; api: Pick<ReturnType<typeof createSocialAPI>, 'circle' | 'friends' | 'invite'> };
export type InviteSelectionSnapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'error'; busy: boolean; items: readonly Contact[]; selected: readonly string[]; search: string; details?: Details; nextCursor?: string; error?: string }>;
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
export function createCircleInviteSelection(ports: Ports, circleId: string) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') fail('INVALID_INPUT');
  const bound = ports.account();
  const empty = (): InviteSelectionSnapshot => ({ phase: 'idle', busy: false, items: Object.freeze([]), selected: Object.freeze([]), search: '' });
  let state: InviteSelectionSnapshot = Object.freeze(empty()); const listeners = new Set<() => void>();
  function publish(value: InviteSelectionSnapshot) { state = Object.freeze(value); for (const listener of listeners) listener(); }
  function check() {
    let current: ReturnType<Ports['account']>;
    try { current = ports.account(); } catch { publish(empty()); fail('SESSION_CHANGED'); }
    if (bound.id !== current.id || bound.binding !== current.binding) { publish(empty()); fail('SESSION_CHANGED'); }
  }
  async function details() {
    const result = await ports.api.circle(circleId); check();
    if (result.id !== circleId || !result.members.some(member => member.accountId === bound.id && member.role === 'admin')) fail('DENIED');
    return result;
  }
  async function run(job: () => Promise<void>) {
    check(); if (state.busy) fail('BUSY'); publish({ ...state, busy: true, error: undefined });
    try { await job(); check(); }
    catch (error) { try { check(); } catch { fail('SESSION_CHANGED'); } publish({ ...state, phase: state.items.length ? 'ready' : 'error', error: error instanceof Error ? error.message : 'UNAVAILABLE' }); throw error; }
    finally { if (state.busy) publish({ ...state, busy: false }); }
  }
  async function read(more: boolean) {
    if (more && !state.nextCursor) return;
    await run(async () => {
      publish({ ...state, phase: state.items.length ? 'ready' : 'loading' });
      const current = await details();
      const page = await ports.api.friends('accepted', more ? state.nextCursor : ''); check();
      const members = new Set(current.members.map(member => member.accountId));
      const items = [...new Map((more ? [...state.items, ...page.items] : page.items).filter(item => !members.has(item.accountId)).map(item => [item.accountId, Object.freeze({ ...item })])).values()];
      publish({ ...state, phase: 'ready', details: current, items: Object.freeze(items), selected: Object.freeze(state.selected.filter(peer => !members.has(peer))), nextCursor: page.nextCursor });
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => read(false), loadMore: () => read(true),
    search(value: string) { check(); publish({ ...state, search: value }); },
    visible: () => state.items.filter(item => item.pin.includes(state.search.trim().toUpperCase())),
    toggle(peer: string) {
      check(); if (state.busy) fail('BUSY');
      if (!state.details || !state.items.some(item => item.accountId === peer) || state.error === 'DENIED') fail('DENIED');
      const selected = state.selected.includes(peer) ? state.selected.filter(value => value !== peer) : [...state.selected, peer];
      if (selected.length > 20 - state.details.memberCount) fail('CIRCLE_FULL');
      publish({ ...state, selected: Object.freeze(selected) });
    },
    send: () => run(async () => {
      const current = await details();
      const selected = state.selected.filter(peer => !current.members.some(member => member.accountId === peer));
      if (!selected.length) { publish({ ...state, selected: Object.freeze([]), details: current }); return; }
      if (selected.length > 20 - current.memberCount) fail('CIRCLE_FULL');
      for (const peer of selected) {
        await ports.api.invite(circleId, peer); check();
        publish({ ...state, selected: Object.freeze(state.selected.filter(value => value !== peer)) });
      }
      publish({ ...state, details: current });
    }),
  };
}
