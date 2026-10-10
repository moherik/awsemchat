import * as Crypto from 'expo-crypto';
import { assertWrongKeyRejected, openEncryptedHistory } from './encrypted-history.native';
import type { HistoryRecord } from './history-types';

function assert(value: boolean, label: string): asserts value {
  if (!value) throw new Error(label);
}
/** Synthetic data only. Returned evidence contains no keys or content. */
export async function runNativeStorageHarness() {
  const namespace = `probe-${Crypto.randomUUID().slice(0, 8)}`;
  const record: HistoryRecord = {
    eventId: 'synthetic-event', conversationId: 'synthetic-conversation',
    originalAudience: ['synthetic-owner'], membershipInterval: 'synthetic-interval',
    receivedAt: 1, payload: 'synthetic-history-sentinel',
  };
  let store = await openEncryptedHistory(namespace);
  const passed: string[] = [];
  try {
    await store.append([record]);
    await store.checkIntegrity();
    passed.push(`SQLCipher ${await store.cipherVersion()} and database integrity`);
    await store.close();
    store = await openEncryptedHistory(namespace);
    assert((await store.list(record.conversationId))[0]?.payload === record.payload, 'Restart persistence failed');
    passed.push('Close and reopen persistence');
    await assertWrongKeyRejected(namespace);
    passed.push('Wrong key rejected');
    let rejected = false;
    try { await store.append([{ ...record, eventId: 'rolled-back' }, record]); } catch { rejected = true; }
    assert(rejected && (await store.list(record.conversationId)).length === 1, 'Transaction rollback failed');
    passed.push('Duplicate failure rolls back entire batch');
    rejected = false;
    try {
      await store.stageImport([{ ...record, eventId: 'candidate' }], async () => {
        throw new Error('Synthetic archive authentication failure');
      });
    } catch { rejected = true; }
    assert(rejected && (await store.list(record.conversationId))[0]?.eventId === record.eventId,
      'Failed staged import changed active history');
    passed.push('Failed import preserves prior generation');
    await store.stageImport([{ ...record, eventId: 'replacement' }], async () => {});
    await store.close();
    store = await openEncryptedHistory(namespace);
    assert((await store.list(record.conversationId))[0]?.eventId === 'replacement', 'Generation switch lost after reopen');
    await store.confirmStartup();
    passed.push('Generation switch survives reopen and startup confirmation');
    return { namespace, passed };
  } finally { await store.close(); }
}
