import test from 'node:test';
import assert from 'node:assert/strict';
import { photoExtension } from '../src/features/photos/photo-extension.ts';

test('photo extension follows supported data URI MIME types', () => {
  assert.equal(photoExtension('data:image/jpeg;base64,YQ=='), 'jpg');
  assert.equal(photoExtension('data:image/png;base64,YQ=='), 'png');
  assert.equal(photoExtension('data:image/webp;base64,YQ=='), 'webp');
});

test('photo extension resolves remote paths and safely defaults unknown paths', () => {
  assert.equal(photoExtension('https://cdn.example/image.gif?size=small'), 'gif');
  assert.equal(photoExtension('file:///cache/photo.webp'), 'webp');
  assert.equal(photoExtension('data:text/plain;base64,YQ=='), 'jpg');
});
