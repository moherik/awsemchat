import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createPrivateMomentVault } from './private-moment-vault';

const stores = new Map<string, ReturnType<typeof createPrivateMomentVault>>();
const options: SecureStore.SecureStoreOptions = { keychainService: 'awsemchat.private-moment', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export function nativePrivateMomentVault(binding: string, peerId: string, purpose: 'moment' | 'chat-photo' = 'moment') {
  if (!/^[a-f0-9]{64}$/.test(binding) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId)) throw new Error('INVALID_INPUT');
  const key = `${purpose}:${binding}:${peerId}`, existing = stores.get(key); if (existing) return existing;
  const directory = new Directory(Paths.document, purpose === 'moment' ? 'private-moment-upload' : 'private-chat-photo-upload'); directory.create({ intermediates: true, idempotent: true });
  const secureKey = `private.${purpose}.${binding}.${peerId}`;
  function file(name: string) { if (!new RegExp(`^${binding}-[a-f0-9-]{36}\\.bin$`).test(name)) throw new Error('VAULT_INVALID'); return new File(directory, name); }
  const vault = createPrivateMomentVault({
    readMetadata: () => SecureStore.getItemAsync(secureKey, options), writeMetadata: value => SecureStore.setItemAsync(secureKey, value, options), clearMetadata: () => SecureStore.deleteItemAsync(secureKey, options),
    async writeFile(name, value) { const target = file(name); target.create(); target.write(value); },
    async readFile(name) { const target = file(name); if (!target.exists || target.size > 8 * 1024 * 1024) throw new Error('VAULT_INVALID'); return target.text(); },
    async removeFile(name) { const target = file(name); if (target.exists) target.delete(); },
    digest: value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value), name: () => `${binding}-${Crypto.randomUUID()}.bin`,
  }, binding, peerId);
  stores.set(key, vault); return vault;
}
