import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCircleMemberProfile, decodeCircleMemberProfile, selectCircleMemberProfile } from '../src/features/social/circle-member-profile.ts';

const profile = (revision, name, status) => ({ version: 1, revision, name, status });
const incoming = (revision, name, status, overrides = {}) => ({
  direction: 'incoming', contentType: 'circle-member-profile', conversation: 'circle-1', audience: 'circle:4',
  sequence: revision, sender: { identity: 'sender-key', signingIdentity: 'sender-signature' },
  plaintext: JSON.stringify(profile(revision, name, status)), ...overrides,
});

test('Circle member profile payloads validate and encode only the current name and status', () => {
  const encoded = encodeCircleMemberProfile({ revision: 3, name: 'Naya', status: 'Taking the scenic route' });
  assert.deepEqual(JSON.parse(encoded), profile(3, 'Naya', 'Taking the scenic route'));
  assert.deepEqual(decodeCircleMemberProfile(encoded), profile(3, 'Naya', 'Taking the scenic route'));
  assert.equal(decodeCircleMemberProfile(JSON.stringify({ ...profile(3, 'Naya', 'x'), phone: '+62812345678' })), undefined);
  assert.equal(decodeCircleMemberProfile(JSON.stringify(profile(0, 'Naya', 'x'))), undefined);
  assert.equal(decodeCircleMemberProfile(JSON.stringify(profile(4, 'Naya', 'x'.repeat(281)))), undefined);
});

test('Circle status selection is bound to the current Circle epoch and exact sender identity', () => {
  const result = selectCircleMemberProfile({ incoming: [
    incoming(2, 'Naya', 'Current', { sequence: 7 }),
    incoming(3, 'Naya', 'Other epoch', { audience: 'circle:3', sequence: 8 }),
    incoming(4, 'Mum', 'Other sender', { sender: { identity: 'other-key', signingIdentity: 'other-signature' }, sequence: 9 }),
  ], outgoing: [] }, 'circle-1', 'circle:4', { identity: 'sender-key', signingIdentity: 'sender-signature' });
  assert.deepEqual(result, { state: 'ready', profile: profile(2, 'Naya', 'Current') });
});

test('only the highest profile revision is selected and same-revision disagreement fails closed', () => {
  const history = { incoming: [incoming(1, 'Naya', 'Old'), incoming(4, 'Naya', 'Latest', { sequence: 2 })], outgoing: [] };
  assert.deepEqual(selectCircleMemberProfile(history, 'circle-1', 'circle:4', { identity: 'sender-key', signingIdentity: 'sender-signature' }), { state: 'ready', profile: profile(4, 'Naya', 'Latest') });
  history.incoming.push(incoming(4, 'Naya', 'Conflicting', { sequence: 3 }));
  assert.deepEqual(selectCircleMemberProfile(history, 'circle-1', 'circle:4', { identity: 'sender-key', signingIdentity: 'sender-signature' }), { state: 'conflict', revision: 4 });
});

test('queued, rejected, and malformed status controls never become sender profiles', () => {
  const history = { incoming: [
    incoming(4, 'Naya', 'Queued', { direction: 'outgoing', sequence: undefined }),
    incoming(5, 'Naya', 'Malformed', { plaintext: '{' }),
  ], outgoing: [] };
  assert.deepEqual(selectCircleMemberProfile(history, 'circle-1', 'circle:4', { identity: 'sender-key', signingIdentity: 'sender-signature' }), { state: 'invalid' });
  assert.deepEqual(selectCircleMemberProfile({ incoming: [], outgoing: [] }, 'circle-1', 'circle:4', { identity: 'sender-key', signingIdentity: 'sender-signature' }), { state: 'empty' });
});
