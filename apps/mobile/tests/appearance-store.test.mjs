import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/features/appearance-store.ts').catch(() => ({}));

test('appearance store restores only supported device themes and defaults invalid values to system', async () => {
  assert.equal(typeof api.createAppearanceStore, 'function', 'device appearance store is missing');
  for (const [saved, expected] of [['dark', 'dark'], ['light', 'light'], ['system', 'system'], ['demo-blue', 'system'], [null, 'system']]) {
    const store = api.createAppearanceStore({ get: async () => saved, set: async () => undefined });
    await store.load();
    assert.deepEqual(store.getSnapshot(), { phase: 'ready', theme: expected });
  }
});

test('appearance changes persist before they become active and leave state intact on write failure', async () => {
  assert.equal(typeof api.createAppearanceStore, 'function', 'device appearance store is missing');
  let saved = 'system', failWrite = false;
  const store = api.createAppearanceStore({ get: async () => saved, set: async value => { if (failWrite) throw new Error('storage unavailable'); saved = value; } });
  await store.load();
  await store.setTheme('dark');
  assert.equal(saved, 'dark');
  assert.deepEqual(store.getSnapshot(), { phase: 'ready', theme: 'dark' });
  failWrite = true;
  await assert.rejects(store.setTheme('light'), /storage unavailable/);
  assert.deepEqual(store.getSnapshot(), { phase: 'ready', theme: 'dark' });
});
