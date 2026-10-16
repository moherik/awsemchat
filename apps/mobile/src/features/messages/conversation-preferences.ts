export type ConversationPreferences = Readonly<Record<string, Readonly<{ pinned?: boolean; muted?: boolean; pingMuted?: boolean; archived?: boolean }>>>;
type PreferenceKey = 'pinned' | 'muted' | 'pingMuted' | 'archived';
type Snapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready'; values: ConversationPreferences }>;
type Ports = { binding(): string; storage: { read(): Promise<unknown>; write(value: ConversationPreferences): Promise<void> } };

const empty = Object.freeze({}) as ConversationPreferences;
const id = /^(?:private|circle):[A-Za-z0-9._:-]{1,128}$/;
const fields = new Set<PreferenceKey>(['pinned', 'muted', 'pingMuted', 'archived']);

function normalize(value: unknown): ConversationPreferences | undefined {
  if (value === undefined || value === null || value === '') return empty;
  let decoded = value;
  if (typeof value === 'string') {
    try { decoded = JSON.parse(value); } catch { return undefined; }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return undefined;
  const entries = Object.entries(decoded as Record<string, unknown>);
  if (entries.length > 1000) return undefined;
  const output: Record<string, Readonly<{ pinned?: boolean; muted?: boolean; pingMuted?: boolean; archived?: boolean }>> = {};
  for (const [key, raw] of entries) {
    if (!id.test(key) || !raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const settings = raw as Record<string, unknown>;
    if (Object.keys(settings).some(field => !fields.has(field as PreferenceKey)) || (settings.pingMuted !== undefined && !key.startsWith('private:')) ||
      Object.values(settings).some(setting => typeof setting !== 'boolean')) return undefined;
    const normalized: { pinned?: boolean; muted?: boolean; pingMuted?: boolean; archived?: boolean } = {};
    for (const field of fields) if (settings[field] === true) normalized[field] = true;
    if (Object.keys(normalized).length) output[key] = Object.freeze(normalized);
  }
  return Object.freeze(output);
}
function parse(value: unknown): ConversationPreferences { return normalize(value) ?? empty; }
export function validateConversationPreferences(value: unknown): ConversationPreferences {
  const validated = normalize(value);
  if (!validated) throw new Error('INVALID_INPUT');
  return validated;
}

export function createConversationPreferences(ports: Ports) {
  const binding = ports.binding();
  let snapshot: Snapshot = Object.freeze({ phase: 'idle', values: empty });
  let loadPromise: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const assertBinding = () => { if (ports.binding() !== binding) throw new Error('SESSION_CHANGED'); };
  const publish = (value: Snapshot) => { snapshot = Object.freeze(value); for (const listener of listeners) { try { listener(); } catch { /* UI listeners cannot alter stored preferences. */ } } };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    load() {
      if (!loadPromise) {
        assertBinding();
        publish({ ...snapshot, phase: 'loading' });
        loadPromise = ports.storage.read().then(value => {
          assertBinding(); publish({ phase: 'ready', values: parse(value) });
        }).catch(error => {
          loadPromise = undefined;
          if (ports.binding() === binding) publish({ phase: 'ready', values: empty });
          throw error;
        });
      }
      return loadPromise;
    },
    set(conversationId: string, key: PreferenceKey, value: boolean) {
      if (!id.test(conversationId) || !fields.has(key) || (key === 'pingMuted' && !conversationId.startsWith('private:')) || typeof value !== 'boolean') return Promise.reject(new Error('INVALID_INPUT'));
      const run = tail.then(async () => {
        assertBinding();
        if (snapshot.phase !== 'ready') throw new Error('UNAVAILABLE');
        const values: Record<string, { pinned?: boolean; muted?: boolean; pingMuted?: boolean; archived?: boolean }> = { ...snapshot.values };
        const next = { ...(values[conversationId] ?? {}) };
        if (value) next[key] = true; else delete next[key];
        if (Object.keys(next).length) values[conversationId] = next; else delete values[conversationId];
        const frozen = parse(values);
        await ports.storage.write(frozen);
        assertBinding();
        publish({ phase: 'ready', values: frozen });
      });
      tail = run.catch(() => undefined);
      return run;
    },
    restore(value: unknown) {
      const run = tail.then(async () => {
        assertBinding();
        if (snapshot.phase !== 'ready') throw new Error('UNAVAILABLE');
        const restored = validateConversationPreferences(value);
        await ports.storage.write(restored);
        assertBinding();
        publish({ phase: 'ready', values: restored });
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
