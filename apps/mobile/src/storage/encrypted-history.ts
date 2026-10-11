export type { HistoryRecord } from './history-types';
export type EncryptedHistory = Awaited<ReturnType<typeof import('./encrypted-history.native').openEncryptedHistory>>;
export async function openEncryptedHistory(_namespace: string): Promise<EncryptedHistory> {
  throw new Error('Encrypted history requires a native SQLCipher development build');
}
