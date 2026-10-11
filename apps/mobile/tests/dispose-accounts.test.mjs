import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const moduleUrl = new URL('../src/security/dispose-accounts.ts', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  return result.url === moduleUrl ? { ...result, format: 'module-typescript' } : result;
} });
const { disposeAccounts } = await import(moduleUrl);
hooks.deregister();

test('account cleanup attempts every disposal even if earlier ones reject', async () => {
  const attempted = [];
  await assert.rejects(disposeAccounts(['first', 'second', 'third'], async (account) => {
    attempted.push(account);
    if (account !== 'second') throw new Error('synthetic disposal failure');
  }));
  assert.deepEqual(attempted, ['first', 'second', 'third']);
});
