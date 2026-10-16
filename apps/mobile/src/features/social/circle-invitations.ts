import { SocialError } from './api.ts';
import type { createSocialAPI, Invitation } from './api';
export type CircleInvitationsSnapshot = { phase: 'idle' | 'loading' | 'ready' | 'error'; items: readonly Invitation[]; busy: boolean; nextCursor?: string; error?: string };
export function createCircleInvitations(api: Pick<ReturnType<typeof createSocialAPI>, 'invitations' | 'respondInvitation'>) {
  const empty = (): CircleInvitationsSnapshot => Object.freeze({ phase: 'idle', items: Object.freeze([]), busy: false });
  let state = empty(), revision = 0;
  const listeners = new Set<() => void>();
  function publish(next: CircleInvitationsSnapshot) { state = Object.freeze(next); for (const listener of listeners) { try { listener(); } catch { /* A renderer cannot change the committed result. */ } } }
  function check(ticket: number) { if (ticket !== revision) throw new SocialError('SESSION_CHANGED'); }
  function failure(error: unknown) { return new SocialError(error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'UNAVAILABLE'); }
  async function execute<T>(job: (ticket: number, previous: CircleInvitationsSnapshot) => Promise<T>): Promise<T> {
    if (state.busy) throw new SocialError('BUSY');
    const ticket = revision, previous = state;
    publish({ ...state, busy: true, error: undefined });
    try { return await job(ticket, previous); }
    catch (error) { const safe = failure(error); if (ticket === revision) publish({ ...state, phase: state.items.length || state.phase === 'ready' ? 'ready' : 'error', error: safe.code }); throw safe; }
    finally { if (ticket === revision) publish({ ...state, busy: false }); }
  }
  async function read(more: boolean) {
    if (more && !state.nextCursor) return;
    await execute(async (ticket, previous) => {
      publish({ ...state, phase: state.items.length ? 'ready' : 'loading' });
      const page = await api.invitations(more ? previous.nextCursor : ''); check(ticket);
      const items = [...new Map((more ? [...previous.items, ...page.items] : page.items).map(item => [item.id, Object.freeze({ ...item })])).values()];
      publish({ phase: 'ready', busy: true, items: Object.freeze(items), nextCursor: page.nextCursor });
    });
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => read(false), loadMore: () => read(true),
    respond(id: string, accept: boolean) { return execute(async (ticket, previous) => {
      const invitation = previous.items.find(item => item.id === id);
      if (!invitation) throw new SocialError('DENIED');
      const result = await api.respondInvitation(id, accept); check(ticket);
      if (result.circleId !== invitation.circleId) throw new SocialError('INVALID_RESPONSE');
      publish({ ...state, items: Object.freeze(state.items.filter(item => item.id !== id)) });
      check(ticket);
      return result.status === 'accepted' ? { circleId: result.circleId, intervalId: result.intervalId } : undefined;
    }); },
    reset() { revision++; publish(empty()); },
  };
}
