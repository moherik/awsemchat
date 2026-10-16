import { File } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import type { LocalBackupIO } from './local-backup';

export function encryptedBackupFile(uri: string) {
  return {
    uri,
    async write(bytes: string) {
      await FileSystem.writeAsStringAsync(uri, bytes, { encoding: FileSystem.EncodingType.UTF8 });
      if (await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 }) !== bytes) throw new Error('STORAGE');
    },
    remove: () => FileSystem.deleteAsync(uri, { idempotent: true }),
  };
}

export const localBackupIO: LocalBackupIO = {
  async destination() {
    const selected = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!selected.granted) return null;
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(selected.directoryUri,
      `AwsemChat-${Crypto.randomUUID()}.awsembackup`, 'application/octet-stream');
    return encryptedBackupFile(uri);
  },
  async source() {
    const selected = await File.pickFileAsync({ mimeTypes: '*/*' });
    if (selected.canceled) return null;
    const file = selected.result;
    return { size: file.size, read: () => file.text() };
  },
};
