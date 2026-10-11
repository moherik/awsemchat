import { SocialError } from './api.ts';
import type { createSocialAPI, Contact, FriendKind } from './api.ts';
import { AuthError } from '../auth/api.ts';
import type { createSessionOwner } from '../auth/session-owner.ts';

export type FriendList = { phase: 'idle' | 'loading' | 'ready' | 'error'; items: readonly Contact[]; refreshing: boolean; nextCursor?: string; error?: string };
export type FriendsSnapshot = { lists: Record<FriendKind, FriendList>; pinDraft: string; busy: boolean; error?: string };
const kinds: FriendKind[] = ['accepted', 'incoming', 'outgoing', 'blocked'];
function emptyList(): FriendList { return Object.freeze({ phase: 'idle', items: Object.freeze([]), refreshing: false }); }
function initial(): FriendsSnapshot { return Object.freeze({ lists: Object.freeze({ accepted: emptyList(), incoming: emptyList(), outgoing: emptyList(), blocked: emptyList() }), pinDraft: '', busy: false }); }
function safe(error: unknown): SocialError { return error instanceof SocialError || error instanceof AuthError ? new SocialError(error.code) : new SocialError('UNAVAILABLE'); }
export function createFriendsFlow(api: ReturnType<typeof createSocialAPI>, owner: ReturnType<typeof createSessionOwner>, pageSize = 25) {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new SocialError('CONFIGURATION');
  let snapshot = initial(), revision = 0, disposed = false;
  const listeners = new Set<() => void>();
  const tickets: Record<FriendKind, number> = { accepted: 0, incoming: 0, outgoing: 0, blocked: 0 };
  function identity() { const s = owner.getSnapshot(); return s.account ? `${s.account.id}/${s.generation}` : ''; }
  let account = identity();
  function notify() { for (const listener of listeners) { try { listener(); } catch { /* A renderer cannot alter the committed state. */ } } }
  function publish(change: Partial<FriendsSnapshot>) { if (disposed) return; snapshot = Object.freeze({ ...snapshot, ...change }); notify(); }
  function reset() { revision++; for (const kind of kinds) tickets[kind]++; snapshot = initial(); notify(); }
  const unsubscribe = owner.subscribe(() => { const next = identity(); if (next !== account) { account = next; reset(); } });
  function check() { if (disposed) throw new SocialError('DISPOSED'); owner.requireSession(); }
  function list(kind: FriendKind, change: Partial<FriendList>) {
    const value = Object.freeze({ ...snapshot.lists[kind], ...change });
    publish({ lists: Object.freeze({ ...snapshot.lists, [kind]: value }) });
  }
  async function read(kind: FriendKind, more = false) {
    check();
    if (!kinds.includes(kind)) throw new SocialError('INVALID_INPUT');
    const previous = snapshot.lists[kind];
    if (previous.refreshing || previous.phase === 'loading') throw new SocialError('BUSY');
    if (more && !previous.nextCursor) return;
    const generation = revision, ticket = ++tickets[kind];
    list(kind, { phase: previous.phase === 'idle' || previous.phase === 'error' ? 'loading' : previous.phase, refreshing: true, error: undefined });
    try {
      const result = await api.friends(kind, more ? previous.nextCursor : '', pageSize);
      if (disposed || generation !== revision || ticket !== tickets[kind]) throw new SocialError('SESSION_CHANGED');
      const merged = more ? [...previous.items, ...result.items] : result.items;
      const unique = [...new Map(merged.map(item => [item.accountId, Object.freeze({ ...item })])).values()];
      list(kind, { phase: 'ready', items: Object.freeze(unique), nextCursor: result.nextCursor, refreshing: false });
    } catch (error) {
      const failure = safe(error);
      if (!disposed && generation === revision && ticket === tickets[kind]) list(kind, { phase: previous.phase === 'ready' ? 'ready' : 'error', refreshing: false, error: failure.code });
      throw failure;
    }
  }
  async function execute(job: () => Promise<void>) {
    check(); if (snapshot.busy) throw new SocialError('BUSY');
    const generation = revision; publish({ busy: true, error: undefined });
    try { await job(); if (disposed || generation !== revision) throw new SocialError('SESSION_CHANGED'); }
    catch (error) { const failure = safe(error); if (!disposed && generation === revision) publish({ error: failure.code }); throw failure; }
    finally { if (!disposed && generation === revision) publish({ busy: false }); }
  }
  async function committed(generation: number, keep: (item: Contact, kind: FriendKind) => boolean) {
    if (disposed || generation !== revision) throw new SocialError('SESSION_CHANGED');
    for (const kind of kinds) {
      tickets[kind]++;
      const previous = snapshot.lists[kind];
      list(kind, { items: Object.freeze(previous.items.filter(item => keep(item, kind))), refreshing: false, phase: previous.phase === 'loading' ? 'idle' : previous.phase });
    }
    await Promise.allSettled(kinds.map(kind => read(kind)));
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setPIN(value: string) { if (!disposed) publish({ pinDraft: value.replace(/\s/g, '').toUpperCase(), error: undefined }); },
    refresh: (kind: FriendKind = 'accepted') => read(kind),
    loadMore: (kind: FriendKind = 'accepted') => read(kind, true),
    request: () => execute(async () => {
      const draft = snapshot.pinDraft, generation = revision;
      await api.requestFriend(draft);
      if (disposed || generation !== revision) throw new SocialError('SESSION_CHANGED');
      if (snapshot.pinDraft === draft) publish({ pinDraft: '' });
      await Promise.allSettled([read('outgoing'), read('incoming')]);
    }),
    respond: (id: string, accept: boolean) => execute(async () => {
      const generation = revision; await api.respondFriend(id, accept);
      await committed(generation, (item, kind) => kind !== 'incoming' || item.requestId !== id);
    }),
    block: (id: string, blocked: boolean) => execute(async () => {
      const generation = revision; await api.blockAccount(id, blocked);
      await committed(generation, (item, kind) => item.accountId !== id || (blocked && kind === 'blocked'));
    }),
    dispose() { if (disposed) return; disposed = true; revision++; unsubscribe(); snapshot = initial(); listeners.clear(); },
  };
}
