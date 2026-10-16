import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePrivateProfile, encodePrivateProfile, selectPrivateProfile } from '../src/features/social/private-profile.ts';
import { conversationMessages } from '../src/features/messages/conversation-view.ts';

const conversation = `private:${'b'.repeat(64)}`;
const audience = 'friend:request-9';
const profile = (revision, name, status) => ({ version: 1, revision, name, status });
const avatar = (id = 'photo-one') => ({ version: 1, id, key: 'f'.repeat(64), size: 1024, mimeType: 'image/jpeg' });
const received = (sequence, name, status, extra = {}) => ({
  operation: `profile-${sequence}`, conversation, audience, sequence,
  plaintext: JSON.stringify(profile(sequence, name, status)), contentType: 'private-profile',
  sender: { identity: 'friend-key', signingIdentity: 'friend-signing' }, ...extra,
});

test('private profile encoding trims names and preserves the current status', () => {
  const encoded = encodePrivateProfile({ revision: 3, name: '  Naya  ', status: 'Taking the scenic route' });
  assert.deepEqual(decodePrivateProfile(encoded), profile(3, 'Naya', 'Taking the scenic route'));
});

test('private profile v2 carries a validated end-to-end media descriptor or an explicit removal', () => {
  const encoded = encodePrivateProfile({ revision: 4, name: 'Naya', status: 'Today', avatar: avatar() });
  assert.deepEqual(JSON.parse(encoded), { version: 2, revision: 4, name: 'Naya', status: 'Today', avatar: avatar() });
  assert.deepEqual(decodePrivateProfile(encoded), { version: 2, revision: 4, name: 'Naya', status: 'Today', avatar: avatar() });
  assert.deepEqual(JSON.parse(encodePrivateProfile({ revision: 5, name: 'Naya', status: 'Today', avatar: null })), {
    version: 2, revision: 5, name: 'Naya', status: 'Today', avatar: null,
  });
  assert.deepEqual(decodePrivateProfile(JSON.stringify(profile(3, 'Naya', 'Legacy'))), profile(3, 'Naya', 'Legacy'));
});

test('private profile v2 rejects unsafe or malformed media descriptors', () => {
  for (const value of [
    { ...avatar(), key: 'not-a-key' },
    { ...avatar(), size: 0 },
    { ...avatar(), mimeType: 'text/plain' },
    { ...avatar(), objectId: 'unknown-field' },
  ]) assert.throws(() => encodePrivateProfile({ revision: 1, name: 'Naya', status: '', avatar: value }), { message: 'INVALID_PROFILE' });
});

test('private profile schema rejects empty, oversized, malformed, and unknown fields', () => {
  for (const value of [
    { revision: 1, name: ' ', status: '' },
    { revision: 1, name: '😀'.repeat(81), status: '' },
    { revision: 1, name: 'Naya', status: 'x'.repeat(281) },
    { revision: 1, name: 'Naya\u0000', status: '' },
  ]) assert.throws(() => encodePrivateProfile(value), { message: 'INVALID_PROFILE' });
  assert.equal(decodePrivateProfile('{'), undefined);
  assert.equal(decodePrivateProfile('{"version":1,"revision":1,"name":"Naya","status":"","phone":"secret"}'), undefined);
});

test('latest profile comes only from accepted history in the exact friendship audience', () => {
  const old = received(1, 'Naya', 'Old', { audience: 'friend:old-request' });
  const wrongConversation = received(3, 'Naya', 'Elsewhere', { conversation: `private:${'c'.repeat(64)}` });
  const newest = received(2, 'Naya', 'Current');
  assert.deepEqual(selectPrivateProfile({ incoming: [newest, old, wrongConversation], outgoing: [] }, conversation, audience), {
    state: 'ready', profile: profile(2, 'Naya', 'Current'),
  });
});

test('unaccepted, outgoing, malformed, and conflicting latest profile records fail closed', () => {
  const pending = received(3, 'Naya', 'Unaccepted', { profileAccepted: false });
  assert.deepEqual(selectPrivateProfile({ incoming: [pending], outgoing: [] }, conversation, audience), { state: 'empty' });
  const old = received(1, 'Naya', 'Old');
  const malformed = received(2, 'Naya', 'Bad', { plaintext: '{' });
  assert.deepEqual(selectPrivateProfile({ incoming: [old, malformed], outgoing: [] }, conversation, audience), { state: 'invalid' });
  assert.deepEqual(selectPrivateProfile({ incoming: [received(2, 'Naya', 'A'), received(2, 'Naya', 'B')], outgoing: [] }, conversation, audience), { state: 'conflict', revision: 2 });
  const own = received(3, 'You', 'Private', { direction: 'outgoing' });
  assert.deepEqual(selectPrivateProfile({ incoming: [own], outgoing: [] }, conversation, audience), { state: 'empty' });
});

test('same-revision private profiles with different friend-scoped avatar grants conflict', () => {
  const first = received(2, 'Naya', 'Today', { plaintext: JSON.stringify({ version: 2, revision: 2, name: 'Naya', status: 'Today', avatar: avatar('photo-a') }) });
  const second = received(2, 'Naya', 'Today', { plaintext: JSON.stringify({ version: 2, revision: 2, name: 'Naya', status: 'Today', avatar: avatar('photo-b') }) });
  assert.deepEqual(selectPrivateProfile({ incoming: [first, second], outgoing: [] }, conversation, audience), { state: 'conflict', revision: 2 });
});

test('private profile control events never appear as Chat bubbles', () => {
  const row = received(1, 'Naya', 'Taking the scenic route');
  const normal = { operation: 'message', conversation, audience, plaintext: 'See you soon', contentType: 'text', sender: row.sender };
  assert.deepEqual(conversationMessages({ incoming: [row, normal], outgoing: [] }, conversation).map(item => item.text), ['See you soon']);
});
