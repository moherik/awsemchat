import { useEffect } from 'react';
import { AppState } from 'react-native';
import { authenticationRuntime } from '../auth/runtime';
import { createForegroundSessionGate } from '../auth/foreground-session';
import { createSyncScheduler } from './sync-scheduler';
import { createNowPlayingLifecycle } from '../now-playing/lifecycle';

export function InboxLifecycle() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let disposed = false;
    let refresh: (() => void) | undefined;
    let foregroundCheck: (() => Promise<void>) | undefined;
    let nowPlayingRefresh: (() => void) | undefined;
    const bootstrap = createSyncScheduler(() => !cleanup && !disposed && AppState.currentState === 'active', async () => {
      const runtime = await authenticationRuntime();
      if (disposed) return { more: false };
      let validatingForegroundSession = false;
      const scheduler = createSyncScheduler(
        () => !validatingForegroundSession && AppState.currentState === 'active' && runtime.owner.getSnapshot().status === 'ready' && runtime.flow.getSnapshot().phase === 'ready',
        () => runtime.syncMessages(),
      );
      const nowPlaying = createNowPlayingLifecycle({
        enabled: () => !validatingForegroundSession && AppState.currentState === 'active' && runtime.owner.getSnapshot().status === 'ready' && runtime.flow.getSnapshot().phase === 'ready',
        sync: () => runtime.syncNowPlaying(),
        interval: 30_000,
      });
      const syncNotificationPreferences = () => runtime.syncNotificationPreferences().catch(() => undefined);
      const account = runtime.owner.subscribe(scheduler.refresh);
      const login = runtime.flow.subscribe(scheduler.refresh);
      refresh = scheduler.refresh;
      foregroundCheck = createForegroundSessionGate(
        () => { validatingForegroundSession = true; scheduler.refresh(); },
        () => runtime.flow.restore(),
        () => { validatingForegroundSession = false; scheduler.refresh(); nowPlaying.refresh(); syncNotificationPreferences(); },
      );
      nowPlayingRefresh = nowPlaying.refresh;
      scheduler.refresh();
      nowPlaying.refresh();
      syncNotificationPreferences();
      cleanup = () => { scheduler.dispose(); nowPlaying.dispose(); account(); login(); foregroundCheck = undefined; nowPlayingRefresh = undefined; };
      return { more: false };
    });
    const app = AppState.addEventListener('change', nextState => {
      if (nextState === 'active' && foregroundCheck) { void foregroundCheck(); nowPlayingRefresh?.(); return; }
      bootstrap.refresh();
      refresh?.();
    });
    bootstrap.refresh();
    return () => { disposed = true; bootstrap.dispose(); cleanup?.(); app.remove(); };
  }, []);
  return null;
}
