import test from 'node:test';
import assert from 'node:assert/strict';
import { openLastLocalBackupStorage } from '../src/features/backup/last-local-backup-storage.ts';

test('stores only a bounded timestamp under its account-scoped encrypted data namespace', async () => {
  const data = new Map();
  const calls = [];
  const storage = await openLastLocalBackupStorage('backup-meta-one', async namespace => {
    calls.push(namespace);
    return {
      getData: async key => data.get(`${namespace}:${key}`),
      setData: async (key, value) => { data.set(`${namespace}:${key}`, value); },
    };
  });

  assert.equal(await storage.read(), null);
  await storage.write('2026-10-15T04:30:00.000Z');
  assert.deepEqual(calls, ['backup-meta-one']);
  assert.equal(data.get('backup-meta-one:backup:last-local'), '2026-10-15T04:30:00.000Z');
  assert.deepEqual([...data.keys()], ['backup-meta-one:backup:last-local']);
});

test('rejects an invalid storage namespace before opening encrypted storage', async () => {
  let opened = false;
  await assert.rejects(openLastLocalBackupStorage('../wrong', async () => { opened = true; }), { message: 'INVALID_INPUT' });
  assert.equal(opened, false);
});
