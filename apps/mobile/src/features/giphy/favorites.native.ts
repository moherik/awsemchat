import * as SQLite from 'expo-sqlite';
import { createGifFavorites } from './favorites-store';
const database = SQLite.openDatabaseAsync('awsemchat-giphy.sqlite');
const ready = database.then(async db => { await db.execAsync('CREATE TABLE IF NOT EXISTS giphy_favorites (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, position INTEGER NOT NULL)'); return db; });
export const gifFavorites = createGifFavorites({
  async get() {
    const db = await ready;
    const rows = await db.getAllAsync<{ id: string; title: string }>('SELECT id, title FROM giphy_favorites ORDER BY position LIMIT 100');
    return JSON.stringify(rows);
  },
  async set(value) {
    const entries = JSON.parse(value) as { id: string; title: string }[];
    const db = await ready;
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM giphy_favorites');
      for (const [position, entry] of entries.entries()) await db.runAsync('INSERT INTO giphy_favorites (id, title, position) VALUES (?, ?, ?)', entry.id, entry.title, position);
    });
  },
});
