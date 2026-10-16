import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateProfilePublicationStorage } from '../src/features/social/private-profile-photo-publication-storage.ts';

test('friend publication vaults use separate encrypted-data keys from source photos and each other', async () => {
  const values = new Map([['profile:photo', 'source-photo']]);
  const database = { getData: async key => values.get(key), setData: async (key, value) => { values.set(key, value); } };
  const first = createPrivateProfilePublicationStorage(database, 'alice', 'request-a');
  const second = createPrivateProfilePublicationStorage(database, 'alice', 'request-b');
  const job = { version: 1, operation: 'profile-1' };
  await first.write(job);
  assert.deepEqual(await first.read(), job);
  assert.equal(await second.read(), null);
  assert.equal(values.get('profile:photo'), 'source-photo');
  assert.ok(values.has('profile:publication:alice:request-a'));
  await first.clear();
  assert.equal(await first.read(), null);
  assert.equal(values.get('profile:photo'), 'source-photo');
});

test('publication vault rejects malformed friendship identifiers', () => {
  const database = { getData: async () => undefined, setData: async () => {} };
  assert.throws(() => createPrivateProfilePublicationStorage(database, '../alice', 'request-a'), { message: 'INVALID_PROFILE_BINDING' });
});
