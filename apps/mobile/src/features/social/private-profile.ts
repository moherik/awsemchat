import type { HistorySnapshot } from '../messages/history-store';
import { validateMediaDescriptor, type MediaDescriptor } from '../media/encrypted-media.ts';

export type PrivateProfile = Readonly<{ version: 1; revision: number; name: string; status: string } |
  { version: 2; revision: number; name: string; status: string; avatar: MediaDescriptor | null }>;
export type PrivateProfileSelection =
  | { state: 'empty' }
  | { state: 'ready'; profile: PrivateProfile }
  | { state: 'invalid' | 'conflict'; revision?: number };

function validate(value: unknown): PrivateProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROFILE');
  const data = value as Record<string, unknown>;
  const v1 = data.version === 1 && Object.keys(data).sort().join(',') === 'name,revision,status,version';
  const v2 = data.version === 2 && Object.keys(data).sort().join(',') === 'avatar,name,revision,status,version';
  if ((!v1 && !v2) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || typeof data.name !== 'string' || typeof data.status !== 'string') throw new Error('INVALID_PROFILE');
  const name = data.name.trim();
  if (!name || [...name].length > 80 || [...data.status].length > 280 ||
    /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(name) || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(data.status)) throw new Error('INVALID_PROFILE');
  if (v1) return Object.freeze({ version: 1, revision: data.revision as number, name, status: data.status });
  let avatar: MediaDescriptor | null;
  try {
    if (data.avatar === null) avatar = null;
    else {
      const raw = data.avatar as MediaDescriptor;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== 'id,key,mimeType,size,version') throw new Error('INVALID_PROFILE');
      avatar = validateMediaDescriptor(raw);
    }
  } catch { throw new Error('INVALID_PROFILE'); }
  return Object.freeze({ version: 2, revision: data.revision as number, name, status: data.status, avatar });
}

export function encodePrivateProfile(value: { revision: number; name: string; status: string; avatar?: MediaDescriptor | null }): string {
  const withAvatar = Object.prototype.hasOwnProperty.call(value, 'avatar');
  return JSON.stringify(validate({ ...value, version: withAvatar ? 2 : 1 }));
}

export function decodePrivateProfile(value: string): PrivateProfile | undefined {
  if (value.length > 4096) return undefined;
  try { return validate(JSON.parse(value)); } catch { return undefined; }
}

export function selectPrivateProfile(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, conversation: string, audience: string): PrivateProfileSelection {
  const eligible = history.incoming.filter(record => record.conversation === conversation && record.audience === audience &&
    record.contentType === 'private-profile' && record.direction !== 'outgoing' && record.profileAccepted !== false &&
    typeof record.sequence === 'number' && Number.isSafeInteger(record.sequence) && record.sequence >= 0);
  if (!eligible.length) return { state: 'empty' };
  const decoded = eligible.map(record => decodePrivateProfile(record.plaintext));
  if (decoded.some(profile => !profile)) return { state: 'invalid' };
  const valid = decoded as PrivateProfile[];
  const revision = Math.max(...valid.map(profile => profile.revision));
  const latest = valid.filter(profile => profile.revision === revision);
  const selected = latest[0];
  if (latest.some(profile => JSON.stringify(profile) !== JSON.stringify(selected))) return { state: 'conflict', revision };
  return { state: 'ready', profile: selected };
}
