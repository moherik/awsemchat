import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEditedPhotoDataUri } from '../src/features/messages/circle-photo-data.ts';

test('filtered PNG data URIs decode to the original bytes and MIME type', () => {
  assert.deepEqual(decodeEditedPhotoDataUri('data:image/png;base64,AAECA/8='), {
    mimeType: 'image/png',
    bytes: new Uint8Array([0, 1, 2, 3, 255]),
  });
});

test('photo data URI decoding rejects malformed, unsupported and oversized images', () => {
  assert.equal(decodeEditedPhotoDataUri('data:image/png;base64,%%%'), undefined);
  assert.equal(decodeEditedPhotoDataUri('data:text/plain;base64,SGk='), undefined);
  assert.equal(decodeEditedPhotoDataUri(`data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`), undefined);
});
