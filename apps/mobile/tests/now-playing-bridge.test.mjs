import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlayingBridge } from '../src/features/now-playing/bridge.ts';

test('Now Playing bridge exposes only trimmed title and artist from an active media session', async () => {
  const native = {
    hasNotificationAccess: async () => true,
    openNotificationAccessSettings: async () => undefined,
    getActiveTrack: async () => ({ title: '  Sunset Lover ', artist: ' Petit Biscuit ', notificationText: 'private message' }),
  };
  const bridge = createNowPlayingBridge(native, 'android');
  assert.equal(await bridge.hasNotificationAccess(), true);
  assert.deepEqual(await bridge.activeTrack(), { title: 'Sunset Lover', artist: 'Petit Biscuit' });
});

test('Now Playing bridge fails closed for broad or malformed notification payloads', async () => {
  const native = { hasNotificationAccess: async () => true, openNotificationAccessSettings: async () => undefined,
    getActiveTrack: async () => ({ title: 'Song', artist: '' }) };
  assert.equal(await createNowPlayingBridge(native, 'android').activeTrack(), null);
  const unsupported = createNowPlayingBridge(native, 'other');
  await assert.rejects(unsupported.hasNotificationAccess(), /UNSUPPORTED_PLATFORM/);
});
