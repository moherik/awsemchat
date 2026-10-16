import * as SecureStore from 'expo-secure-store';
import type { PrivateProfileState } from './private-profile-flow';

const stores = new Map<string, ReturnType<typeof createVault>>();
const options: SecureStore.SecureStoreOptions = { keychainService: 'awsemchat.private.profile', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
function createVault(key: string) {
  return {
    async read(): Promise<unknown | null> {
      const value = await SecureStore.getItemAsync(key, options);
      if (value === null) return null;
      try { return JSON.parse(value); } catch { return null; }
    },
    async write(state: PrivateProfileState) { await SecureStore.setItemAsync(key, JSON.stringify(state), options); },
  };
}
export function nativePrivateProfileVault(fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_PROFILE_BINDING');
  let vault = stores.get(fingerprint);
  if (!vault) { vault = createVault(`profile.v1.${fingerprint}`); stores.set(fingerprint, vault); }
  return vault;
}
