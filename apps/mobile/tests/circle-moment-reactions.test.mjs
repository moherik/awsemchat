import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCircleMomentReaction, encodeCircleMomentReaction, selectCircleMomentReactions } from '../src/features/messages/circle-moment-reactions.ts';

const reaction = (id, momentId, active = true, emoji = '❤️') => encodeCircleMomentReaction({ id, momentId, emoji, active });
const record = (operation, plaintext, { conversation = 'circle-a', audience = 'circle:3', identity = 'member-a', sequence = 1, direction = 'incoming', circle = 'circle-a' } = {}) => ({ operation, plaintext, conversation, audience, sender: { identity }, sequence, direction, circle, target: null, status: 'sent', event: `event-${operation}` });

test('reaction messages have a strict bounded encrypted body and approved emoji', () => {
  const body = reaction('reaction-1', 'moment-1');
  assert.deepEqual(decodeCircleMomentReaction(body), { version: 1, type: 'circle-moment-reaction', id: 'reaction-1', momentId: 'moment-1', emoji: '❤️', active: true });
  assert.equal(decodeCircleMomentReaction(JSON.stringify({ version: 1, type: 'circle-moment-reaction', id: 'r', momentId: 'm', emoji: '<script>', active: true })), undefined);
  assert.equal(decodeCircleMomentReaction(JSON.stringify({ version: 1, type: 'circle-moment-reaction', id: 'r', momentId: 'm', emoji: '❤️', active: true, extra: 1 })), undefined);
  assert.throws(() => encodeCircleMomentReaction({ id: 'r', momentId: 'm', emoji: '🔥', active: true }), /INVALID_CIRCLE_MOMENT_REACTION/);
});

test('reaction projection is scoped to the target Circle audience and keeps the sender latest choice', () => {
  const incoming = [
    record('r1', reaction('r1', 'moment-1'), { identity: 'member-a', sequence: 10 }),
    record('r2', reaction('r2', 'moment-1', true, '😂'), { identity: 'member-a', sequence: 12 }),
    record('r3', reaction('r3', 'moment-1', false, '😂'), { identity: 'member-b', sequence: 13 }),
    record('r4', reaction('r4', 'moment-1'), { audience: 'circle:2', sequence: 14 }),
    record('r5', reaction('r5', 'moment-1'), { conversation: 'circle-b', sequence: 15 }),
  ];
  const outgoing = [record('self-r', reaction('self-r', 'moment-1'), { identity: undefined, sequence: 16, direction: undefined })];
  const result = selectCircleMomentReactions({ incoming, outgoing }, 'circle-a', { id: 'moment-1', audience: 'circle:3' });
  assert.deepEqual(result, [{ emoji: '❤️', count: 1, reactedByMe: true }, { emoji: '😂', count: 1, reactedByMe: false }]);
});
