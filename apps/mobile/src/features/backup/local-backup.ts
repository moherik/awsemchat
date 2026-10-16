import type { createHistoryBackup } from './history-backup';
export type LocalBackupIO = {
  destination(): Promise<{ uri: string; write(bytes: string): Promise<void>; remove(): Promise<void> } | null>;
  source(): Promise<{ size: number; read(): Promise<string> } | null>;
};
export function createLocalBackup(history: ReturnType<typeof createHistoryBackup>, io: LocalBackupIO, binding: () => string) {
  function guard(bound: string) { if (binding() !== bound) throw new Error('SESSION_REVOKED'); }
  return {
    async create() {
      const bound = binding();
      const file = await io.destination();
      if (!file) return { cancelled: true as const };
      try {
        guard(bound);
        const result = await history.create(async (bytes) => {
          guard(bound);
          await file.write(bytes);
          guard(bound);
        });
        guard(bound);
        return { cancelled: false as const, ...result, uri: file.uri };
      } catch (error) {
        try { await file.remove(); } catch { throw new Error('PARTIAL_FILE_REMAINS'); }
        throw error;
      }
    },
    async restore(recoveryKey: string) {
      const bound = binding();
      const file = await io.source();
      if (!file) return { cancelled: true as const };
      guard(bound);
      if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 24 * 1024 * 1024) throw new Error('CAPACITY');
      const archive = await file.read();
      guard(bound);
      if (archive.length > 24 * 1024 * 1024) throw new Error('CAPACITY');
      const result = await history.restore(archive, recoveryKey);
      guard(bound);
      return { cancelled: false as const, ...result };
    },
  };
}
