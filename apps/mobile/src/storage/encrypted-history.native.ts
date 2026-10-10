import * as Crypto from 'expo-crypto';
import { Directory } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { validateHistoryRecord } from './history-types';
import type { HistoryRecord } from './history-types';

export type { HistoryRecord } from './history-types';
type Generation = { name: string; key: string };
type Journal = { version: 1; active: Generation; previous?: Generation; creating?: true };
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'awsemchat.history',
};
const owners = new Set<string>();

async function generation(namespace: string): Promise<Generation> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return { name: `${namespace}-${Crypto.randomUUID()}.db`,
    key: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') };
}
async function openKeyed(g: Generation) {
  if (!/^[a-f0-9]{64}$/.test(g.key)) throw new Error('Invalid database key');
  const db = await SQLite.openDatabaseAsync(g.name, { useNewConnection: true });
  try {
    await db.execAsync(`PRAGMA key = "x'${g.key}'";`);
    const version = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
    if (!version?.cipher_version) throw new Error('SQLCipher unavailable; plaintext storage refused');
    return db;
  } catch (error) {
    await db.closeAsync();
    throw error;
  }
}
async function connect(g: Generation) {
  const db = await openKeyed(g);
  try {
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA temp_store = MEMORY;');
    return db;
  } catch (error) { await db.closeAsync(); throw error; }
}
async function initialize(db: SQLite.SQLiteDatabase) {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version !== 0 && version?.user_version !== 1) throw new Error('Unsupported history schema');
  await db.withTransactionAsync(async () => {
    const tx = db;
    await tx.execAsync(`CREATE TABLE IF NOT EXISTS history (
      eventId TEXT PRIMARY KEY NOT NULL, conversationId TEXT NOT NULL,
      originalAudience TEXT NOT NULL, membershipInterval TEXT NOT NULL,
      receivedAt INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS history_conversation ON history(conversationId, receivedAt, eventId);
      PRAGMA user_version = 1;`);
  });
}
async function integrity(db: SQLite.SQLiteDatabase) {
  const cipher = await db.getAllAsync<Record<string, string>>('PRAGMA cipher_integrity_check');
  const ordinary = await db.getFirstAsync<{ integrity_check: string }>('PRAGMA integrity_check');
  if (cipher.length || ordinary?.integrity_check !== 'ok') throw new Error('History integrity check failed');
}
async function insert(db: SQLite.SQLiteDatabase, records: Iterable<HistoryRecord>) {
  await db.withTransactionAsync(async () => {
    const tx = db;
    for (const record of records) {
      validateHistoryRecord(record);
      await tx.runAsync('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?)', record.eventId,
        record.conversationId, JSON.stringify(record.originalAudience), record.membershipInterval,
        record.receivedAt, record.payload);
    }
  });
}

