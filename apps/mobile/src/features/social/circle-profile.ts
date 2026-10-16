import type { HistorySnapshot } from '../messages/history-store';
import { validateMediaDescriptor, type MediaDescriptor } from '../media/encrypted-media.ts';
export type CircleAvatar = Readonly<{ epoch: number; media: MediaDescriptor }>;
export type CircleProfile = Readonly<{ version: 1; name: string; description: string; avatar: CircleAvatar | null }>;
export type CircleProfileSelection = { state: 'empty' } | { state: 'ready'; revision: number; profile: CircleProfile } | { state: 'invalid' | 'conflict'; revision: number };
function profile(value: unknown): CircleProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROFILE');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || typeof data.name !== 'string' || typeof data.description !== 'string' ||
    Object.keys(data).some(key => !['version', 'name', 'description', 'avatar'].includes(key))) throw new Error('INVALID_PROFILE');
  const name = data.name.trim();
  if (!name || [...name].length > 80 || [...data.description].length > 280 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(name) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\uD800-\uDFFF]/u.test(data.description)) throw new Error('INVALID_PROFILE');
  let avatar: CircleAvatar | null = null;
  if (data.avatar !== null) {
    const value = data.avatar as CircleAvatar;
    if (!value || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || Object.keys(value).sort().join(',') !== 'epoch,media' || !value.media || Object.keys(value.media).sort().join(',') !== 'id,key,mimeType,size,version') throw new Error('INVALID_PROFILE');
    try { avatar = Object.freeze({ epoch: value.epoch, media: validateMediaDescriptor(value.media) }); } catch { throw new Error('INVALID_PROFILE'); }
  }
  return Object.freeze({ version: 1, name, description: data.description, avatar });
}
export function encodeCircleProfile(value: { name: string; description: string; avatar: CircleAvatar | null }): string {
  return JSON.stringify(profile({ ...value, version: 1 }));
}
export function decodeCircleProfile(value: string): CircleProfile | undefined {
  if (value.length > 4096) return undefined;
  try { return profile(JSON.parse(value)); } catch { return undefined; }
}
export function selectCircleProfile(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, circle: string): CircleProfileSelection {
  const eligible = [
    ...history.incoming.filter(record => record.profileAccepted === true),
    ...history.outgoing.filter(record => (record.status === 'sent' || record.status === 'delivered') && typeof record.event === 'string' && record.event.length > 0),
  ].filter(record => record.conversation === circle && record.contentType === 'circle-profile' && typeof record.profileRevision === 'number' && Number.isSafeInteger(record.profileRevision) && record.profileRevision > 0);
  let revision = 0;
  for (const record of eligible) revision = Math.max(revision, record.profileRevision ?? 0);
  if (!revision) return { state: 'empty' };
  let selected: CircleProfile | undefined;
  for (const record of eligible) {
    if (record.profileRevision !== revision) continue;
    const next = decodeCircleProfile(record.plaintext);
    if (!next) return { state: 'invalid', revision };
    if (selected && (selected.name !== next.name || selected.description !== next.description || JSON.stringify(selected.avatar) !== JSON.stringify(next.avatar))) return { state: 'conflict', revision };
    selected = next;
  }
  return selected ? { state: 'ready', revision, profile: selected } : { state: 'empty' };
}
