export type LastLocalBackupStorage = {
  read(): Promise<string | null | undefined>;
  write(value: string): Promise<void>;
};

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function createLastLocalBackup(ports: { binding(): string; storage: LastLocalBackupStorage }) {
  const binding = ports.binding();
  function assertBinding() {
    if (!binding || ports.binding() !== binding) throw new Error('SESSION_CHANGED');
  }
  return Object.freeze({
    async read(): Promise<string | null> {
      assertBinding();
      const value = await ports.storage.read();
      assertBinding();
      if (value === undefined || value === null) return null;
      if (!validTimestamp(value)) throw new Error('INVALID_BACKUP_STATUS');
      return value;
    },
    async record(value: string) {
      if (!validTimestamp(value)) throw new Error('INVALID_BACKUP_STATUS');
      assertBinding();
      await ports.storage.write(value);
      assertBinding();
    },
  });
}
