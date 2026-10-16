import * as SecureStore from 'expo-secure-store';
import type { MembershipVault } from './circle-membership';
const stores = new Map<string, MembershipVault>();
const options: SecureStore.SecureStoreOptions = { keychainService: 'awsemchat.circle.membership', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export function nativeMembershipVault(fingerprint: string): MembershipVault {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const existing = stores.get(fingerprint); if (existing) return existing;
  const key = `circle.membership.${fingerprint}`;
  const vault: MembershipVault = {
    async read() { const raw = await SecureStore.getItemAsync(key, options); if (raw === null) return null; if (raw.length > 2048) throw new Error('VAULT_INVALID'); try { return JSON.parse(raw); } catch { throw new Error('VAULT_INVALID'); } },
    async write(value) { const raw = JSON.stringify(value); if (raw.length > 2048) throw new Error('INVALID_INPUT'); await SecureStore.setItemAsync(key, raw, options); },
    clear: () => SecureStore.deleteItemAsync(key, options),
  };
  stores.set(fingerprint, vault); return vault;
}
