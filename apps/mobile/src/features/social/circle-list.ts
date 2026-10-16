import type { Page, Summary } from './api';
export type CircleListSnapshot = { phase: 'idle' | 'loading' | 'ready' | 'error'; items: readonly Summary[]; busy: boolean; nextCursor?: string; error?: string };
export function createCircleList(fetchPage: (cursor: string) => Promise<Page<Summary>>) {
  const empty = (): CircleListSnapshot => Object.freeze({ phase: 'idle', items: Object.freeze([]), busy: false });
  let state = empty(), revision = 0;
  const listeners = new Set<() => void>();
  function publish(next: CircleListSnapshot) { state = Object.freeze(next); for (const listener of listeners) listener(); }
  async function read(more: boolean) {
    if (state.busy) return;
    if (more && !state.nextCursor) return;
    const ticket = revision, previous = state;
    publish({ ...state, phase: state.items.length ? 'ready' : 'loading', busy: true, error: undefined });
    try {
      const page = await fetchPage(more ? previous.nextCursor! : '');
      if (ticket !== revision) return;
      const items = [...new Map((more ? [...previous.items, ...page.items] : page.items).map(item => [item.id, Object.freeze({ ...item })])).values()];
      publish({ phase: 'ready', items: Object.freeze(items), busy: false, nextCursor: page.nextCursor });
    } catch (error) {
      if (ticket !== revision) return;
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : error instanceof Error && error.message === 'NETWORK' ? 'NETWORK' : 'UNAVAILABLE';
      publish({ ...previous, phase: previous.items.length ? 'ready' : 'error', busy: false, error: code });
      throw error;
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => read(false), loadMore: () => read(true),
    reset() { revision++; publish(empty()); },
  };
}
