import test from 'node:test';
import assert from 'node:assert/strict';
import * as codec from '../src/features/messages/private-sticker-message.ts';

const media = { version: 1, id: 'media-one', key: 'a'.repeat(64), size: 4, mimeType: 'image/png' };

test('private sticker messages bind their encrypted media to a friendship audience', () => {
  assert.equal(typeof codec.encodePrivateStickerMessage, 'function', 'private sticker message codec is missing');
  const encoded = codec.encodePrivateStickerMessage({ id: 'sticker-operation', audience: 'friend:accepted-1', label: 'Little wave', media });
  assert.deepEqual(codec.decodePrivateStickerMessage(encoded), {
    version: 1, type: 'private-sticker-message', id: 'sticker-operation', audience: 'friend:accepted-1', label: 'Little wave', media,
  });
});

test('private sticker parser rejects invalid audiences or extra fields', () => {
  assert.equal(typeof codec.decodePrivateStickerMessage, 'function', 'private sticker message decoder is missing');
  const valid = { version: 1, type: 'private-sticker-message', id: 'sticker-operation', audience: 'friend:accepted-1', label: 'Wave', media };
  assert.equal(codec.decodePrivateStickerMessage(JSON.stringify({ ...valid, audience: 'circle:2' })), undefined);
  assert.equal(codec.decodePrivateStickerMessage(JSON.stringify({ ...valid, plaintext: 'hidden data' })), undefined);
});
