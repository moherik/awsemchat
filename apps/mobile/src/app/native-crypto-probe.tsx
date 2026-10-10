import { useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { runNativeCryptoHarness } from '../security/native-crypto-harness';

let inFlight = false;
export default function NativeCryptoProbe() {
  const { run } = useLocalSearchParams<{ run?: string }>();
  const started = useRef(false);
  const [result, setResult] = useState('Synthetic native crypto probe: supply run=1 to execute.');
  useEffect(() => {
    if (!__DEV__ || run !== '1' || started.current || inFlight) return;
    started.current = true;
    inFlight = true;
    console.info('AWSEM_NATIVE_CRYPTO_PROBE', JSON.stringify({ status: 'START', synthetic: true }));
    void runNativeCryptoHarness().then((checks) => {
      console.info('AWSEM_NATIVE_CRYPTO_PROBE', JSON.stringify({ status: 'PASS', synthetic: true, checks }));
      setResult(checks.join('\n'));
    }, () => {
      console.info('AWSEM_NATIVE_CRYPTO_PROBE', JSON.stringify({ status: 'FAIL', synthetic: true, code: 'NATIVE_CRYPTO_PROBE_FAILED' }));
      setResult('Native crypto validation failed. See the validation guide.');
    }).finally(() => { inFlight = false; });
  }, [run]);
  return <View style={{ padding: 24 }}><Text>{__DEV__ ? result : 'Validation unavailable in production'}</Text></View>;
}
