import test from 'node:test';
import assert from 'node:assert/strict';
import { installNotificationNavigation } from '../src/features/notifications/navigation.ts';

function fixture(lastResponse = null) {
  let listener;
  const openChats = [];
  const cleared = [];
  const removed = [];
  const notifications = {
    addNotificationResponseReceivedListener(callback) {
      listener = callback;
      return { remove() { removed.push(true); } };
    },
    async getLastNotificationResponseAsync() { return lastResponse; },
    async clearLastNotificationResponseAsync() { cleared.push(true); },
  };
  return {
    notifications,
    openChats,
    cleared,
    removed,
    tap(response) { listener(response); },
  };
}

const response = (identifier, data = {}) => ({
  actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
  notification: { request: { identifier, content: { data } } },
});

test('notification tap opens the Chats tab without passing notification content into navigation', () => {
  const f = fixture();
  const navigate = () => f.openChats.push([]);
  const dispose = installNotificationNavigation(f.notifications, navigate);
  f.tap(response('notice-1', { body: 'private content', conversationId: 'private:secret' }));

  assert.deepEqual(f.openChats, [[]]);
  assert.deepEqual(f.cleared, [true]);
  dispose();
  assert.deepEqual(f.removed, [true]);
});

test('a cold-start notification response opens Chats after the root handler mounts', async () => {
  const f = fixture(response('notice-launch'));
  installNotificationNavigation(f.notifications, () => f.openChats.push([]));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.openChats, [[]]);
  assert.deepEqual(f.cleared, [true]);
});

test('the same response received during mount and as the initial response navigates once', async () => {
  const initial = response('notice-duplicate');
  const f = fixture(initial);
  installNotificationNavigation(f.notifications, () => f.openChats.push([]));
  f.tap(initial);

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.openChats, [[]]);
  assert.deepEqual(f.cleared, [true]);
});

test('a response that resolves after unmount does not navigate', async () => {
  let resolveInitial;
  const f = fixture();
  f.notifications.getLastNotificationResponseAsync = () => new Promise(resolve => { resolveInitial = resolve; });
  const dispose = installNotificationNavigation(f.notifications, () => f.openChats.push([]));
  dispose();
  resolveInitial(response('notice-after-unmount'));

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.openChats, []);
  assert.deepEqual(f.removed, [true]);
});

test('malformed responses without a notification id are ignored', () => {
  const f = fixture();
  installNotificationNavigation(f.notifications, () => f.openChats.push([]));
  f.tap({ actionIdentifier: 'default', notification: { request: { content: { data: {} } } } });

  assert.deepEqual(f.openChats, []);
  assert.deepEqual(f.cleared, []);
});
