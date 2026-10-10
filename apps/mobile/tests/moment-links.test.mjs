import assert from 'node:assert/strict';
import test from 'node:test';
import { removeMomentAsset, updateMomentReply } from '../src/features/photos/moment-links.ts';
test('deleting a Moment shifts its images and reply links without changing another conversation', () => {
  assert.deepEqual(removeMomentAsset({ 'family-0': 'a', 'family-1': 'b', 'family-2': 'c', 'naya-1': 'd' }, 'family', 1), { 'family-0': 'a', 'family-1': 'c', 'naya-1': 'd' });
  assert.deepEqual(updateMomentReply({ kind: 'moment', index: 1, text: 'Original caption' }, 1), { kind: 'moment', index: 1, text: 'Original caption', deleted: true });
  assert.equal(updateMomentReply({ kind: 'moment', index: 2 }, 1).index, 1);
  assert.equal(updateMomentReply({ kind: 'message', index: 2 }, 1).index, 2);
});
