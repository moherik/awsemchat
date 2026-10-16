import test from 'node:test';
import assert from 'node:assert/strict';
import { createNowPlayingLifecycle } from '../src/features/now-playing/lifecycle.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));

test('syncs on activation and on each foreground interval only', async () => {
  const timers = [];
  const calls = [];
  const lifecycle = createNowPlayingLifecycle({
    enabled: () => true,
    sync: async () => calls.push('sync'),
    interval: 30_000,
    schedule: (job, delay) => { const entry = { job, delay, cancelled: false }; timers.push(entry); return () => { entry.cancelled = true; }; },
  });
  lifecycle.refresh();
  await flush();
  assert.deepEqual(calls, ['sync']);
  assert.equal(timers[0].delay, 30_000);
  timers[0].job();
  await flush();
  assert.deepEqual(calls, ['sync', 'sync']);
  lifecycle.dispose();
  assert.equal(timers.at(-1).cancelled, true);
});

test('does not sync when disabled and drops a late reschedule after disposal', async () => {
  const timers = [];
  let enabled = false;
  const lifecycle = createNowPlayingLifecycle({ enabled: () => enabled, sync: async () => assert.fail('must not sync'), interval: 30_000, schedule: job => { timers.push(job); return () => {}; } });
  lifecycle.refresh();
  assert.equal(timers.length, 0);
  enabled = true;
  lifecycle.refresh();
  await flush();
  lifecycle.dispose();
  timers[0]();
  await flush();
  assert.equal(timers.length, 1);
});
