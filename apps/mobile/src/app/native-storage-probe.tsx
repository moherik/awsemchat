import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Button, Text, View } from 'react-native';
import { runNativeStorageHarness } from '../storage/native-storage-harness';
import { NativeStorageProbeError } from '../storage/native-storage-probe-error';

export default function NativeStorageProbe() {
  const { run } = useLocalSearchParams<{ run?: string }>();
  const [result, setResult] = useState('Ready: synthetic native storage checks');
  const [running, setRunning] = useState(false);
  const automaticStarted = useRef(false);
  const inFlight = useRef(false);
  const runProbe = useCallback(async () => {
    if (!__DEV__ || inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setResult('Running synthetic storage checks');
    console.info('AWSEM_NATIVE_STORAGE_PROBE', JSON.stringify({ status: 'START', synthetic: true }));
    try {
      const evidence = await runNativeStorageHarness();
      setResult(evidence.passed.join('\n'));
      const cipherVersion = /^\d+(?:\.\d+){1,3}(?: community)?$/.test(evidence.cipherVersion)
        ? evidence.cipherVersion : 'UNRECOGNIZED_VERSION';
      console.info('AWSEM_NATIVE_STORAGE_PROBE', JSON.stringify({
        status: 'PASS', synthetic: true, cipherVersion,
        checks: ['INTEGRITY', 'REOPEN', 'WRONG_KEY', 'ROLLBACK', 'FAILED_IMPORT', 'GENERATION_SWITCH'],
      }));
    } catch (error) {
      const code = error instanceof NativeStorageProbeError ? error.message : 'NATIVE_STORAGE_RUNNER_FAILED';
      console.info('AWSEM_NATIVE_STORAGE_PROBE', JSON.stringify({ status: 'FAIL', synthetic: true, code }));
      setResult(`Native storage validation failed (${code}). Check the validation guide.`);
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }, []);
  useEffect(() => {
    if (!__DEV__ || run !== '1' || automaticStarted.current) return;
    // The ref survives StrictMode effect replay; automatic runs occur once per mounted route.
    automaticStarted.current = true;
    void runProbe();
  }, [run, runProbe]);
  if (!__DEV__) return <Text>Validation unavailable in production</Text>;
  return <View style={{ padding: 24, gap: 16 }}>
    <Text>{result}</Text>
    <Button title="Run native storage checks" disabled={running} onPress={runProbe} />
  </View>;
}
