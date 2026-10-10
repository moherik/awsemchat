import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeAccounts } from '../src/security/dispose-accounts.ts';

test('account cleanup attempts every disposal even if earlier ones reject', async () => {
  const attempted = [];
  await assert.rejects(disposeAccounts(['first', 'second', 'third'], async (account) => {
    attempted.push(account);
    if (account !== 'second') throw new Error('synthetic disposal failure');
  }));
  assert.deepEqual(attempted, ['first', 'second', 'third']);
});
