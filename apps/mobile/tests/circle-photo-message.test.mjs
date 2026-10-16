import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCirclePhotoMessage, encodeCirclePhotoMessage } from '../src/features/messages/circle-photo-message.ts';

const image = { epoch: 3, media: { version: 1, id: 'photo-1', key: 'c'.repeat(64), size: 128, mimeType: 'image/jpeg' } };

test('Circle photo message preserves caption and encrypted image descriptor', () => {
  const body = encodeCirclePhotoMessage({ id: 'photo-message-1', caption: 'Sunday together', image });
  assert.deepEqual(decodeCirclePhotoMessage(body), { version: 1, type: 'circle-photo-message', id: 'photo-message-1', caption: 'Sunday together', image });
});

test('Circle photo message rejects invalid audience, caption and additional fields', () => {
  assert.equal(decodeCirclePhotoMessage(JSON.stringify({ version: 1, type: 'circle-photo-message', id: 'p', caption: '', image: { ...image, epoch: 0 } })), undefined);
  assert.throws(() => encodeCirclePhotoMessage({ id: 'p', caption: 'x'.repeat(281), image }), /INVALID_CIRCLE_PHOTO_MESSAGE/);
  assert.equal(decodeCirclePhotoMessage(JSON.stringify({ version: 1, type: 'circle-photo-message', id: 'p', caption: '', image, unexpected: true })), undefined);
});
