import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Real host SQLite checks transactions and generation ownership. Cipher/secure-store
// boundaries are stubs: these tests cannot establish native encryption or durability.
const directory = mkdtempSync(join(tmpdir(), 'awsem-history-'));
const secrets = new Map();
let failJournal = false;
let cipherAvailable = true;
globalThis.__historyTest = {
  secure: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    getItemAsync: async (key) => secrets.get(key) ?? null,
    setItemAsync: async (key, value) => {
      if (failJournal) throw new Error('Synthetic secure-store failure');
      secrets.set(key, value);
    },
  },
  crypto: { getRandomBytesAsync: async (size) => randomBytes(size), randomUUID },
  sqlite: {
    openDatabaseAsync: async (name) => {
      const db = new DatabaseSync(join(directory, name));
      const api = {
        execAsync: async (sql) => db.exec(sql),
        runAsync: async (sql, ...args) => db.prepare(sql).run(...args),
        getFirstAsync: async (sql, ...args) => sql === 'PRAGMA cipher_version'
          ? (cipherAvailable ? { cipher_version: 'host-stub' } : undefined) : db.prepare(sql).get(...args),
        getAllAsync: async (sql, ...args) => db.prepare(sql).all(...args),
        closeAsync: async () => db.close(),
        withTransactionAsync: async (operation) => {
          db.exec('BEGIN');
          try { await operation(); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        },
      };
      return api;
    },
    deleteDatabaseAsync: async (name) => rmSync(join(directory, name), { force: true }),
  },
};
registerHooks({ resolve(specifier, context, next) {
  const kind = { 'expo-sqlite': 'sqlite', 'expo-secure-store': 'secure', 'expo-crypto': 'crypto' }[specifier];
  if (kind) {
    const names = Object.keys(globalThis.__historyTest[kind]);
    const source = names.map((name) => `export const ${name} = globalThis.__historyTest.${kind}.${name};`).join('\n');
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  if (specifier === './history-types') return next('./history-types.ts', context);
  return next(specifier, context);
} });
const { openEncryptedHistory } = await import('../src/storage/encrypted-history.native.ts');
const record = { eventId: 'one', conversationId: 'chat', originalAudience: ['owner'],
  membershipInterval: 'interval', receivedAt: 1, payload: 'synthetic' };

test('rollback, failed authentication and failed pointer persistence preserve prior history', async () => {
  let store = await openEncryptedHistory('transaction-probe');
  try {
    await store.append([record]);
    await assert.rejects(store.append([{ ...record, eventId: 'two' }, record]));
    assert.equal((await store.list('chat')).length, 1);
    await assert.rejects(store.stageImport([{ ...record, eventId: 'candidate' }], async () => {
      throw new Error('Synthetic invalid archive');
    }));
    assert.equal((await store.list('chat'))[0].eventId, 'one');
    failJournal = true;
    await assert.rejects(store.stageImport([{ ...record, eventId: 'candidate' }], async () => {}));
    failJournal = false;
    assert.equal((await store.list('chat'))[0].eventId, 'one');
    await store.close();
    store = await openEncryptedHistory('transaction-probe');
    assert.equal((await store.list('chat'))[0].eventId, 'one');
  } finally { failJournal = false; await store.close(); }
});

test('pending generation survives restart, retains previous, prevents another import until confirmation', async () => {
  let store = await openEncryptedHistory('switch-probe');
  await store.append([record]);
  await store.stageImport([{ ...record, eventId: 'new' }], async () => {});
  await store.close();
  store = await openEncryptedHistory('switch-probe');
  try {
    assert.equal((await store.list('chat'))[0].eventId, 'new');
    assert.ok(JSON.parse(secrets.get('history.switch-probe')).previous);
    await assert.rejects(store.stageImport([record], async () => {}));
    failJournal = true;
    await assert.rejects(store.confirmStartup());
    failJournal = false;
    await assert.rejects(store.stageImport([record], async () => {}));
    await store.confirmStartup();
    assert.equal(JSON.parse(secrets.get('history.switch-probe')).previous, undefined);
  } finally { failJournal = false; await store.close(); }
});

test('missing unconfirmed generation recovers retained history; interrupted first creation resumes', async () => {
  let store = await openEncryptedHistory('recovery-probe');
  await store.append([record]);
  await store.stageImport([{ ...record, eventId: 'new' }], async () => {});
  await store.close();
  const pending = JSON.parse(secrets.get('history.recovery-probe'));
  rmSync(join(directory, pending.active.name));
  store = await openEncryptedHistory('recovery-probe');
  try { assert.equal((await store.list('chat'))[0].eventId, 'one'); }
  finally { await store.close(); }
  secrets.set('history.creation-probe', JSON.stringify({ version: 1, creating: true,
    active: { name: 'creation-probe-interrupted.db', key: randomBytes(32).toString('hex') } }));
  store = await openEncryptedHistory('creation-probe');
  try {
    await store.append([record]);
    assert.equal((await store.list('chat')).length, 1);
    assert.equal(JSON.parse(secrets.get('history.creation-probe')).creating, undefined);
  } finally { await store.close(); }
});

test('second owner fails and use after close fails', async () => {
  const store = await openEncryptedHistory('owner-probe');
  await assert.rejects(openEncryptedHistory('owner-probe'));
  await store.close();
  await assert.rejects(store.list('chat'));
});

test('cipher-less build and web refuse history storage', async () => {
  cipherAvailable = false;
  try { await assert.rejects(openEncryptedHistory('plaintext-probe'), /SQLCipher unavailable/); }
  finally { cipherAvailable = true; }
  const web = await import('../src/storage/encrypted-history.ts');
  await assert.rejects(web.openEncryptedHistory('web-probe'), /native SQLCipher/);
});

test.after(() => { rmSync(directory, { recursive: true, force: true }); });
