import type { DurableHistory, OutgoingHistory } from '../../security/durable-encryption';
export type HistorySnapshot = { phase: 'idle' | 'loading' | 'ready' | 'error'; incoming: readonly DurableHistory[]; outgoing: readonly OutgoingHistory[] };
export function createHistoryStore(load: () => Promise<{ incoming: DurableHistory[]; outgoing: OutgoingHistory[] }>) {
  let epoch = 0;
  let snapshot: HistorySnapshot = Object.freeze({ phase: 'idle', incoming: Object.freeze([]), outgoing: Object.freeze([]) });
  const listeners = new Set<() => void>();
  function publish(value: HistorySnapshot) {
    snapshot = Object.freeze(value);
    for (const listener of listeners) { try { listener(); } catch { /* Rendering failures must not alter native synchronization. */ } }
  }
  function clear() { epoch++; publish({ phase: 'idle', incoming: Object.freeze([]), outgoing: Object.freeze([]) }); }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clear,
    async refresh() {
      const attempt = ++epoch;
      publish({ ...snapshot, phase: 'loading' });
      try {
        const records = await load();
        if (attempt === epoch) publish({ phase: 'ready', incoming: Object.freeze(records.incoming.map(record => Object.freeze({ ...record }))),
          outgoing: Object.freeze(records.outgoing.map(record => Object.freeze({ ...record }))) });
      } catch (error) {
        if (attempt === epoch) {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'SESSION_REVOKED') clear();
          else publish({ ...snapshot, phase: 'error' });
        }
        throw error;
      }
    },
  };
}
