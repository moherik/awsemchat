import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlayingFanout } from '../src/features/now-playing/fanout.ts';
import { NOW_PLAYING_TTL_MS } from '../src/features/now-playing/payload.ts';

function setup(overrides = {}) {
  let binding = 'account/device/1', now = 10000;
  const sent = [], saved = [], pages = [], contexts = [], currentContexts = new Map();
  const friends = [{ accountId: 'bob', requestId: 'request-bob' }, { accountId: 'carol', requestId: 'request-carol' }];
  const ports = {
    binding: () => binding, now: () => now,
    page: async (cursor, limit) => { pages.push([cursor, limit]); return { items: friends, nextCursor: undefined }; },
    context: async targetId => { contexts.push(targetId); const value = { conversation: `private:${(targetId === 'bob' ? 'b' : 'c').repeat(64)}`, audience: `friend:request-${targetId}`, recipients: [{ accountId: targetId }] }; currentContexts.set(targetId, value); return value; },
    outgoing: async () => saved,
    operation: () => `now-playing-${sent.length + 1}`,
    send: async draft => { sent.push(draft); const context = currentContexts.get(draft.targetId); saved.push({ conversation: context?.conversation, audience: context?.audience, target: draft.targetId, circle: null, operation: draft.operation, contentType: draft.contentType, plaintext: draft.plaintext, status: 'sent', sequence: sent.length }); return { status: 'sent' }; },
    ...overrides,
  };
  const fanout = createNowPlayingFanout(ports);
  return { fanout, sent, saved, pages, contexts, setBinding: value => { binding = value; }, setNow: value => { now = value; }, friends };
}

test('Now Playing is sent as encrypted private controls only to current accepted friends and shares no Circle event', async () => {
  const value = setup();
  await value.fanout.run({ title: 'Sunset Lover', artist: 'Petit Biscuit' });
  assert.equal(value.sent.length, 2);
  assert.ok(value.sent.every(item => item.contentType === 'now-playing' && item.targetId && !item.circleId));
  assert.deepEqual(value.sent.map(item => item.targetId), ['bob', 'carol']);
});

test('same active track is not repeatedly published; stop clears it for accepted friends', async () => {
  const value = setup();
  await value.fanout.run({ title: 'Sunset Lover', artist: 'Petit Biscuit' });
  await value.fanout.run({ title: 'Sunset Lover', artist: 'Petit Biscuit' });
  assert.equal(value.sent.length, 2);
  await value.fanout.run(null);
  assert.equal(value.sent.length, 4);
  assert.ok(value.sent.slice(2).every(item => JSON.parse(item.plaintext).state === 'stopped'));
});

test('Now Playing expiry refreshes an unchanged track and exact queued controls reuse payload and operation', async () => {
  const value = setup();
  await value.fanout.run({ title: 'Sunset Lover', artist: 'Petit Biscuit' });
  value.setNow(10000 + NOW_PLAYING_TTL_MS + 1);
  await value.fanout.run({ title: 'Sunset Lover', artist: 'Petit Biscuit' });
  assert.equal(value.sent.length, 4);
  let retryValue;
  retryValue = setup({ send: async draft => { const existing = retryValue.saved[0]; retryValue.sent.push(draft); existing.status = 'sent'; return { status: 'sent' }; } });
  retryValue.saved.push({ conversation: `private:${'b'.repeat(64)}`, audience: 'friend:request-bob', target: 'bob', circle: null, operation: 'queued-track', contentType: 'now-playing', plaintext: JSON.stringify({ version: 1, state: 'playing', title: 'Song', artist: 'Artist', updatedAt: 9000, expiresAt: 9000 + NOW_PLAYING_TTL_MS }), status: 'queued', sequence: 1 });
  await retryValue.fanout.run({ title: 'Song', artist: 'Artist' });
  assert.equal(retryValue.sent[0].operation, 'queued-track');
  assert.equal(retryValue.sent[0].plaintext, retryValue.saved[0].plaintext);
});

test('account replacement during fanout prevents old account metadata from being sent', async () => {
  const value = setup({ context: async targetId => { value.setBinding('account/device/2'); return { conversation: `private:${'a'.repeat(64)}`, audience: `friend:request-${targetId}`, recipients: [{ accountId: targetId }] }; } });
  await assert.rejects(value.fanout.run({ title: 'Song', artist: 'Artist' }), /SESSION_CHANGED/);
  assert.equal(value.sent.length, 0);
});
