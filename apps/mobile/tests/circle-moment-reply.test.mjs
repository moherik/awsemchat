import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCircleMomentReply, encodeCircleMomentReply } from '../src/features/messages/circle-moment-reply.ts';

const moment = { id: 'moment-1', audience: 'circle:3', caption: 'Sunday together', media: { epoch: 3, media: { version: 1, id: 'photo-1', key: 'a'.repeat(64), size: 1024, mimeType: 'image/jpeg' } } };

test('Moment reply body preserves the message and embedded accessible preview', () => {
  const body = encodeCircleMomentReply({ id: 'reply-1', moment, text: 'What a lovely day' });
  assert.deepEqual(decodeCircleMomentReply(body), { version: 1, type: 'circle-moment-reply', id: 'reply-1', text: 'What a lovely day', moment });
});

test('Moment reply codec rejects audience mismatch, extra fields, empty text, and oversized bodies', () => {
  assert.throws(() => encodeCircleMomentReply({ id: 'reply-1', moment: { ...moment, audience: 'circle:2' }, text: 'Hello' }), /INVALID_CIRCLE_MOMENT_REPLY/);
  assert.equal(decodeCircleMomentReply(JSON.stringify({ version: 1, type: 'circle-moment-reply', id: 'r', text: 'Hi', moment, unsafe: true })), undefined);
  assert.throws(() => encodeCircleMomentReply({ id: 'reply-1', moment, text: ' ' }), /INVALID_CIRCLE_MOMENT_REPLY/);
  assert.throws(() => encodeCircleMomentReply({ id: 'reply-1', moment, text: 'x'.repeat(8001) }), /INVALID_CIRCLE_MOMENT_REPLY/);
});
