import type { NowPlayingTrack } from './bridge.ts';

type Bridge = { hasNotificationAccess(): Promise<boolean>; openNotificationAccessSettings(): Promise<void>; activeTrack(): Promise<NowPlayingTrack | null> };
type Snapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'error'; permission: 'unknown' | 'granted' | 'denied'; sharing: boolean; track: NowPlayingTrack | null; error?: string }>;

export function createNowPlayingSettings(ports: { bridge: Bridge; store: { read(): Promise<unknown>; write(value: boolean): Promise<void> } }) {
  let snapshot: Snapshot = Object.freeze({ phase: 'idle', permission: 'unknown', sharing: false, track: null });
  const listeners = new Set<() => void>();
  function publish(value: Snapshot) { snapshot = Object.freeze(value); for (const listener of listeners) { try { listener(); } catch { /* Subscribers cannot change the permission state. */ } } }
  async function refreshPermission() {
    const permission = await ports.bridge.hasNotificationAccess() ? 'granted' : 'denied';
    const track = permission === 'granted' && snapshot.sharing ? await ports.bridge.activeTrack() : null;
    publish({ phase: 'ready', permission, sharing: snapshot.sharing, track });
    return snapshot;
  }
  return Object.freeze({
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; },
    async load() {
      publish({ ...snapshot, phase: 'loading', error: undefined });
      try {
        const [permission, stored] = await Promise.all([ports.bridge.hasNotificationAccess(), ports.store.read()]);
        const sharing = stored === true;
        const track = permission && sharing ? await ports.bridge.activeTrack() : null;
        publish({ phase: 'ready', permission: permission ? 'granted' : 'denied', sharing, track });
      } catch (error) {
        publish({ ...snapshot, phase: 'error', error: error instanceof Error ? error.message : 'UNAVAILABLE' });
        throw error;
      }
    },
    async refreshPermission() {
      try { return await refreshPermission(); }
      catch (error) { publish({ ...snapshot, phase: 'error', error: error instanceof Error ? error.message : 'UNAVAILABLE' }); throw error; }
    },
    async openPermissionSettings() { await ports.bridge.openNotificationAccessSettings(); },
    async refreshTrack() {
      if (snapshot.phase !== 'ready') throw new Error('UNAVAILABLE');
      const track = snapshot.permission === 'granted' && snapshot.sharing ? await ports.bridge.activeTrack() : null;
      publish({ ...snapshot, track, error: undefined });
      return track;
    },
    async setSharing(enabled: boolean) {
      if (snapshot.phase !== 'ready') throw new Error('UNAVAILABLE');
      if (enabled && snapshot.permission !== 'granted') throw new Error('NOTIFICATION_ACCESS_REQUIRED');
      if (snapshot.sharing === enabled) return;
      if (!enabled) publish({ ...snapshot, sharing: false, track: null });
      await ports.store.write(enabled);
      if (enabled) {
        const track = await ports.bridge.activeTrack();
        publish({ ...snapshot, sharing: true, track });
      } else publish({ ...snapshot, sharing: false, track: null });
    },
  });
}
