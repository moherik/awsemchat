import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCircleStickerMessage, encodeCircleStickerMessage, encodePersonalCircleStickerMessage } from '../src/features/messages/circle-sticker-message.ts';

const item = {
  id: 'sticker-1', kind: 'sticker', label: 'Weekend joy',
  image: { epoch: 2, media: { version: 1, id: 'media-1', key: 'a'.repeat(64), size: 1024, mimeType: 'image/png' } },
};

test('a Circle sticker message preserves the encrypted media descriptor for its fixed recipients', () => {
  const encoded = encodeCircleStickerMessage(item);
  const decoded = decodeCircleStickerMessage(encoded);
  assert.equal(decoded.item, item.id);
  assert.equal(decoded.label, item.label);
  assert.deepEqual(decoded.image, item.image);
});

test('ordinary message text is not mistaken for a Circle sticker', () => {
  assert.equal(decodeCircleStickerMessage('Weekend joy'), undefined);
});

test('malformed or oversized Circle sticker messages are rejected', () => {
  assert.equal(decodeCircleStickerMessage('{"version":1,"type":"circle-sticker"}'), undefined);
  assert.equal(decodeCircleStickerMessage('x'.repeat(5000)), undefined);
  assert.throws(() => encodeCircleStickerMessage({ ...item, kind: 'emoji' }), /INVALID_CIRCLE_STICKER/);
});

test('a personal sticker message uses a caller-owned unique item ID without collection metadata', () => {
  const encoded = encodePersonalCircleStickerMessage({ id: 'operation-one', label: 'Made for you', image: item.image });
  const decoded = decodeCircleStickerMessage(encoded);
  assert.deepEqual(decoded, { version: 1, type: 'circle-sticker', item: 'operation-one', label: 'Made for you', image: item.image });
  assert.equal(encoded.includes('collection'), false);
});
