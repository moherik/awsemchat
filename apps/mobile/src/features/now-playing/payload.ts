import type { NowPlayingTrack } from './bridge.ts';

export const NOW_PLAYING_TTL_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;
type Playing = Readonly<{ version: 1; state: 'playing'; title: string; artist: string; updatedAt: number; expiresAt: number }>;
type Stopped = Readonly<{ version: 1; state: 'stopped'; updatedAt: number; expiresAt: number }>;
export type NowPlayingUpdate = Playing | Stopped;
type HistoryRecord = Readonly<{ direction?: string; conversation: string; audience: string; contentType?: string | null; sequence?: number | null; plaintext: string }>;
type History = Readonly<{ incoming: readonly HistoryRecord[]; outgoing: readonly HistoryRecord[] }>;
const clean = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const timestamp = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function decodeNowPlaying(raw: unknown): NowPlayingUpdate | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || !timestamp(data.updatedAt) || !timestamp(data.expiresAt) || (data.expiresAt as number) <= (data.updatedAt as number) || (data.expiresAt as number) - (data.updatedAt as number) > NOW_PLAYING_TTL_MS) return undefined;
    if (data.state === 'playing' && Object.keys(data).sort().join(',') === 'artist,expiresAt,state,title,updatedAt,version' && clean(data.title, 160) && clean(data.artist, 120)) return Object.freeze({ version: 1, state: 'playing', title: data.title, artist: data.artist, updatedAt: data.updatedAt as number, expiresAt: data.expiresAt as number });
    if (data.state === 'stopped' && Object.keys(data).sort().join(',') === 'expiresAt,state,updatedAt,version') return Object.freeze({ version: 1, state: 'stopped', updatedAt: data.updatedAt as number, expiresAt: data.expiresAt as number });
    return undefined;
  } catch { return undefined; }
}

export function encodeNowPlaying(update: NowPlayingUpdate): string {
  const raw = JSON.stringify(update);
  if (!decodeNowPlaying(raw)) throw new Error('INVALID_NOW_PLAYING');
  return raw;
}

export function playingUpdate(track: NowPlayingTrack, updatedAt: number): Playing {
  return decodeNowPlaying(JSON.stringify({ version: 1, state: 'playing', title: track.title, artist: track.artist, updatedAt, expiresAt: updatedAt + NOW_PLAYING_TTL_MS })) as Playing;
}
export function stoppedUpdate(updatedAt: number): Stopped {
  return Object.freeze({ version: 1, state: 'stopped', updatedAt, expiresAt: updatedAt + NOW_PLAYING_TTL_MS });
}

export function selectNowPlaying(history: History, conversation: string, audience: string, now: number) {
  if (!Number.isSafeInteger(now) || now < 1) return { state: 'invalid' as const };
  const records = history.incoming.filter(record => record.contentType === 'now-playing' && record.conversation === conversation && record.audience === audience && record.direction === 'incoming');
  if (!records.length) return { state: 'empty' as const };
  const values = records.map(record => ({ record, update: decodeNowPlaying(record.plaintext) }));
  if (values.some(value => !value.update || !timestamp(value.record.sequence))) return { state: 'invalid' as const };
  const latestSequence = Math.max(...values.map(value => value.record.sequence!));
  const latest = values.filter(value => value.record.sequence === latestSequence).map(value => value.update!);
  const key = JSON.stringify(latest[0]);
  if (latest.some(value => JSON.stringify(value) !== key)) return { state: 'conflict' as const };
  const update = latest[0];
  if (update.updatedAt > now + MAX_FUTURE_SKEW_MS) return { state: 'invalid' as const };
  if (update.state === 'stopped') return { state: 'stopped' as const };
  if (update.expiresAt <= now) return { state: 'expired' as const };
  return { state: 'playing' as const, track: Object.freeze({ title: update.title, artist: update.artist }) };
}
