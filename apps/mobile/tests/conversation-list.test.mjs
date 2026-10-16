import test from 'node:test';
import assert from 'node:assert/strict';
import { projectConversations } from '../src/features/messages/conversation-list.ts';
import { encodeCircleProfile } from '../src/features/social/circle-profile.ts';
import { encodeCircleMoment } from '../src/features/messages/circle-moments.ts';

const friends = [
  { accountId: 'peer-one', pin: 'NAYA47', status: 'accepted', requestId: 'request-current' },
  { accountId: 'peer-two', pin: 'RAKA12', status: 'accepted', requestId: 'request-two' },
];
const circles = [
  { id: 'circle-one', epoch: 2, memberCount: 4, closed: false, intervalId: 'interval-one', role: 'admin', joinedEpoch: 1 },
];
const history = (incoming = [], outgoing = []) => ({ incoming, outgoing });
const record = (fields) => ({ operation: 'message-one', conversation: 'private-one', audience: 'friend:request-current', sender: { identity: 'peer-key', signingIdentity: 'peer-signing' }, plaintext: 'hello', archival: false, ...fields });
const options = (value = {}) => ({ friends, circles, history: history(), preferences: {}, filter: 'All', query: '', ...value });

test('private rows use only the currently accepted friendship audience', () => {
  const rows = projectConversations(options({ history: history([
    record({ plaintext: 'current message' }),
    record({ operation: 'old-message', audience: 'friend:request-old', plaintext: 'old friendship' }),
  ]) }));
  const peer = rows.find(row => row.id === 'private:peer-one');
  assert.equal(peer.preview, 'current message');
  assert.equal(rows.find(row => row.id === 'private:peer-two').preview, 'Start a private chat');
});

test('Circle rows use the latest accepted encrypted Circle profile and ordinary chat preview', () => {
  const profile = encodeCircleProfile({ name: 'The home team', description: 'Family', avatar: null });
  const rows = projectConversations(options({ history: history([
    record({ operation: 'circle-message', conversation: 'circle-one', audience: 'circle:2', plaintext: 'Dinner at seven', sequence: 9 }),
    record({ operation: 'moment', conversation: 'circle-one', audience: 'circle:2', plaintext: encodeCircleMoment({ id: 'moment', caption: 'Moment only' }), sequence: 10 }),
    record({ operation: 'profile', conversation: 'circle-one', audience: 'circle:2', contentType: 'circle-profile', profileAccepted: true, profileRevision: 2, plaintext: profile, sequence: 11 }),
  ]) }));
  const circle = rows.find(row => row.id === 'circle:circle-one');
  assert.equal(circle.title, 'The home team');
  assert.equal(circle.preview, 'Dinner at seven');
  assert.equal(circle.subtitle, '4 people · Circle');
});

test('filters and search apply to real conversation titles and previews', () => {
  const rows = projectConversations(options({ query: 'dinner', history: history([
    record({ operation: 'circle-message', conversation: 'circle-one', audience: 'circle:2', plaintext: 'Dinner plans' }),
  ]) }));
  assert.deepEqual(rows.map(row => row.id), ['circle:circle-one']);
  assert.deepEqual(projectConversations(options({ filter: 'Private' })).map(row => row.kind), ['private', 'private']);
  assert.deepEqual(projectConversations(options({ filter: 'Circles' })).map(row => row.kind), ['circle']);
});

test('pinned conversations sort first, then by recent history, and archived rows are hidden', () => {
  const rows = projectConversations(options({
    preferences: { 'private:peer-two': { pinned: true }, 'private:peer-one': { archived: true } },
    history: history([
      record({ operation: 'newer', conversation: 'private-two', audience: 'friend:request-two', sequence: 2, createdAt: 20, plaintext: 'Recent' }),
      record({ operation: 'older', conversation: 'private-one', audience: 'friend:request-current', sequence: 100, createdAt: 10, plaintext: 'Older' }),
    ]),
  }));
  assert.deepEqual(rows.map(row => row.id), ['private:peer-two', 'circle:circle-one']);
  assert.equal(rows[0].pinned, true);
});

test('a missing Circle profile uses a neutral title instead of an internal ID', () => {
  const row = projectConversations(options()).find(item => item.kind === 'circle');
  assert.equal(row.title, 'Circle');
  assert.equal(row.title.includes('circle-one'), false);
});

test('archived projection includes only archived conversations', () => {
  const rows = projectConversations(options({ archived: 'only', preferences: { 'private:peer-one': { archived: true } } }));
  assert.deepEqual(rows.map(row => row.id), ['private:peer-one']);
  assert.equal(rows[0].archived, true);
});

test('Circle previews and profiles exclude epochs before the current membership began', () => {
  const rows = projectConversations(options({
    circles: [{ ...circles[0], epoch: 4, joinedEpoch: 3 }],
    history: history([
      record({ operation: 'old', conversation: 'circle-one', audience: 'circle:2', plaintext: 'Before I rejoined', sequence: 99, contentType: 'chat' }),
      record({ operation: 'new', conversation: 'circle-one', audience: 'circle:3', plaintext: 'Welcome back', sequence: 1, contentType: 'chat' }),
    ]),
  }));
  const circle = rows.find(row => row.kind === 'circle');
  assert.equal(circle.preview, 'Welcome back');
});
