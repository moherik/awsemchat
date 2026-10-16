import { expect, jest, test } from '@jest/globals';
import { gifFavorites } from '../src/features/giphy/favorites.native';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    getAllAsync: async () => [],
    withTransactionAsync: async (work: () => Promise<void>) => work(),
    runAsync: async () => {},
  }),
}));

test('native GIF favorites store initializes and reads persisted favorites', async () => {
  await expect(gifFavorites.list()).resolves.toEqual([]);
});
