import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationAPI } from '../src/features/notifications/api.ts';

const session = () => ({ accessToken: 'secret-token', account: { id: 'account-1' }, deviceId: 'device-1', generation: 2 });

test('push registration sends its Expo token and current muted conversations using the account session', async () => {
  const requests = [];
  const api = createNotificationAPI('https://api.awsemchat.test', session, async (url, options) => {
    requests.push({ url, options });
    return new Response(null, { status: 204 });
  });

  await api.register('ExpoPushToken[abc123]', ['private:' + 'a'.repeat(64)]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.awsemchat.test/v1/notifications/device');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(requests[0].options.body), { expoPushToken: 'ExpoPushToken[abc123]', mutedConversations: ['private:' + 'a'.repeat(64)] });
});

test('invalid Expo token is rejected before any request', async () => {
  let calls = 0;
  const api = createNotificationAPI('https://api.awsemchat.test', session, async () => { calls++; return new Response(null, { status: 204 }); });
  await assert.rejects(api.register('FCM token with unrelated format'), /INVALID_INPUT/);
  assert.equal(calls, 0);
});

test('notification settings can check whether the active account has a registered device', async () => {
  const api = createNotificationAPI('https://api.awsemchat.test', session, async (_url, options) => {
    assert.equal(options.method, 'GET');
    return Response.json({ registered: true });
  });

  assert.equal(await api.status(), true);
});

test('muting a chat updates server-side push filtering for this device', async () => {
  let request;
  const api = createNotificationAPI('https://api.awsemchat.test', session, async (url, options) => {
    request = { url, options };
    return new Response(null, { status: 204 });
  });

  await api.updateMutedConversations(['circle:circle-1']);
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.url, 'https://api.awsemchat.test/v1/notifications/preferences');
  assert.deepEqual(JSON.parse(request.options.body), { mutedConversations: ['circle:circle-1'] });
});
