import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { useLocalSearchParams } from 'expo-router';
import { openEncryptedHistory } from '../storage/encrypted-history';
import type { HistoryRecord } from '../storage/history-types';

const fixture: HistoryRecord = { eventId: 'archival-one', conversationId: 'private-fixture', originalAudience: ['alice', 'bob'], membershipInterval: 'original-interval', receivedAt: 12, payload: 'synthetic archive fixture' };
function assert(value: boolean) { if (!value) throw new Error('BACKUP_ASSERTION_FAILED'); }
function matches(records: HistoryRecord[]) {
  return records.length === 1 && Object.entries(fixture).every(([key, value]) =>
    JSON.stringify(records[0][key as keyof HistoryRecord]) === JSON.stringify(value));
}
async function run(phase: string) {
  const module = requireNativeModule<{ executeArchive(input: string): Promise<string> }>('AwsemchatCrypto');
  if (typeof module.executeArchive !== 'function') throw new Error('BACKUP_BRIDGE_MISSING');
  async function archive(input: object) {
    const response = JSON.parse(await module.executeArchive(JSON.stringify(input)));
    if (response.ok !== true) throw new Error('ARCHIVE_REJECTED');
    return response.value;
  }
  const interval = phase === 'recoverBefore' ? 'before' : phase === 'recoverAfter' ? 'after' : phase === 'recoverConfirmed' ? 'confirmed' : phase;
  const namespace = phase === 'full' ? `probe-backup-${Date.now()}` : `probe-backup-${interval}`;
  const store = await openEncryptedHistory(namespace);
  try {
    if (phase.startsWith('recover')) {
      const records = await store.snapshotForArchive();
      assert(records.length === 1 && records[0].eventId === (phase === 'recoverBefore' ? 'prior' : fixture.eventId));
      await store.confirmStartup();
      return ['PROCESS_RESTART_COMPLETE_GENERATION'];
    }
    await store.append([{ ...fixture, eventId: 'prior' }]);
    const sealed = await archive({ op: 'encode', account: 'synthetic-account', records: [fixture] });
    const decoded = await archive({ op: 'decode', account: 'synthetic-account', archive: sealed.archive, recoveryKey: sealed.recoveryKey });
    assert(matches(decoded.records));
    if (phase === 'full') {
      for (const change of [
        { account: 'other-account' },
        { recoveryKey: '0'.repeat(64) },
        { archive: sealed.archive.slice(0, -4) },
        { archive: `${sealed.archive.slice(0, 20)}${sealed.archive[20] === 'A' ? 'B' : 'A'}${sealed.archive.slice(21)}` },
      ]) {
        let rejected = false;
        try {
          await store.stageImport([fixture], async () => { await archive({ op: 'decode', account: 'synthetic-account', archive: sealed.archive, recoveryKey: sealed.recoveryKey, ...change }); });
        } catch { rejected = true; }
        assert(rejected && (await store.snapshotForArchive())[0].eventId === 'prior');
      }
      await store.stageImport(decoded.records, async () => {});
      assert(matches(await store.snapshotForArchive()));
      await store.confirmStartup();
      return ['NATIVE_ARCHIVE_ROUNDTRIP', 'ACCOUNT_KEY_TAMPER_TRUNCATION_REJECTED', 'FAILED_RESTORE_PRESERVES_HISTORY', 'ARCHIVAL_BOUNDARIES', 'SQLCIPHER_GENERATION_SWITCH'];
    }
    if (phase === 'before') {
      await store.stageImport(decoded.records, async () => {
        console.log('AWSEM_NATIVE_BACKUP_PROBE', JSON.stringify({ status: 'CHECKPOINT', phase: 'beforeSwitch', synthetic: true }));
        await new Promise(() => {});
      });
    } else {
      await store.stageImport(decoded.records, async () => {});
      if (phase === 'confirmed') await store.confirmStartup();
      console.log('AWSEM_NATIVE_BACKUP_PROBE', JSON.stringify({ status: 'CHECKPOINT', phase: phase === 'confirmed' ? 'afterConfirm' : 'afterSwitch', synthetic: true }));
      await new Promise(() => {});
    }
    return [];
  } finally { await store.close(); }
}
export default function NativeBackupProbe() {
  const { phase = 'full' } = useLocalSearchParams<{ phase?: string }>();
  const started = useRef(false);
  const [status, setStatus] = useState('Native backup validation');
  useEffect(() => {
    if (!__DEV__ || started.current) return;
    started.current = true;
    console.log('AWSEM_NATIVE_BACKUP_PROBE', JSON.stringify({ status: 'START', synthetic: true }));
    void run(phase).then((checks) => {
      setStatus('Passed');
      console.log('AWSEM_NATIVE_BACKUP_PROBE', JSON.stringify({ status: 'PASS', checks, synthetic: true }));
    }).catch((error) => {
      setStatus('Failed');
      console.log('AWSEM_NATIVE_BACKUP_PROBE', JSON.stringify({ status: 'FAIL', code: error instanceof Error && error.message === 'BACKUP_BRIDGE_MISSING' ? 'BACKUP_BRIDGE_MISSING' : 'NATIVE_BACKUP_FAILED', synthetic: true }));
    });
  }, [phase]);
  return <View><Text>{__DEV__ ? status : 'Unavailable'}</Text></View>;
}
