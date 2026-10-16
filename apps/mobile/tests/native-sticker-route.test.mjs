import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeStickerRoute } from '../src/features/native-sticker-route.ts';

test('native sticker routes use production personal and Circle libraries', () => {
  assert.equal(resolveNativeStickerRoute('library', undefined), 'personal-library');
  assert.equal(resolveNativeStickerRoute('circle', 'circle-42'), 'circle-library');
  assert.equal(resolveNativeStickerRoute('maker', 'circle-42'), 'maker');
});

test('Circle collection route requires a Circle identity', () => {
  assert.equal(resolveNativeStickerRoute('circle', undefined), 'unavailable');
});
