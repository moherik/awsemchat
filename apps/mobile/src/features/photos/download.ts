import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { toByteArray } from 'base64-js';
import { photoExtension } from './photo-extension';
export async function downloadPhoto(uri: string) {
  const permission = await requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) throw new Error('Allow saving photos in device settings, then try again.');
  let local = uri;
  let temporary: File | undefined;
  try {
    if (uri.startsWith('data:')) { temporary = new File(Paths.cache, `awsem-${Date.now()}.${photoExtension(uri)}`); temporary.create(); temporary.write(toByteArray(uri.split(',')[1])); local = temporary.uri; }
    else if (uri.startsWith('http')) { temporary = await File.downloadFileAsync(uri, new File(Paths.cache, `awsem-${Date.now()}.${photoExtension(uri)}`)); local = temporary.uri; }
    if (local.startsWith('content://')) { const rendered = await ImageManipulator.manipulate(local).renderAsync(); const result = await rendered.saveAsync({ format: SaveFormat.PNG }); temporary = new File(result.uri); local = result.uri; }
    await Asset.create(local);
  } finally { if (temporary?.exists) temporary.delete(); }
}
