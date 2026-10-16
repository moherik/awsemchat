import test from 'node:test';
import assert from 'node:assert/strict';
import { availableStickerPacks } from '../src/features/stickers/personal-sticker-packs.ts';

test('native maker pack choices come from the saved personal sticker library', () => {
  assert.deepEqual(availableStickerPacks([
    { id: '1', artwork: { pack: 'Weekend' } },
    { id: '2', artwork: { pack: 'Family' } },
    { id: '3', artwork: { pack: 'Weekend' } },
    { id: '4', artwork: { pack: '  ' } },
  ]), ['Family', 'Weekend']);
});

test('native maker has no invented sample packs when the library is empty', () => {
  assert.deepEqual(availableStickerPacks([]), []);
});
