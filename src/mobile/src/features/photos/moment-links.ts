export function removeMomentAsset<T>(assets: Record<string, T>, chat: string, removed: number): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, value] of Object.entries(assets)) {
    if (!key.startsWith(`${chat}-`)) { result[key] = value; continue; }
    const index = Number(key.slice(chat.length + 1));
    if (!Number.isInteger(index) || index < removed) result[key] = value;
    else if (index > removed) result[`${chat}-${index - 1}`] = value;
  }
  return result;
}
export function updateMomentReply<T extends { kind: string; index: number; deleted?: boolean }>(reply: T, removed: number): T {
  if (reply.kind !== 'moment' || reply.deleted) return reply;
  return reply.index === removed ? { ...reply, deleted: true } : reply.index > removed ? { ...reply, index: reply.index - 1 } : reply;
}
