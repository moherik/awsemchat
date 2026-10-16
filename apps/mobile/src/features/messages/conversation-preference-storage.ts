import { openEncryptedHistory } from '../../storage/encrypted-history.ts';

type DataStore = Pick<Awaited<ReturnType<typeof openEncryptedHistory>>, 'getData' | 'setData'>;
type Opener = (namespace: string) => Promise<DataStore>;

export async function openConversationPreferenceStorage(namespace: string, open: Opener = openEncryptedHistory) {
  if (typeof namespace !== 'string' || !/^[a-z0-9-]{1,40}$/.test(namespace)) throw new Error('INVALID_INPUT');
  const store = await open(namespace);
  return Object.freeze({
    read: () => store.getData('chat:preferences'),
    write: (value: unknown) => {
      const serialized = JSON.stringify(value);
      if (typeof serialized !== 'string' || serialized.length > 64_000) throw new Error('INVALID_INPUT');
      return store.setData('chat:preferences', serialized);
    },
  });
}
