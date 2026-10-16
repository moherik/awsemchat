import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateProfilePhotoPublisher } from '../src/features/social/private-profile-photo-publisher.ts';

const peerId = 'alice', requestId = 'friend-a', conversation = `private:${'a'.repeat(64)}`;
const prepared = { descriptor: { version: 1, id: 'avatar-a', key: 'f'.repeat(64), size: 3, mimeType: 'image/png' }, ciphertext: 'AQIDBA==' };

function fixture(overrides = {}) {
  let saved = null, binding = 'account/device/generation';
  const calls = [], failSend = { value: true };
  const ports = {
    binding: () => binding,
    context: async ({ targetId }) => ({ conversation, audience: `friend:${requestId}`, recipients: [{ accountId: targetId }] }),
    media: {
      prepare: async photo => { calls.push(['prepare', photo.bytes.slice()]); return prepared; },
      restore: async value => value,
      upload: async (value, operation) => { calls.push(['upload', value.ciphertext, operation]); return value.descriptor; },
    },
    vault: { read: async () => saved, write: async value => { saved = value; }, clear: async () => { saved = null; } },
    send: async draft => { calls.push(['send', draft]); if (failSend.value) { failSend.value = false; throw new Error('NETWORK'); } return { id: 'event-1', operation: draft.operation, status: 'sent' }; },
    ...overrides,
  };
  const publisher = createPrivateProfilePhotoPublisher(ports, { peerId, requestId });
  return { publisher, ports, calls, get saved() { return saved; }, set binding(value) { binding = value; }, failSend };
}

test('private avatar keeps the same friendship-bound ciphertext and profile event across an uncertain send', async () => {
  const f = fixture(), input = { revision: 3, name: 'Naya', status: 'Taking the scenic route', photo: { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, operation: 'profile-3-friend-a' };
  await assert.rejects(f.publisher.publish(input), { message: 'NETWORK' });
  assert.ok(f.saved);
  const first = f.calls.find(call => call[0] === 'send')[1];
  const decoded = JSON.parse(first.plaintext);
  assert.equal(first.targetId, peerId);
  assert.equal(first.contentType, 'private-profile');
  assert.equal(decoded.version, 2);
  assert.equal(decoded.avatar.id, prepared.descriptor.id);
  assert.equal(decoded.revision, input.revision);

  const recovered = createPrivateProfilePhotoPublisher(f.ports, { peerId, requestId });
  const originalContext = f.ports.context;
  f.ports.context = async ({ targetId }) => ({ conversation, audience: 'friend:replaced-request', recipients: [{ accountId: targetId }] });
  await assert.rejects(recovered.retry(), { message: 'CONTEXT_MISMATCH' });
  assert.equal(f.calls.length, 3);
  f.ports.context = originalContext;
  await recovered.retry();
  assert.deepEqual(f.calls.filter(call => call[0] === 'upload').map(call => call.slice(1)), [
    [prepared.ciphertext, first.operation], [prepared.ciphertext, first.operation],
  ]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'send').map(call => call[1]), [first, first]);
  assert.equal(f.saved, null);
});

test('avatar removal publishes explicit version 2 null without uploading media', async () => {
  const f = fixture(); f.failSend.value = false;
  await f.publisher.publish({ revision: 4, name: 'Naya', status: 'Taking the scenic route', photo: null, operation: 'profile-4-friend-a' });
  const draft = f.calls.find(call => call[0] === 'send')[1];
  assert.equal(JSON.parse(draft.plaintext).avatar, null);
  assert.equal(JSON.parse(draft.plaintext).version, 2);
  assert.equal(f.calls.some(call => call[0] === 'upload'), false);
});

test('profile photo publication rejects a changed friendship audience before media upload', async () => {
  const f = fixture({ context: async ({ targetId }) => ({ conversation, audience: 'friend:replaced-request', recipients: [{ accountId: targetId }] }) });
  await assert.rejects(f.publisher.publish({ revision: 1, name: 'Naya', status: '', photo: { mimeType: 'image/png', bytes: new Uint8Array([1]) }, operation: 'profile-1-friend-a' }), { message: 'CONTEXT_MISMATCH' });
  assert.equal(f.calls.length, 0);
});

test('each friendship gets its own encrypted media object and operation', async () => {
  const first = fixture({ media: { ...fixture().ports.media, prepare: async () => ({ ...prepared, descriptor: { ...prepared.descriptor, id: 'avatar-alice' } }) } });
  const secondPorts = {
    ...first.ports,
    context: async ({ targetId }) => ({ conversation: `private:${'b'.repeat(64)}`, audience: 'friend:friend-b', recipients: [{ accountId: targetId }] }),
    media: { ...first.ports.media, prepare: async () => ({ ...prepared, descriptor: { ...prepared.descriptor, id: 'avatar-bob' } }) },
    vault: { read: async () => null, write: async () => {}, clear: async () => {} },
    send: async draft => { first.calls.push(['second-send', draft]); return { id: 'event-2', operation: draft.operation, status: 'sent' }; },
  };
  const alice = createPrivateProfilePhotoPublisher(first.ports, { peerId: 'alice', requestId: 'friend-a' });
  const bob = createPrivateProfilePhotoPublisher(secondPorts, { peerId: 'bob', requestId: 'friend-b' });
  first.failSend.value = false;
  const profile = { revision: 2, name: 'Naya', status: 'Today', photo: { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) } };
  await alice.publish({ ...profile, operation: 'profile-a' });
  await bob.publish({ ...profile, operation: 'profile-b' });
  const sent = first.calls.filter(call => call[0] === 'send').map(call => call[1]).concat(first.calls.filter(call => call[0] === 'second-send').map(call => call[1]));
  assert.deepEqual(sent.map(draft => [draft.targetId, draft.operation, JSON.parse(draft.plaintext).avatar.id]), [['alice', 'profile-a', 'avatar-alice'], ['bob', 'profile-b', 'avatar-bob']]);
});

test('a newer profile revision first drains the exact saved older publication', async () => {
  const f = fixture(), photo = { mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) };
  await assert.rejects(f.publisher.publish({ revision: 3, name: 'Naya', status: 'First', photo, operation: 'profile-3' }), { message: 'NETWORK' });
  await f.publisher.publish({ revision: 4, name: 'Naya', status: 'Second', photo, operation: 'profile-4' });
  assert.deepEqual(f.calls.filter(call => call[0] === 'send').map(call => [call[1].operation, JSON.parse(call[1].plaintext).revision, JSON.parse(call[1].plaintext).status]), [
    ['profile-3', 3, 'First'], ['profile-3', 3, 'First'], ['profile-4', 4, 'Second'],
  ]);
});
