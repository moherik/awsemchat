import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateProfileFlow } from '../src/features/social/private-profile-flow.ts';

const page = { items: [
  { accountId: 'alice', requestId: 'friend-a', pin: 'AAAA1111', status: 'accepted' },
  { accountId: 'bob', requestId: 'friend-b', pin: 'BBBB2222', status: 'accepted' },
  { accountId: 'blocked', requestId: 'friend-c', pin: 'CCCC3333', status: 'blocked' },
] };
function setup(overrides = {}) {
  let stored = null, binding = 'account/device/1';
  let savedPhoto;
  const sends = [], writes = [], photoPublications = [];
  const ports = {
    binding: () => binding,
    vault: { read: async () => stored, write: async value => { writes.push(value); stored = value; } },
    history: async () => ({ incoming: [], outgoing: [] }),
    acceptedFriends: async () => page,
    operation: (revision, requestId) => `profile-${revision}-${requestId}`,
    send: async draft => { sends.push(draft); return { id: `event-${draft.operation}`, operation: draft.operation, status: 'sent' }; },
    publishPhoto: async value => { photoPublications.push(value); return { id: `event-${value.operation}`, operation: value.operation, status: 'sent' }; },
    photoStore: {
      read: async () => savedPhoto,
      write: async value => { savedPhoto = { mimeType: value.mimeType, bytes: value.bytes.slice() }; },
      clear: async () => { savedPhoto = undefined; },
    },
    ...overrides,
  };
  return { flow: createPrivateProfileFlow(ports), ports, sends, writes, photoPublications, getStored: () => stored, getPhoto: () => savedPhoto, changeBinding: value => { binding = value; } };
}

