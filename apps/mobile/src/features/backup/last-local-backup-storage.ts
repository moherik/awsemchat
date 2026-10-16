import { openEncryptedHistory } from '../../storage/encrypted-history.ts';
import type { LastLocalBackupStorage } from './last-local-backup';

type Opener = (namespace: string) => Promise<Pick<Awaited<ReturnType<typeof openEncryptedHistory>>, 'getData' | 'setData'>>;

export async function openLastLocalBackupStorage(namespace: string, open: Opener = openEncryptedHistory): Promise<LastLocalBackupStorage> {
  if (typeof namespace !== 'string' || !/^[a-z0-9-]{1,40}$/.test(namespace)) throw new Error('INVALID_INPUT');
  const store = await open(namespace);
  return Object.freeze({
    async read() { return (await store.getData('backup:last-local')) ?? null; },
    write: (value: string) => store.setData('backup:last-local', value),
  });
}
