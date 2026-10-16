import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeNowPlaying, decodeNowPlaying, selectNowPlaying, NOW_PLAYING_TTL_MS } from '../src/features/now-playing/payload.ts';

const playing = (updatedAt, title, artist, overrides = {}) => ({ version: 1, state: 'playing', title, artist, updatedAt, expiresAt: updatedAt + NOW_PLAYING_TTL_MS, ...overrides });
const record = payload => ({ direction: 'incoming', conversation: 'private:one', audience: 'friend:request-1', contentType: 'now-playing', sequence: payload.updatedAt, plaintext: JSON.stringify(payload) });

test('Now Playing payloads carry only track metadata and bounded expiry', () => {
  const value = playing(1000, 'Sunset Lover', 'Petit Biscuit');
  assert.equal(encodeNowPlaying(value), JSON.stringify(value));
  assert.deepEqual(decodeNowPlaying(encodeNowPlaying(value)), value);
  assert.equal(decodeNowPlaying(JSON.stringify({ ...value, notificationText: 'secret' })), undefined);
  assert.equal(decodeNowPlaying(JSON.stringify({ ...value, expiresAt: value.updatedAt + NOW_PLAYING_TTL_MS + 1 })), undefined);
});

test('recipient projection uses only the newest private friend event and hides stopped or expired tracks', () => {
  const history = { incoming: [record(playing(1000, 'Old', 'Artist')), record(playing(2000, 'Current', 'Band'))], outgoing: [] };
  assert.deepEqual(selectNowPlaying(history, 'private:one', 'friend:request-1', 2001), { state: 'playing', track: { title: 'Current', artist: 'Band' } });
  assert.deepEqual(selectNowPlaying(history, 'private:one', 'friend:request-1', 2000 + NOW_PLAYING_TTL_MS), { state: 'expired' });
  history.incoming.push(record({ version: 1, state: 'stopped', updatedAt: 3000, expiresAt: 3000 + NOW_PLAYING_TTL_MS }));
  assert.deepEqual(selectNowPlaying(history, 'private:one', 'friend:request-1', 3001), { state: 'stopped' });
});
