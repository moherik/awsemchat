import { encodeNowPlaying, playingUpdate, stoppedUpdate, decodeNowPlaying, NOW_PLAYING_TTL_MS } from './payload.ts';
import type { NowPlayingTrack } from './bridge.ts';
import type { Page } from '../social/api.ts';

type Friend = Readonly<{ accountId: string; requestId?: string }>;
type Context = Readonly<{ conversation: string; audience: string; recipients: readonly { accountId: string }[] }>;
type Outgoing = Readonly<{ operation: string; conversation: string; audience: string; target: string | null; circle: string | null; contentType?: string | null; plaintext: string; status: 'queued' | 'sent' | 'delivered'; sequence?: number | null; createdAt?: number | null }>;
type Ports = {
  binding(): string;
  now(): number;
  page(cursor: string, limit: number): Promise<Page<Friend>>;
  context(targetId: string): Promise<Context>;
  outgoing(): Promise<readonly Outgoing[]>;
  operation(): string | Promise<string>;
  send(draft: { targetId: string; operation: string; contentType: 'now-playing'; plaintext: string }): Promise<unknown>;
};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
const validFriend = (friend: Friend): friend is Friend & { requestId: string } => validId(friend.accountId) && validId(friend.requestId);

export function createNowPlayingFanout(ports: Ports) {
  let requested: NowPlayingTrack | null | undefined;
  let active: Promise<void> | undefined;
  function check(binding: string) { if (!binding || ports.binding() !== binding) throw new Error('SESSION_CHANGED'); }

  async function publish(target: NowPlayingTrack | null) {
    if (target && (!validTrack(target))) throw new Error('INVALID_NOW_PLAYING');
    const binding = ports.binding(); check(binding);
    const known = await ports.outgoing(); check(binding);
    if (target === null && !known.some(record => record.contentType === 'now-playing')) return;
    const cursors = new Set<string>(); let cursor = '';
    do {
      check(binding);
      const page = await ports.page(cursor, 25); check(binding);
      const seen = new Set<string>();
      for (const friend of page.items) {
        if (!validFriend(friend) || seen.has(friend.accountId)) continue;
        seen.add(friend.accountId);
        await publishFriend(friend, target, binding);
      }
      if (!page.nextCursor) break;
      if (!validId(page.nextCursor) || cursors.has(page.nextCursor)) throw new Error('INVALID_CURSOR');
      cursors.add(page.nextCursor); cursor = page.nextCursor;
    } while (true);
  }

  async function publishFriend(friend: Friend, target: NowPlayingTrack | null, binding: string) {
    const context = await ports.context(friend.accountId); check(binding);
    if (context.audience !== `friend:${friend.requestId}` || !/^private:[0-9a-f]{64}$/.test(context.conversation) || context.recipients.length !== 1 || context.recipients[0].accountId !== friend.accountId) return;
    let outgoing = await ports.outgoing(); check(binding);
    let relevant = outgoing.filter(record => record.contentType === 'now-playing' && record.conversation === context.conversation && record.audience === context.audience && record.target === friend.accountId && record.circle === null);
    if (relevant.some(record => !decodeNowPlaying(record.plaintext))) throw new Error('NOW_PLAYING_CONFLICT');
    const pending = relevant.filter(record => record.status === 'queued').sort((a, b) => (a.sequence ?? a.createdAt ?? 0) - (b.sequence ?? b.createdAt ?? 0))[0];
    if (pending) {
      await ports.send({ targetId: friend.accountId, operation: pending.operation, contentType: 'now-playing', plaintext: pending.plaintext });
      check(binding);
      outgoing = await ports.outgoing(); check(binding);
      relevant = outgoing.filter(record => record.contentType === 'now-playing' && record.conversation === context.conversation && record.audience === context.audience && record.target === friend.accountId && record.circle === null);
      if (relevant.some(record => record.status === 'queued')) return;
    }
    const latest = relevant.reduce<Outgoing | undefined>((best, record) => !best || (record.sequence ?? record.createdAt ?? 0) > (best.sequence ?? best.createdAt ?? 0) ? record : best, undefined);
    const previous = latest ? decodeNowPlaying(latest.plaintext) : undefined;
    if (latest && !previous) throw new Error('NOW_PLAYING_CONFLICT');
    const now = ports.now();
    let plaintext: string;
    if (target) {
      if (previous?.state === 'playing' && previous.title === target.title && previous.artist === target.artist && previous.expiresAt > now) return;
      plaintext = encodeNowPlaying(playingUpdate(target, now));
    } else {
      if (previous?.state !== 'playing' || previous.expiresAt <= now) return;
      plaintext = encodeNowPlaying(stoppedUpdate(now));
    }
    const operation = await ports.operation(); check(binding);
    if (!validId(operation)) throw new Error('INVALID_OPERATION');
    await ports.send({ targetId: friend.accountId, operation, contentType: 'now-playing', plaintext });
    check(binding);
  }

  function drain(): Promise<void> {
    const run = async () => { while (requested !== undefined) { const value = requested; requested = undefined; await publish(value); } };
    if (!active) active = run().finally(() => { active = undefined; });
    return active;
  }
  return Object.freeze({ run(track: NowPlayingTrack | null) { requested = track ? Object.freeze({ ...track }) : null; return drain(); } });
}

function validTrack(value: NowPlayingTrack): boolean {
  return typeof value.title === 'string' && value.title.trim() === value.title && value.title.length > 0 && value.title.length <= 160 &&
    typeof value.artist === 'string' && value.artist.trim() === value.artist && value.artist.length > 0 && value.artist.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(value.title + value.artist) && NOW_PLAYING_TTL_MS > 0;
}
