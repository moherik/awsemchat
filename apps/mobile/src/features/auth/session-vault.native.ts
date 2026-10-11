import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { AuthError } from './api.ts';
import type { SessionVault } from './session-owner.ts';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  keychainService: 'awsemchat.auth',
};
export async function createSessionVault(origin: string): Promise<SessionVault> {
  const scope = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, origin);
  const key = `auth.session.${scope}`;
  return {
    read: () => SecureStore.getItemAsync(key, options),
    write: (value) => SecureStore.setItemAsync(key, value, options),
    clear: () => SecureStore.deleteItemAsync(key, options),
  };
}
let devicePromise: Promise<string> | undefined;
export async function installationDeviceId(): Promise<string> {
  if (!devicePromise) devicePromise = (async () => {
    try {
      const key = 'auth.installation';
      const existing = await SecureStore.getItemAsync(key, options);
      if (existing !== null) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(existing)) throw new AuthError('STORAGE');
        return existing;
      }
      const id = Crypto.randomUUID();
      await SecureStore.setItemAsync(key, id, options);
      return id;
    } catch { devicePromise = undefined; throw new AuthError('STORAGE'); }
  })();
  return devicePromise;
}
