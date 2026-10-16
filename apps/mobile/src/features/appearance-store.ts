export type AppearanceTheme = 'system' | 'light' | 'dark';
export type AppearanceSnapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'error'; theme: AppearanceTheme }>;
type Storage = { get(): Promise<string | null>; set(value: AppearanceTheme): Promise<void> };
const initial: AppearanceSnapshot = Object.freeze({ phase: 'idle', theme: 'system' });
const themes = new Set<AppearanceTheme>(['system', 'light', 'dark']);

export function createAppearanceStore(storage: Storage) {
  let snapshot = initial;
  let loading: Promise<void> | undefined;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  function publish(value: AppearanceSnapshot) {
    snapshot = Object.freeze(value);
    for (const listener of listeners) { try { listener(); } catch { /* A view must not interrupt the preference store. */ } }
  }
  function load(): Promise<void> {
    if (snapshot.phase === 'ready') return Promise.resolve();
    if (loading) return loading;
    publish({ phase: 'loading', theme: snapshot.theme });
    loading = storage.get().then(value => {
      const theme = themes.has(value as AppearanceTheme) ? value as AppearanceTheme : 'system';
      publish({ phase: 'ready', theme });
    }, error => {
      publish({ phase: 'error', theme: snapshot.theme });
      throw error;
    }).finally(() => { loading = undefined; });
    return loading;
  }
  function setTheme(theme: AppearanceTheme): Promise<void> {
    if (!themes.has(theme)) return Promise.reject(new Error('INVALID_APPEARANCE'));
    const operation = writes.then(async () => {
      if (snapshot.phase !== 'ready') await load();
      await storage.set(theme);
      publish({ phase: 'ready', theme });
    });
    writes = operation.catch(() => undefined);
    return operation;
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load,
    setTheme,
  });
}
