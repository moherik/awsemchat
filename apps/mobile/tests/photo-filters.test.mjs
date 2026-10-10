import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPixels } from '../src/features/photos/filters.ts';
test('filters preserve alpha and leave the original image pixels intact', () => {
  const original = new Uint8Array([200, 100, 50, 120]);
  const mono = filterPixels(original, 'Mono');
  assert.equal(mono[0], mono[1]); assert.equal(mono[1], mono[2]); assert.equal(mono[3], 120);
  assert.deepEqual([...original], [200, 100, 50, 120]);
  assert.deepEqual([...filterPixels(original, 'Original')], [...original]);
});
