import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushRegistration } from '../src/features/notifications/registration.ts';

test('Android creates its message channel before requesting permission and registers only after opt-in', async () => {
  const calls = [];
  let granted = false;
  const registration = createPushRegistration({
    platform: 'android', projectId: 'expo-project', physicalDevice: true,
    notifications: {
      setNotificationChannelAsync: async () => calls.push('channel'),
      getPermissionsAsync: async () => ({ granted }),
      requestPermissionsAsync: async () => { calls.push('permission'); granted = true; return { granted }; },
      getExpoPushTokenAsync: async ({ projectId }) => { calls.push(`token:${projectId}`); return { data: 'ExpoPushToken[abc123]' }; },
    },
      mutedConversations: async () => ['circle:circle-1'],
      api: { register: async (token, muted) => calls.push(`register:${token}:${muted.join(',')}`), unregister: async () => calls.push('unregister') },
  });

  assert.equal(await registration.enable(), true);
  assert.deepEqual(calls, ['channel', 'permission', 'token:expo-project', 'register:ExpoPushToken[abc123]:circle:circle-1']);
});

test('denying OS permission does not request a push token or register the device', async () => {
  let tokenRequests = 0, registrations = 0;
  const registration = createPushRegistration({
    platform: 'android', projectId: 'expo-project', physicalDevice: true,
    notifications: {
      setNotificationChannelAsync: async () => undefined,
      getPermissionsAsync: async () => ({ granted: false }),
      requestPermissionsAsync: async () => ({ granted: false }),
      getExpoPushTokenAsync: async () => { tokenRequests++; return { data: 'ExpoPushToken[abc123]' }; },
    },
    api: { register: async () => { registrations++; }, unregister: async () => undefined },
  });

  assert.equal(await registration.enable(), false);
  assert.equal(tokenRequests, 0);
  assert.equal(registrations, 0);
});

test('Android emulators can register when Google Play push services are available', async () => {
  let registered = false;
  const registration = createPushRegistration({
    platform: 'android', projectId: 'expo-project', physicalDevice: false,
    notifications: {
      setNotificationChannelAsync: async () => undefined,
      getPermissionsAsync: async () => ({ granted: true }),
      requestPermissionsAsync: async () => ({ granted: true }),
      getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[abc123]' }),
    },
    api: { register: async () => { registered = true; }, unregister: async () => undefined },
  });
  assert.equal(await registration.enable(), true);
  assert.equal(registered, true);
});

test('disabling notifications unregisters the current device from the account', async () => {
  let removals = 0;
  const registration = createPushRegistration({
    platform: 'android', projectId: 'expo-project', physicalDevice: true,
    notifications: {},
    api: { register: async () => undefined, unregister: async () => { removals++; } },
  });

  await registration.disable();
  assert.equal(removals, 1);
});
