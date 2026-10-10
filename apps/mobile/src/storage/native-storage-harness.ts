export async function runNativeStorageHarness(): Promise<{ namespace: string; passed: string[] }> {
  throw new Error('Storage validation requires a native SQLCipher development build');
}
