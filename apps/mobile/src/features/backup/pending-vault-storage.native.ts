import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { createPendingBackupVault } from './pending-backup-vault';
import type { PendingBackupVault } from './drive-backup';
const stores = new Map<string, PendingBackupVault>();
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'awsemchat.backup.pending', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export function nativePendingBackupVault(fingerprint: string): PendingBackupVault {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const existing = stores.get(fingerprint);
  if (existing) return existing;
  const directory = new Directory(Paths.document, 'backup-pending');
  directory.create({ intermediates: true, idempotent: true });
  const key = `backup.pending.${fingerprint}`;
  function file(name: string) {
    if (!new RegExp(`^${fingerprint}-[a-f0-9-]{36}\\.bin$`).test(name)) throw new Error('VAULT_INVALID');
    return new File(directory, name);
  }
  const vault = createPendingBackupVault({
    readMetadata: () => SecureStore.getItemAsync(key, options),
    writeMetadata: value => SecureStore.setItemAsync(key, value, options),
    clearMetadata: () => SecureStore.deleteItemAsync(key, options),
    async writeFile(name, bytes) {
      const target = file(name);
      target.create();
      await FileSystem.writeAsStringAsync(target.uri, bytes, { encoding: FileSystem.EncodingType.UTF8 });
    },
    async readFile(name) {
      const target = file(name);
      if (!target.exists || target.size > 24 * 1024 * 1024) throw new Error('VAULT_INVALID');
      return target.text();
    },
    async removeFile(name) { const target = file(name); if (target.exists) target.delete(); },
    digest: bytes => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    name: () => `${fingerprint}-${Crypto.randomUUID()}.bin`,
  }, fingerprint);
  stores.set(fingerprint, vault);
  return vault;
}
