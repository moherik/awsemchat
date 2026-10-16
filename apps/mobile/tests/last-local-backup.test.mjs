import test from 'node:test';
import assert from 'node:assert/strict';
import { createLastLocalBackup } from '../src/features/backup/last-local-backup.ts';

function fixture(initial = null) {
  let binding = 'account-a/device-a/generation-a';
  let stored = initial;
  const status = createLastLocalBackup({ binding: () => binding, storage: {
    read: async () => stored,
    write: async value => { stored = value; },
  } });
  return { status, get stored() { return stored; }, replace: () => { binding = 'account-b/device-b/generation-b'; } };
}

test('reads no local backup when none has been recorded', async () => {
  assert.equal(await fixture().status.read(), null);
});

test('persists a successful local backup time and reads it after reopening', async () => {
  const first = fixture();
  await first.status.record('2026-10-15T04:30:00.000Z');
  assert.equal(first.stored, '2026-10-15T04:30:00.000Z');
  assert.equal(await fixture(first.stored).status.read(), '2026-10-15T04:30:00.000Z');
});

test('rejects malformed persisted timestamps instead of presenting them as successful backups', async () => {
  await assert.rejects(fixture('{broken').status.read(), { message: 'INVALID_BACKUP_STATUS' });
  await assert.rejects(fixture('not a date').status.read(), { message: 'INVALID_BACKUP_STATUS' });
});

test('does not read or write status after its account binding changes', async () => {
  const f = fixture();
  f.replace();
  await assert.rejects(f.status.read(), { message: 'SESSION_CHANGED' });
  await assert.rejects(f.status.record('2026-10-15T04:30:00.000Z'), { message: 'SESSION_CHANGED' });
  assert.equal(f.stored, null);
});

test('requires a canonical ISO timestamp when recording a successful backup', async () => {
  const f = fixture();
  await assert.rejects(f.status.record('tomorrow'), { message: 'INVALID_BACKUP_STATUS' });
  assert.equal(f.stored, null);
});
