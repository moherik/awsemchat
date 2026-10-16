import * as SecureStore from 'expo-secure-store';

const options: SecureStore.SecureStoreOptions = { keychainService: 'awsemchat.now-playing', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export function nativeNowPlayingStorage(fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_NOW_PLAYING_BINDING');
  const key = `now-playing.share.v1.${fingerprint}`;
  return Object.freeze({
    async read() {
      const raw = await SecureStore.getItemAsync(key, options);
      if (raw === null) return false;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error('NOW_PLAYING_PREFERENCE_INVALID');
    },
    write(value: boolean) {
      if (typeof value !== 'boolean') throw new Error('INVALID_INPUT');
      return SecureStore.setItemAsync(key, String(value), options);
    },
  });
}
