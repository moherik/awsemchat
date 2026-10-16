import test from 'node:test';
import assert from 'node:assert/strict';
import { openConversationPreferenceStorage } from '../src/features/messages/conversation-preference-storage.ts';

test('encrypted app-data storage keeps preferences across repository reopen', async () => {
  const data = new Map();
  const opened = [];
  const open = async namespace => {
    opened.push(namespace);
    return {
      getData: async key => data.get(`${namespace}/${key}`),
      setData: async (key, value) => data.set(`${namespace}/${key}`, value),
    };
  };
  const first = await openConversationPreferenceStorage('chatprefs-accountone', open);
  await first.write({ 'private:peer-one': { pinned: true, muted: true } });
  const reopened = await openConversationPreferenceStorage('chatprefs-accountone', open);
  assert.deepEqual(JSON.parse(await reopened.read()), { 'private:peer-one': { pinned: true, muted: true } });
  assert.deepEqual(opened, ['chatprefs-accountone', 'chatprefs-accountone']);
});

test('preference storage rejects a namespace outside the local encrypted database rule', async () => {
  await assert.rejects(openConversationPreferenceStorage('chat/preferences', async () => { throw new Error('must not open'); }), { message: 'INVALID_INPUT' });
});
