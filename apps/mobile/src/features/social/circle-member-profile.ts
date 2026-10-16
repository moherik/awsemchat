import type { HistorySnapshot } from '../messages/history-store';
import type { PeerKeys } from '../../security/durable-encryption';

export type CircleMemberProfile = Readonly<{ version: 1; revision: number; name: string; status: string }>;
export type CircleMemberProfileSelection = { state: 'empty' } | { state: 'ready'; profile: CircleMemberProfile } | { state: 'invalid' | 'conflict'; revision?: number };

function validate(value: unknown): CircleMemberProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_PROFILE');
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || Object.keys(data).sort().join(',') !== 'name,revision,status,version' ||
    !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || typeof data.name !== 'string' || typeof data.status !== 'string') throw new Error('INVALID_PROFILE');
  const name = data.name.trim();
  if (!name || [...name].length > 80 || [...data.status].length > 280 ||
    /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(name) || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(data.status)) throw new Error('INVALID_PROFILE');
  return Object.freeze({ version: 1, revision: data.revision as number, name, status: data.status });
}

export function encodeCircleMemberProfile(value: { revision: number; name: string; status: string }): string {
  return JSON.stringify(validate({ ...value, version: 1 }));
}

export function decodeCircleMemberProfile(value: string): CircleMemberProfile | undefined {
  if (value.length > 4096) return undefined;
  try { return validate(JSON.parse(value)); } catch { return undefined; }
}

export function selectCircleMemberProfile(history: Pick<HistorySnapshot, 'incoming'>, circle: string, audience: string, sender: PeerKeys): CircleMemberProfileSelection {
  const records = history.incoming.filter(record => record.direction !== 'outgoing' && record.contentType === 'circle-member-profile' &&
    record.conversation === circle && record.audience === audience && record.sender.identity === sender.identity &&
    record.sender.signingIdentity === sender.signingIdentity && typeof record.sequence === 'number' &&
    Number.isSafeInteger(record.sequence) && record.sequence >= 0);
  if (!records.length) return { state: 'empty' };
  const decoded = records.map(record => decodeCircleMemberProfile(record.plaintext));
  if (decoded.some(profile => !profile)) return { state: 'invalid' };
  const profiles = decoded as CircleMemberProfile[];
  const revision = Math.max(...profiles.map(profile => profile.revision));
  const latest = profiles.filter(profile => profile.revision === revision);
  const selected = latest[0];
  if (latest.some(profile => JSON.stringify(profile) !== JSON.stringify(selected))) return { state: 'conflict', revision };
  return { state: 'ready', profile: selected };
}
