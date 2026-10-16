import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { nativeCrypto } from '../../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { createArchiveCodec } from '../backup/archive-codec';
import { createCircleCreationVault } from './circle-creation-vault';
import type { CircleCreationVault } from './circle-creation';

const stores = new Map<string, CircleCreationVault>();
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'awsemchat.circle.creation',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export function nativeCircleCreationVault(fingerprint: string): CircleCreationVault {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const existing = stores.get(fingerprint);
  if (existing) return existing;
  const directory = new Directory(Paths.document, 'circle-creation');
  directory.create({ intermediates: true, idempotent: true });
  const key = `circle.creation.${fingerprint}`;
  function file(name: string) {
    if (!new RegExp(`^${fingerprint}-[a-f0-9-]{36}\\.bin$`).test(name)) throw new Error('VAULT_INVALID');
    return new File(directory, name);
  }
  const vault = createCircleCreationVault({
    readMetadata: () => SecureStore.getItemAsync(key, options),
    writeMetadata: value => SecureStore.setItemAsync(key, value, options),
    clearMetadata: () => SecureStore.deleteItemAsync(key, options),
    async writeFile(name, bytes) { const target = file(name); target.create(); target.write(bytes); },
    async readFile(name) {
      const target = file(name);
      if (!target.exists || target.size > 128 * 1024) throw new Error('VAULT_INVALID');
      return target.text();
    },
    async removeFile(name) { const target = file(name); if (target.exists) target.delete(); },
    name: () => `${fingerprint}-${Crypto.randomUUID()}.bin`,
    codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
  }, fingerprint);
  stores.set(fingerprint, vault);
  return vault;
}
