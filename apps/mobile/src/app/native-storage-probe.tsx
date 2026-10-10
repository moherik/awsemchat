import { useState } from 'react';
import { Button, Text, View } from 'react-native';
import { runNativeStorageHarness } from '../storage/native-storage-harness';

export default function NativeStorageProbe() {
  const [result, setResult] = useState('Ready: synthetic native storage checks');
  const [running, setRunning] = useState(false);
  if (!__DEV__) return <Text>Validation unavailable in production</Text>;
  return <View style={{ padding: 24, gap: 16 }}>
    <Text>{result}</Text>
    <Button title="Run native storage checks" disabled={running} onPress={async () => {
      setRunning(true);
      setResult('Running synthetic storage checks');
      try {
        const evidence = await runNativeStorageHarness();
        setResult(evidence.passed.join('\n'));
      } catch {
        setResult('Native storage validation failed. Check the development build and validation guide.');
      } finally { setRunning(false); }
    }} />
  </View>;
}
