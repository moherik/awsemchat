import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlayingSettings } from '../src/features/now-playing/settings.ts';

test('Now Playing needs explicit notification access and a second sharing opt-in', async () => {
  let permission = false, saved = false;
  let opened = 0;
  const settings = createNowPlayingSettings({
    bridge: { hasNotificationAccess: async () => permission, openNotificationAccessSettings: async () => { opened++; }, activeTrack: async () => null },
    store: { read: async () => saved, write: async value => { saved = value; } },
  });
  await settings.load();
  assert.equal(settings.getSnapshot().permission, 'denied');
  await settings.openPermissionSettings();
  assert.equal(opened, 1);
  await assert.rejects(settings.setSharing(true), /NOTIFICATION_ACCESS_REQUIRED/);
  assert.equal(saved, false);
  permission = true;
  await settings.refreshPermission();
  await settings.setSharing(true);
  assert.equal(settings.getSnapshot().sharing, true);
  assert.equal(saved, true);
});

test('turning off Now Playing sharing clears local playback state before saving opt-out', async () => {
  let saved = true;
  const settings = createNowPlayingSettings({
    bridge: { hasNotificationAccess: async () => true, openNotificationAccessSettings: async () => undefined,
      activeTrack: async () => ({ title: 'Song', artist: 'Artist' }) },
    store: { read: async () => saved, write: async value => { saved = value; } },
  });
  await settings.load();
  assert.deepEqual(settings.getSnapshot().track, { title: 'Song', artist: 'Artist' });
  await settings.setSharing(false);
  assert.equal(settings.getSnapshot().track, null);
  assert.equal(saved, false);
});
