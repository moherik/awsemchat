import { Directory, File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createMediaUploadVault } from './upload-vault';
import type { MediaUploadVault } from './upload';

const stores = new Map<string, MediaUploadVault>();
const options: SecureStore.SecureStoreOptions = { keychainService: 'awsemchat.media.upload', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export function nativeMediaUploadVault(fingerprint: string): MediaUploadVault {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const existing = stores.get(fingerprint); if (existing) return existing;
  const directory = new Directory(Paths.document, 'media-upload');
  directory.create({ intermediates: true, idempotent: true });
  const key = `media.upload.${fingerprint}`;
  function file(name: string) {
    if (!new RegExp(`^${fingerprint}-[a-f0-9-]{36}\\.bin$`).test(name)) throw new Error('VAULT_INVALID');
    return new File(directory, name);
  }
  const vault = createMediaUploadVault({
    readMetadata: () => SecureStore.getItemAsync(key, options),
    writeMetadata: value => SecureStore.setItemAsync(key, value, options),
    clearMetadata: () => SecureStore.deleteItemAsync(key, options),
    async writeFile(name, ciphertext) { const target = file(name); target.create(); target.write(ciphertext); },
    async readFile(name) { const target = file(name); if (!target.exists || target.size > 8 * 1024 * 1024) throw new Error('VAULT_INVALID'); return target.text(); },
    async removeFile(name) { const target = file(name); if (target.exists) target.delete(); },
    name: () => `${fingerprint}-${Crypto.randomUUID()}.bin`,
    digest: ciphertext => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, ciphertext),
  }, fingerprint);
  stores.set(fingerprint, vault); return vault;
}
