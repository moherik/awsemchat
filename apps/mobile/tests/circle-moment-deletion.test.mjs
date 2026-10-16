import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCircleMoment } from '../src/features/messages/circle-moments.ts';
import { decodeCircleMomentDeletion, encodeCircleMomentDeletion } from '../src/features/messages/circle-moment-deletion.ts';
import { selectCircleMoments } from '../src/features/messages/circle-moments.ts';

test('Moment deletion codec accepts only a bounded typed reference', () => {
  const body = encodeCircleMomentDeletion({ id: 'delete-1', momentId: 'moment-1' });
  assert.deepEqual(decodeCircleMomentDeletion(body), { version: 1, type: 'circle-moment-deletion', id: 'delete-1', momentId: 'moment-1' });
  assert.equal(decodeCircleMomentDeletion('{"version":1,"type":"circle-moment-deletion","id":"d","momentId":"m","extra":true}'), undefined);
});

test('only the Moment author deletion in the same audience hides it', () => {
  const moment = encodeCircleMoment({ id: 'moment-1', caption: 'Sunday together' });
  const deletion = id => encodeCircleMomentDeletion({ id, momentId: 'moment-1' });
  const incoming = [
    { operation: 'author-post', conversation: 'circle-a', audience: 'circle:2', plaintext: moment, sender: { identity: 'author' }, sequence: 2 },
    { operation: 'other-post', conversation: 'circle-a', audience: 'circle:2', plaintext: encodeCircleMoment({ id: 'moment-2', caption: 'Another moment' }), sender: { identity: 'other' }, sequence: 1 },
    { operation: 'forged-delete', conversation: 'circle-a', audience: 'circle:2', plaintext: deletion('forged-delete'), sender: { identity: 'other' }, sequence: 3 },
    { operation: 'late-delete', conversation: 'circle-a', audience: 'circle:3', plaintext: deletion('late-delete'), sender: { identity: 'author' }, sequence: 4 },
  ];
  assert.deepEqual(selectCircleMoments({ incoming, outgoing: [] }, 'circle-a').map(item => item.id), ['moment-2', 'moment-1']);
  incoming.push({ operation: 'author-delete', conversation: 'circle-a', audience: 'circle:2', plaintext: deletion('author-delete'), sender: { identity: 'author' }, sequence: 5 });
  assert.deepEqual(selectCircleMoments({ incoming, outgoing: [] }, 'circle-a').map(item => item.id), ['moment-2']);
});

