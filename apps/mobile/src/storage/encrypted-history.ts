export type { HistoryRecord } from './history-types';
export async function openEncryptedHistory(_namespace: string): Promise<never> {
  throw new Error('Encrypted history requires a native SQLCipher development build');
}
