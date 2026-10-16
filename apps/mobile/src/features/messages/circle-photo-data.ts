import { toByteArray } from 'base64-js';

const maxPhotoBytes = 2 * 1024 * 1024;

export function decodeEditedPhotoDataUri(value: string): { mimeType: string; bytes: Uint8Array } | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || match[2].length === 0 || match[2].length % 4 !== 0) return undefined;
  try {
    const bytes = toByteArray(match[2]);
    if (bytes.length === 0 || bytes.length > maxPhotoBytes) return undefined;
    return { mimeType: match[1].toLowerCase(), bytes };
  } catch {
    return undefined;
  }
}
