import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateProfilePhotoStore } from '../src/features/social/private-profile-photo-store.ts';

function fixture() {
  let binding = 'account-a/device-1/generation-1', value = null;
  const store = createPrivateProfilePhotoStore({
    binding: () => binding,
    storage: { read: async () => value, write: async next => { value = next; }, clear: async () => { value = null; } },
  });
  return { store, readRaw: () => value, setRaw: next => { value = next; }, changeBinding: next => { binding = next; } };
}

test('profile photo bytes round-trip through the encrypted storage port and are copied', async () => {
  const value = fixture(), input = new Uint8Array([0, 1, 127, 255]);
  await value.store.write({ mimeType: 'image/jpeg', bytes: input });
  input.fill(9);
  assert.deepEqual(await value.store.read(), { mimeType: 'image/jpeg', bytes: new Uint8Array([0, 1, 127, 255]) });
  assert.equal(value.readRaw().includes('image/jpeg'), true);
});

test('profile photo storage rejects unsupported types and oversized images', async () => {
  const value = fixture();
  await assert.rejects(value.store.write({ mimeType: 'text/plain', bytes: new Uint8Array([1]) }), { message: 'INVALID_PROFILE_PHOTO' });
  await assert.rejects(value.store.write({ mimeType: 'image/png', bytes: new Uint8Array(2 * 1024 * 1024 + 1) }), { message: 'INVALID_PROFILE_PHOTO' });
});

test('corrupt saved profile photos fail closed and are not treated as removed', async () => {
  const value = fixture();
  value.setRaw('{');
  await assert.rejects(value.store.read(), { message: 'PROFILE_PHOTO_UNAVAILABLE' });
});

test('profile photo store refuses results after the account binding changes', async () => {
  const value = fixture();
  await value.store.write({ mimeType: 'image/png', bytes: new Uint8Array([1, 2]) });
  value.changeBinding('account-b/device-2/generation-1');
  await assert.rejects(value.store.read(), { message: 'SESSION_CHANGED' });
  await assert.rejects(value.store.clear(), { message: 'SESSION_CHANGED' });
});

test('clear removes the saved source photo explicitly', async () => {
  const value = fixture();
  await value.store.write({ mimeType: 'image/webp', bytes: new Uint8Array([3]) });
  await value.store.clear();
  assert.equal(await value.store.read(), undefined);
});
