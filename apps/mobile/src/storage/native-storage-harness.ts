export async function runNativeStorageHarness(): Promise<{ namespace: string; passed: string[]; cipherVersion: string }> {
  throw new Error('Storage validation requires a native SQLCipher development build');
}