/** Single owner: every operation is serialized, including reader close and generation switch. */
export async function openEncryptedHistory(namespace: string) {
  if (!/^[a-z0-9-]{1,40}$/.test(namespace)) throw new Error('Invalid history namespace');
  if (owners.has(namespace)) throw new Error('History already open');
  owners.add(namespace);
  const journalKey = `history.${namespace}`;
  let db: SQLite.SQLiteDatabase;
  let journal: Journal;
  const persist = (value: Journal) => SecureStore.setItemAsync(journalKey, JSON.stringify(value), options);
  try {
    const saved = await SecureStore.getItemAsync(journalKey, options);
    if (saved) {
      journal = JSON.parse(saved);
      if (journal.version !== 1 || !journal.active?.name.startsWith(`${namespace}-`) ||
          journal.active.name.includes('/') || (journal.previous &&
          (!journal.previous.name.startsWith(`${namespace}-`) || journal.previous.name.includes('/')))) {
        throw new Error('Invalid history journal');
      }
      try {
        db = await connect(journal.active);
        try {
          const schema = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
          if (schema?.user_version !== 1 && !(journal.creating && schema?.user_version === 0)) {
            throw new Error('Missing or unsupported history generation');
          }
          await integrity(db);
        } catch (error) { await db.closeAsync(); throw error; }
      } catch (error) {
        if (!journal.previous) throw error;
        const recovered: Journal = { version: 1, active: journal.previous };
        db = await connect(recovered.active);
        try {
          const schema = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
          if (schema?.user_version !== 1) throw new Error('Missing previous history generation');
          await integrity(db);
          await persist(recovered);
          journal = recovered;
        } catch (recoveryError) { await db.closeAsync(); throw recoveryError; }
      }
    } else {
      const databasePath: string = SQLite.defaultDatabaseDirectory;
      if (!databasePath?.startsWith('/')) throw new Error('History directory unavailable');
      const directory = new Directory(`file://${databasePath}`);
      if (directory.exists && directory.list().some((entry) =>
        entry.name.startsWith(`${namespace}-`) && /\.db(?:-wal|-shm|-journal)?$/.test(entry.name))) {
        throw new Error('History recovery required: database keys are unavailable');
      }
      journal = { version: 1, active: await generation(namespace), creating: true };
      // Persist the key before creating any history: interruption cannot strand an encrypted DB.
      await persist(journal);
      db = await connect(journal.active);
    }
    try {
      await initialize(db);
      if (journal.creating) {
        const initialized: Journal = { version: 1, active: journal.active };
        await persist(initialized);
        journal = initialized;
      }
    } catch (error) { await db.closeAsync(); throw error; }
  } catch (error) {
    owners.delete(namespace);
    throw error;
  }
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => {
      if (closed) throw new Error('History closed');
      return operation();
    });
    tail = result.catch(() => undefined);
    return result;
  }
  return {
    append: (records: Iterable<HistoryRecord>) => serial(() => insert(db, records)),
    list: (conversationId: string) => serial(async () => {
      const rows = await db.getAllAsync<Omit<HistoryRecord, 'originalAudience'> & { originalAudience: string }>(
        'SELECT * FROM history WHERE conversationId = ? ORDER BY receivedAt, eventId', conversationId);
      return rows.map((row) => ({ ...row, originalAudience: JSON.parse(row.originalAudience) as string[] }));
    }),
    checkIntegrity: () => serial(() => integrity(db)),
    cipherVersion: () => serial(async () => {
      const row = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
      if (!row?.cipher_version) throw new Error('SQLCipher unavailable');
      return row.cipher_version;
    }),
    /** Caller must authenticate the entire archive before returning from verifyCompletion. No live keys or sends are imported. */
    stageImport: (records: Iterable<HistoryRecord>, verifyCompletion: () => Promise<void>) => serial(async () => {
      if (journal.previous) throw new Error('Confirm prior restore startup before another import');
      const candidate = await generation(namespace);
      const staged = await connect(candidate);
      let switched = false;
      try {
        await initialize(staged);
        await insert(staged, records);
        await verifyCompletion();
        await integrity(staged);
        await db.closeAsync();
        const next: Journal = { version: 1, active: candidate, previous: journal.active };
        try { await persist(next); } catch (error) { db = await connect(journal.active); throw error; }
        journal = next;
        db = staged;
        switched = true;
      } finally {
        if (!switched) {
          await staged.closeAsync();
          await SQLite.deleteDatabaseAsync(candidate.name);
        }
      }
    }),
    confirmStartup: () => serial(async () => {
      await integrity(db);
      const previous = journal.previous;
      if (!previous) return;
      const confirmed: Journal = { version: 1, active: journal.active };
      await persist(confirmed);
      journal = confirmed;
      await SQLite.deleteDatabaseAsync(previous.name);
    }),
    close: () => serial(async () => {
      await db.closeAsync();
      closed = true;
      owners.delete(namespace);
    }),
  };
}

export async function assertWrongKeyRejected(namespace: string) {
  const raw = await SecureStore.getItemAsync(`history.${namespace}`, options);
  if (!raw) throw new Error('Missing test history');
  const journal: Journal = JSON.parse(raw);
  const correct = await connect(journal.active);
  try {
    const schema = await correct.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    if (schema?.user_version !== 1) throw new Error('Missing test history schema');
    await integrity(correct);
  } finally { await correct.closeAsync(); }
  const wrong = { ...journal.active, key: (await generation(namespace)).key };
  const db = await openKeyed(wrong);
  let rejected = false;
  try {
    try { await db.getFirstAsync('SELECT count(*) FROM sqlite_master'); }
    catch (error) {
      // SDK native SQLite reports SQLITE_NOTADB with this specific diagnostic.
      if (!(error instanceof Error) || !/file is not a database/i.test(error.message)) throw error;
      rejected = true;
    }
  } finally { await db.closeAsync(); }
  if (!rejected) throw new Error('Wrong key was accepted');
}
