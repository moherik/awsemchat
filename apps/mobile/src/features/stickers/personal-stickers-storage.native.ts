import { openEncryptedHistory } from '../../storage/encrypted-history';
import type { PersonalStickerStorage } from './personal-stickers';
export async function openPersonalStickerStorage(namespace: string): Promise<PersonalStickerStorage> {
  const db = await openEncryptedHistory(namespace);
  return {
    async list() {
      return (await db.listData('sticker:')).map(({ key, value }) => {
        const sticker: unknown = JSON.parse(value);
        if (!sticker || typeof sticker !== 'object' || !('id' in sticker) ||
            typeof sticker.id !== 'string' || key !== `sticker:${sticker.id}`) {
          throw new Error('INVALID_STICKER');
        }
        return sticker;
      });
    },
    async get(id) {
      const value = await db.getData(`sticker:${id}`);
      return value === undefined ? undefined : JSON.parse(value);
    },
    async put(value) { await db.setData(`sticker:${value.id}`, JSON.stringify(value)); },
    async mergeAll(values) {
      await db.mergeData('sticker:', values.map(value => ({ key: `sticker:${value.id}`, value: JSON.stringify(value) })));
    },
    remove: id => db.deleteData(`sticker:${id}`),
  };
}
