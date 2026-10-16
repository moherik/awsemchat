import type { LocalBackupIO } from './local-backup';
export const localBackupIO: LocalBackupIO = {
  async destination() { throw new Error('NATIVE_REQUIRED'); },
  async source() { throw new Error('NATIVE_REQUIRED'); },
};
