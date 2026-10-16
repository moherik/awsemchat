type Database = { getData(key: string): Promise<string | undefined>; setData(key: string, value: string): Promise<void> };

export function createPrivateProfilePublicationStorage(database: Database, peerId: string, requestId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(peerId) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) throw new Error('INVALID_PROFILE_BINDING');
  const key = `profile:publication:${peerId}:${requestId}`;
  return Object.freeze({
    async read(): Promise<unknown> {
      const raw = await database.getData(key);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { throw new Error('PROFILE_PHOTO_VAULT_INVALID'); }
    },
    async write(value: unknown): Promise<void> { await database.setData(key, JSON.stringify(value)); },
    async clear(): Promise<void> { await database.setData(key, ''); },
  });
}
