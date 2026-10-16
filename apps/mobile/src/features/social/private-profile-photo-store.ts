import { fromByteArray, toByteArray } from 'base64-js';

export type PrivateProfilePhoto = Readonly<{ mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; bytes: Uint8Array }>;
type Ports = { binding(): string; storage: { read(): Promise<unknown>; write(value: string): Promise<void>; clear(): Promise<void> } };
const maxBytes = 2 * 1024 * 1024;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function invalid(): never { throw new Error('INVALID_PROFILE_PHOTO'); }
function checkPhoto(value: unknown): PrivateProfilePhoto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const photo = value as Record<string, unknown>;
  if (Object.keys(photo).sort().join(',') !== 'bytes,mimeType' || typeof photo.mimeType !== 'string' || !mimeTypes.has(photo.mimeType) || !(photo.bytes instanceof Uint8Array) || photo.bytes.length < 1 || photo.bytes.length > maxBytes) return invalid();
  return Object.freeze({ mimeType: photo.mimeType as PrivateProfilePhoto['mimeType'], bytes: photo.bytes.slice() });
}

export function createPrivateProfilePhotoStore(ports: Ports) {
  const binding = ports.binding();
  let tail: Promise<unknown> = Promise.resolve();
  const check = () => { if (!binding || ports.binding() !== binding) throw new Error('SESSION_CHANGED'); };
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(async () => { check(); const value = await work(); check(); return value; });
    tail = result.catch(() => undefined);
    return result;
  }
  return Object.freeze({
    read: () => serial(async () => {
      const raw = await ports.storage.read();
      if (raw === null || raw === undefined || raw === '') return undefined;
      if (typeof raw !== 'string' || raw.length > 2_800_000) throw new Error('PROFILE_PHOTO_UNAVAILABLE');
      let value: Record<string, unknown>;
      try { value = JSON.parse(raw); } catch { throw new Error('PROFILE_PHOTO_UNAVAILABLE'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'binding,bytes,mimeType,version' || value.version !== 1 || value.binding !== binding || typeof value.bytes !== 'string' || value.bytes.length === 0 || value.bytes.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.bytes) || typeof value.mimeType !== 'string' || !mimeTypes.has(value.mimeType)) throw new Error('PROFILE_PHOTO_UNAVAILABLE');
      try {
        const bytes = toByteArray(value.bytes);
        if (fromByteArray(bytes) !== value.bytes) throw new Error('PROFILE_PHOTO_UNAVAILABLE');
        return checkPhoto({ mimeType: value.mimeType, bytes });
      } catch { throw new Error('PROFILE_PHOTO_UNAVAILABLE'); }
    }),
    write: (input: PrivateProfilePhoto) => serial(async () => {
      const photo = checkPhoto(input);
      const serialized = JSON.stringify({ version: 1, binding, mimeType: photo.mimeType, bytes: fromByteArray(photo.bytes) });
      if (serialized.length > 2_800_000) invalid();
      await ports.storage.write(serialized);
    }),
    clear: () => serial(() => ports.storage.clear()),
  });
}
