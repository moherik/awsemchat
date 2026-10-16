import type { OutgoingHistory } from '../../security/durable-encryption';
import { decodeCircleProfile } from './circle-profile.ts';
export type SavedCircleUpdate = Readonly<{ circleId: string; operation: string; revision: number; name: string }>;
type Snapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'error'; items: readonly SavedCircleUpdate[] }>;
type Ports = { binding(): string; load(): Promise<readonly OutgoingHistory[]> };
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
function project(records: readonly OutgoingHistory[]): readonly SavedCircleUpdate[] {
  const circles = new Set<string>(), operations = new Set<string>(), items: SavedCircleUpdate[] = [];
  for (const record of records) {
    if (record.contentType !== 'circle-profile' || record.status !== 'queued') continue;
    const profile = typeof record.plaintext === 'string' ? decodeCircleProfile(record.plaintext) : undefined;
    if (!profile || !identifier(record.circle) || record.conversation !== record.circle || !identifier(record.operation) || record.target !== null || record.event !== null ||
      !Number.isSafeInteger(record.profileRevision) || (record.profileRevision ?? 0) < 1 || circles.has(record.circle) || operations.has(record.operation)) throw new Error('PROFILE_PENDING_INVALID');
    circles.add(record.circle); operations.add(record.operation);
    items.push(Object.freeze({ circleId: record.circle, operation: record.operation, revision: record.profileRevision!, name: profile.name }));
  }
  return Object.freeze(items.sort((a, b) => a.name.localeCompare(b.name) || a.circleId.localeCompare(b.circleId)));
}
export function createSavedCircleUpdates(ports: Ports) {
  let revision = 0;
  const empty = (): Snapshot => Object.freeze({ phase: 'idle', items: Object.freeze([]) });
  let state = empty();
  const listeners = new Set<() => void>();
  function publish(value: Snapshot) { state = Object.freeze(value); for (const listener of listeners) listener(); }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    reset() { revision++; publish(empty()); },
    async refresh() {
      const ticket = ++revision;
      publish({ phase: 'loading', items: Object.freeze([]) });
      try {
        const bound = ports.binding(), records = await ports.load();
        if (ticket !== revision) return;
        if (ports.binding() !== bound) throw new Error('SESSION_CHANGED');
        publish({ phase: 'ready', items: project(records) });
      } catch (error) {
        if (ticket !== revision) return;
        publish({ phase: 'error', items: Object.freeze([]) }); throw error;
      }
    },
  };
}
