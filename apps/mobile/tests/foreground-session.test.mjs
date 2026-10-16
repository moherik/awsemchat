import test from 'node:test';
import assert from 'node:assert/strict';
import { createForegroundSessionGate } from '../src/features/auth/foreground-session.ts';

test('foreground sync waits for one saved-session check and coalesces duplicate resumes', async () => {
  const events = [];
  let finishCheck;
  const gate = createForegroundSessionGate(
    () => events.push('pause'),
    () => { events.push('validate'); return new Promise(resolve => { finishCheck = resolve; }); },
    () => events.push('resume'),
  );

  const first = gate();
  const second = gate();
  await Promise.resolve();
  assert.deepEqual(events, ['pause', 'validate']);

  finishCheck();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['pause', 'validate', 'resume']);
});

test('foreground sync gate reopens after saved-session validation fails', async () => {
  const events = [];
  const gate = createForegroundSessionGate(
    () => events.push('pause'),
    async () => { events.push('validate'); throw new Error('offline'); },
    () => events.push('resume'),
  );

  await gate();
  assert.deepEqual(events, ['pause', 'validate', 'resume']);
});
