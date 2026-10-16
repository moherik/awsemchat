import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationPreferences } from '../src/features/messages/conversation-preferences.ts';

function fixture(stored) {
  let binding = 'account-one/device-one/generation-one';
  let value = stored;
  let writes = 0;
  const controller = createConversationPreferences({ binding: () => binding, storage: {
    read: async () => value,
    write: async next => { writes++; value = JSON.stringify(next); },
  } });
  return { controller, get value() { return value; }, get writes() { return writes; }, replace: () => { binding = 'account-two/device-two/generation-two'; } };
}

test('loads safe empty defaults and persists individual preference changes', async () => {
  const f = fixture(undefined);
  await f.controller.load();
  assert.deepEqual(f.controller.getSnapshot().values, {});
  await f.controller.set('private:peer-one', 'pinned', true);
  assert.deepEqual(f.controller.getSnapshot().values['private:peer-one'], { pinned: true });
  assert.equal(f.writes, 1);
});

test('changing one preference preserves mute, pin, and archive siblings', async () => {
  const f = fixture(JSON.stringify({ 'circle:home': { pinned: true } }));
  await f.controller.load();
  await f.controller.set('circle:home', 'muted', true);
  await f.controller.set('circle:home', 'archived', true);
  assert.deepEqual(f.controller.getSnapshot().values['circle:home'], { pinned: true, muted: true, archived: true });
});

test('PING alert mute is private-chat-only data and survives reload', async () => {
  const f = fixture(undefined);
  await f.controller.load();
  await f.controller.set('private:peer-one', 'pingMuted', true);
  assert.deepEqual(f.controller.getSnapshot().values['private:peer-one'], { pingMuted: true });
  const reloaded = fixture(f.value);
  await reloaded.controller.load();
  assert.equal(reloaded.controller.getSnapshot().values['private:peer-one'].pingMuted, true);
  await assert.rejects(reloaded.controller.set('circle:home', 'pingMuted', true), { message: 'INVALID_INPUT' });
});

test('account replacement prevents writes from the old controller', async () => {
  const f = fixture(undefined);
  await f.controller.load();
  f.replace();
  await assert.rejects(f.controller.set('private:peer-one', 'muted', true), { message: 'SESSION_CHANGED' });
  assert.equal(f.writes, 0);
});

test('malformed persisted preferences fall back to empty safe defaults', async () => {
  const f = fixture('{broken');
  await f.controller.load();
  assert.deepEqual(f.controller.getSnapshot().values, {});
  assert.equal(f.controller.getSnapshot().phase, 'ready');
});

test('invalid conversation IDs and preference fields are rejected', async () => {
  const f = fixture(undefined);
  await f.controller.load();
  await assert.rejects(f.controller.set('private:bad id', 'pinned', true), { message: 'INVALID_INPUT' });
  await assert.rejects(f.controller.set('private:peer-one', 'read', true), { message: 'INVALID_INPUT' });
  assert.equal(f.writes, 0);
});

test('restores a validated preference snapshot as a replacement and persists it', async () => {
  const f = fixture(JSON.stringify({ 'private:old': { muted: true } }));
  await f.controller.load();
  await f.controller.restore({ 'circle:home': { archived: true, pinned: true } });
  assert.deepEqual(f.controller.getSnapshot().values, { 'circle:home': { archived: true, pinned: true } });
  assert.equal(f.writes, 1);
});

test('restore rejects malformed preference snapshots without replacing local settings', async () => {
  const f = fixture(JSON.stringify({ 'private:old': { muted: true } }));
  await f.controller.load();
  await assert.rejects(f.controller.restore({ 'circle:bad id': { pinned: true } }), { message: 'INVALID_INPUT' });
  assert.deepEqual(f.controller.getSnapshot().values, { 'private:old': { muted: true } });
  assert.equal(f.writes, 0);
});
