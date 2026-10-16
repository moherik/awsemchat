import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCircleMoment, encodeCircleMoment, selectCircleMoments } from '../src/features/messages/circle-moments.ts';

const media = { epoch: 3, media: { version: 1, id: 'photo-1', key: 'b'.repeat(64), size: 4096, mimeType: 'image/jpeg' } };

test('Circle Moment body round-trips caption and optional encrypted media descriptor', () => {
  const body = encodeCircleMoment({ id: 'moment-1', caption: 'Sunday together', media });
  assert.deepEqual(decodeCircleMoment(body), { version: 1, type: 'circle-moment', id: 'moment-1', caption: 'Sunday together', media });
});

test('Circle Moment codec rejects malformed descriptors, fields, and oversized content', () => {
  assert.equal(decodeCircleMoment('{"version":1,"type":"circle-moment"}'), undefined);
  assert.equal(decodeCircleMoment(JSON.stringify({ version: 1, type: 'circle-moment', id: 'moment-1', caption: 'hello', extra: true })), undefined);
  assert.equal(decodeCircleMoment('x'.repeat(5000)), undefined);
  assert.throws(() => encodeCircleMoment({ id: 'moment-1', caption: 'x'.repeat(281) }), /INVALID_CIRCLE_MOMENT/);
});

test('Moment selector only returns delivered accessible Moments for the requested Circle', () => {
  const body = id => encodeCircleMoment({ id, caption: 'Sunday together', media });
  const incoming = [
    { operation: 'from-friend', conversation: 'circle-a', audience: 'circle:2', plaintext: body('friend-moment'), sender: { identity: 'sender-a', signingIdentity: 'sign-a' }, sequence: 8, createdAt: 10 },
    { operation: 'other-circle', conversation: 'circle-b', audience: 'circle:2', plaintext: body('other-moment'), sender: { identity: 'sender-b', signingIdentity: 'sign-b' }, sequence: 4, createdAt: 9 },
    { operation: 'plain', conversation: 'circle-a', audience: 'circle:2', plaintext: 'just a chat message', sender: { identity: 'sender-a', signingIdentity: 'sign-a' }, sequence: 9, createdAt: 11 },
  ];
  const outgoing = [
    { operation: 'own-moment', conversation: 'circle-a', audience: 'circle:2', circle: 'circle-a', target: null, plaintext: body('own-moment'), status: 'delivered', event: 'event-1', sequence: 7, createdAt: 8 },
    { operation: 'pending', conversation: 'circle-a', audience: 'circle:2', circle: 'circle-a', target: null, plaintext: body('pending-moment'), status: 'queued', event: null, sequence: 10, createdAt: null },
    { operation: 'wrong-audience', conversation: 'circle-a', audience: 'circle:2', circle: 'circle-b', target: null, plaintext: body('forged-route'), status: 'sent', event: 'event-2' },
  ];
  const result = selectCircleMoments({ incoming, outgoing }, 'circle-a');
  assert.deepEqual(result.map(item => item.id), ['own-moment', 'friend-moment', 'pending-moment']);
  assert.equal(result[1].caption, 'Sunday together');
});
