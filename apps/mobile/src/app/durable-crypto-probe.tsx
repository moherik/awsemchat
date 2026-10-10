import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { DurableEncryptionError } from '../security/durable-encryption';
import { runDurableCryptoHarness } from '../security/durable-crypto-harness';
let inFlight = false;
export default function DurableCryptoProbe() {
  const { run, phase } = useLocalSearchParams<{ run?: string; phase?: string }>();
  const started = useRef(false);
  const [result, setResult] = useState('Synthetic durable crypto validation: supply run=1.');
  useEffect(() => {
    if (!__DEV__ || run !== '1' || started.current || inFlight) return;
    started.current = true; inFlight = true;
    console.info('AWSEM_DURABLE_CRYPTO_PROBE', JSON.stringify({ status: 'START', synthetic: true }));
    void runDurableCryptoHarness(phase ?? 'full').then((checks) => {
      console.info('AWSEM_DURABLE_CRYPTO_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, checks }));
      setResult(checks.join('\n'));
    }, (error: unknown) => {
      console.info('AWSEM_DURABLE_CRYPTO_PROBE', JSON.stringify({ status: 'FAIL', synthetic: true, code: error instanceof DurableEncryptionError ? error.code : 'DURABLE_PROBE_FAILED' }));
      setResult('Durable native validation failed.');
    }).finally(() => { inFlight = false; });
  }, [run, phase]);
  return <View style={{ padding: 24 }}><Text>{__DEV__ ? result : 'Validation unavailable in production'}</Text></View>;
}