test('profile photo can be replaced and explicitly removed while text-only edits preserve it', async () => {
  const value = setup();
  await value.flow.load();
  await value.flow.save({ name: 'Naya', status: 'Taking the scenic route' });
  const first = { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
  await value.flow.setPhoto(first);
  assert.equal(value.flow.getSnapshot().profile.avatarMode, 'photo');
  assert.equal(value.flow.getSnapshot().profile.revision, 2);
  assert.deepEqual(value.photoPublications.map(item => [item.targetId, item.requestId, item.photo.mimeType]), [['alice', 'friend-a', 'image/png'], ['bob', 'friend-b', 'image/png']]);
  first.bytes[0] = 9;
  assert.deepEqual(value.getPhoto().bytes, new Uint8Array([1, 2, 3]));
  assert.deepEqual(value.flow.getSnapshot().avatar, value.getPhoto());

  const replacement = { mimeType: 'image/jpeg', bytes: new Uint8Array([4, 5]) };
  await value.flow.setPhoto(replacement);
  await value.flow.save({ name: 'Naya', status: 'Taking the scenic route' });
  assert.equal(value.flow.getSnapshot().profile.avatarMode, 'photo');
  assert.deepEqual(value.getPhoto(), replacement);
  assert.deepEqual(value.flow.getSnapshot().avatar, replacement);
  assert.equal(value.flow.getSnapshot().sharePending, false);
  assert.equal(value.sends.length, 2);

  await value.flow.setPhoto(null);
  assert.equal(value.getPhoto(), undefined);
  assert.equal(value.flow.getSnapshot().avatar, null);
  assert.equal(value.flow.getSnapshot().profile.avatarMode, 'removed');
  assert.equal(value.flow.getSnapshot().sharePending, false);
  assert.deepEqual(value.photoPublications.slice(-2).map(item => item.photo), [null, null]);
  assert.equal(value.sends.length, 2);
});

test('unavailable local avatar blocks text-only fanout instead of silently publishing its removal', async () => {
  const value = setup({ photoStore: { read: async () => { throw new Error('PROFILE_PHOTO_UNAVAILABLE'); }, write: async () => {}, clear: async () => {} } });
  await value.flow.load();
  assert.equal(value.flow.getSnapshot().phase, 'ready');
  assert.equal(value.flow.getSnapshot().photoError, 'PROFILE_PHOTO_UNAVAILABLE');
  await value.flow.save({ name: 'Naya', status: 'Taking the scenic route' });
  assert.equal(value.flow.getSnapshot().sharePending, true);
  assert.equal(value.sends.length, 0);
});

test('saving a profile persists it first and sends encrypted profile events only to accepted friends', async () => {
  const value = setup();
  await value.flow.load();
  await value.flow.save({ name: 'Naya', status: 'Taking the scenic route' });
  assert.equal(value.writes.length, 1);
  assert.equal(value.sends.length, 2);
  assert.deepEqual(value.sends.map(draft => [draft.targetId, draft.operation, draft.contentType]), [
    ['alice', 'profile-1-friend-a', 'private-profile'],
    ['bob', 'profile-1-friend-b', 'private-profile'],
  ]);
  assert.deepEqual(value.sends.map(draft => JSON.parse(draft.plaintext)), [
    { version: 1, revision: 1, name: 'Naya', status: 'Taking the scenic route' },
    { version: 1, revision: 1, name: 'Naya', status: 'Taking the scenic route' },
  ]);
  assert.equal(value.getStored().revision, 1);
});

test('saving a profile also publishes current name and status to Circle members', async () => {
  const circleProfiles = [];
  const value = setup({ shareCircles: async profile => { circleProfiles.push(profile); } });
  await value.flow.load();
  await value.flow.save({ name: 'Naya', status: 'Taking the scenic route' });
  assert.deepEqual(circleProfiles, [{ version: 1, revision: 1, name: 'Naya', status: 'Taking the scenic route' }]);
});

test('failed fanout is kept locally and a later sync retries with the same operation and payload', async () => {
  let attempts = 0;
  const value = setup({ send: async draft => { value.sends.push(draft); attempts++; if (attempts === 1) throw new Error('offline'); return { id: 'event', operation: draft.operation, status: 'sent' }; } });
  await value.flow.load();
  await value.flow.save({ name: 'Raka', status: 'One more song' });
  assert.equal(value.getStored().name, 'Raka');
  const firstOperation = value.sends[0].operation, firstPayload = value.sends[0].plaintext;
  await value.flow.sync();
  const aliceRetries = value.sends.filter(draft => draft.targetId === 'alice');
  assert.equal(aliceRetries.at(-1).operation, firstOperation);
  assert.equal(aliceRetries.at(-1).plaintext, firstPayload);
});

test('profile revision increases on edits and restore loading picks the highest sent revision', async () => {
  const old = { version: 1, revision: 2, name: 'Old', status: 'Old status' };
  const latest = { version: 1, revision: 5, name: 'Current', status: 'Today' };
  const value = setup({ history: async () => ({ incoming: [], outgoing: [
    { operation: 'old', conversation: 'private:old', audience: 'friend:a', contentType: 'private-profile', plaintext: JSON.stringify(old), status: 'sent', event: 'event-old', sequence: 10 },
    { operation: 'latest', conversation: 'private:new', audience: 'friend:b', contentType: 'private-profile', plaintext: JSON.stringify(latest), status: 'delivered', event: 'event-new', sequence: 2 },
    { operation: 'queued', conversation: 'private:queued', audience: 'friend:c', contentType: 'private-profile', plaintext: JSON.stringify({ ...latest, revision: 6 }), status: 'queued', event: null, sequence: 99 },
  ] }) });
  await value.flow.load();
  assert.deepEqual(value.flow.getSnapshot().profile, latest);
  await value.flow.save({ name: 'Current', status: 'Back again' });
  assert.equal(value.getStored().revision, 6);
});

test('restored v2 removal intent stays explicit for newly accepted friends', async () => {
  const removed = JSON.stringify({ version: 2, revision: 7, name: 'Naya', status: 'Today', avatar: null });
  const value = setup({ history: async () => ({ incoming: [], outgoing: [
    { operation: 'remove-a', target: 'alice', audience: 'friend:friend-a', contentType: 'private-profile', plaintext: removed, status: 'sent', event: 'event-a' },
  ] }) });
  await value.flow.load();
  assert.equal(value.flow.getSnapshot().profile.avatarMode, 'removed');
  await value.flow.sync();
  assert.deepEqual(value.photoPublications.map(item => [item.targetId, item.photo]), [['bob', null]]);
});

test('same-friend same-revision avatar descriptor conflicts fail closed', async () => {
  const profile = avatar => JSON.stringify({ version: 2, revision: 4, name: 'Naya', status: 'Today', avatar: { version: 1, id: avatar, key: 'f'.repeat(64), size: 3, mimeType: 'image/png' } });
  const value = setup({
    photoStore: { read: async () => ({ mimeType: 'image/png', bytes: new Uint8Array([1]) }), write: async () => {}, clear: async () => {} },
    history: async () => ({ incoming: [], outgoing: [
      { operation: 'avatar-a', target: 'alice', audience: 'friend:friend-a', contentType: 'private-profile', plaintext: profile('avatar-a'), status: 'sent', event: 'event-a' },
      { operation: 'avatar-b', target: 'alice', audience: 'friend:friend-a', contentType: 'private-profile', plaintext: profile('avatar-b'), status: 'sent', event: 'event-b' },
    ] }),
  });
  await value.flow.load();
  await value.flow.sync();
  assert.equal(value.flow.getSnapshot().error, 'PROFILE_CONFLICT');
  assert.equal(value.photoPublications.length, 0);
});

test('account replacement during an accepted-friend page suppresses late profile sends', async () => {
  let finish;
  const value = setup({ acceptedFriends: () => new Promise(resolve => { finish = resolve; }) });
  await value.flow.load();
  const running = value.flow.save({ name: 'Sari', status: 'In the garden' });
  await new Promise(resolve => setImmediate(resolve));
  value.changeBinding('different-account/device/1');
  finish(page);
  await assert.rejects(running, { message: 'SESSION_CHANGED' });
  assert.equal(value.sends.length, 0);
});
