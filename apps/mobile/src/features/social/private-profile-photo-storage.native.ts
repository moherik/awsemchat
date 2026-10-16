import { openEncryptedHistory } from '../../storage/encrypted-history.native';
import { createPrivateProfilePublicationStorage } from './private-profile-photo-publication-storage';

const stores = new Map<string, ReturnType<typeof openEncryptedHistory>>();
function profileDatabase(fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_PROFILE_BINDING');
  let store = stores.get(fingerprint);
  if (!store) {
    store = openEncryptedHistory(`profile-photo-${fingerprint.slice(0, 24)}`);
    stores.set(fingerprint, store);
    store.catch(() => { if (stores.get(fingerprint) === store) stores.delete(fingerprint); });
  }
  return store;
}
export async function nativePrivateProfilePhotoStorage(fingerprint: string) {
  const db = await profileDatabase(fingerprint);
  return Object.freeze({
    read: () => db.getData('profile:photo'),
    write: (value: string) => db.setData('profile:photo', value),
    clear: () => db.setData('profile:photo', ''),
  });
}
export async function nativePrivateProfilePublicationStorage(fingerprint: string, peerId: string, requestId: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_PROFILE_BINDING');
  return createPrivateProfilePublicationStorage(await profileDatabase(fingerprint), peerId, requestId);
}
