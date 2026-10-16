import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { nativeCrypto } from '../../../modules/awsemchat-crypto/src/AwsemchatCryptoModule';
import { createArchiveCodec } from '../backup/archive-codec';
import { createSnapshotPublicationVault } from './snapshot-publication-vault';
import type { SnapshotPublicationVault } from './collection-snapshot-publisher';

const stores = new Map<string, SnapshotPublicationVault>();
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'awsemchat.snapshot.publication',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export function nativeSnapshotPublicationVault(fingerprint: string, circleId: string): SnapshotPublicationVault {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const storeKey = `${fingerprint}:${circleId}`;
  const existing = stores.get(storeKey);
  if (existing) return existing;
  const directory = new Directory(Paths.document, 'snapshot-publication');
  directory.create({ intermediates: true, idempotent: true });
  const key = `snapshot.publication.${fingerprint}`;
  function file(name: string) {
    if (!new RegExp(`^${fingerprint}-[a-f0-9-]{36}\\.bin$`).test(name)) throw new Error('VAULT_INVALID');
    return new File(directory, name);
  }
  const vault = createSnapshotPublicationVault({
    readMetadata: () => SecureStore.getItemAsync(key, options),
    writeMetadata: value => SecureStore.setItemAsync(key, value, options),
    clearMetadata: () => SecureStore.deleteItemAsync(key, options),
    async writeFile(name, bytes) { const target = file(name); target.create(); target.write(bytes); },
    async readFile(name) {
      const target = file(name);
      if (!target.exists || target.size > 8 * 1024 * 1024) throw new Error('VAULT_INVALID');
      return target.text();
    },
    async removeFile(name) { const target = file(name); if (target.exists) target.delete(); },
    name: () => `${fingerprint}-${Crypto.randomUUID()}.bin`,
    codec: createArchiveCodec(input => nativeCrypto().executeArchive(input)),
  }, fingerprint, circleId);
  stores.set(storeKey, vault);
  return vault;
}
