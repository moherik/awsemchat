import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/features/messages/shared-media.ts').catch(() => ({}));
const conversation = `private:${'a'.repeat(64)}`;
const audience = 'friend:request-7';
const media = { version: 1, id: 'asset-1', key: 'f'.repeat(64), size: 128, mimeType: 'image/jpeg' };

test('private shared media lists only photo messages and Moments from the active conversation', () => {
  assert.equal(typeof api.selectPrivateSharedMedia, 'function', 'shared media projection is missing');
  const photo = JSON.stringify({ version: 1, type: 'private-photo-message', id: 'photo-1', audience, caption: 'At the lake', media });
  const moment = JSON.stringify({ version: 1, type: 'private-moment', id: 'moment-1', audience, caption: 'Sunday', media });
  const record = (operation, plaintext, target = 'friend-1', sequence = 2, convo = conversation) => ({ conversation: convo, audience, operation, plaintext, direction: 'incoming', sender: { identity: 'peer-key' }, sequence, target, circle: null });
  const history = { incoming: [record('photo-1', photo), record('moment-1', moment, 'friend-1', 3), record('text-1', 'hello'), record('other-photo', photo, 'friend-2', 4, `private:${'b'.repeat(64)}`)], outgoing: [] };
  const gifMedia = { ...media, id: 'gif-asset', mimeType: 'image/gif' };
  const gifMessage = JSON.stringify({ version: 1, type: 'private-photo-message', id: 'gif-1', audience, caption: 'A wave', media: gifMedia });
  history.incoming.push(record('gif-1', gifMessage, 'friend-1', 5));
  const items = api.selectPrivateSharedMedia(history, conversation, audience);
  assert.deepEqual(items.map(item => [item.kind, item.caption]), [['gif', 'A wave'], ['moment', 'Sunday'], ['photo', 'At the lake']]);
  assert.deepEqual(items[1].media, media);
  assert.deepEqual(items[0].media, gifMedia);
});

test('Circle shared media preserves the key epoch for encrypted photo and Moment downloads', () => {
  assert.equal(typeof api.selectCircleSharedMedia, 'function', 'Circle shared media projection is missing');
  const circle = 'circle-1';
  const image = { epoch: 3, media };
  const photo = JSON.stringify({ version: 1, type: 'circle-photo-message', id: 'photo-1', caption: 'Team lunch', image });
  const moment = JSON.stringify({ version: 1, type: 'circle-moment', id: 'moment-1', caption: 'Sunday', media: image });
  const record = (operation, plaintext, sequence) => ({ conversation: circle, audience: 'circle:3', operation, plaintext, direction: 'incoming', sender: { identity: 'peer-key' }, sequence, circle, target: null });
  const items = api.selectCircleSharedMedia({ incoming: [record('photo-1', photo, 1), record('moment-1', moment, 2)], outgoing: [] }, circle);
  const gifMedia = { ...media, id: 'gif-asset', mimeType: 'image/gif' };
  const gifPhoto = JSON.stringify({ version: 1, type: 'circle-photo-message', id: 'gif-1', caption: 'A wave', image: { epoch: 3, media: gifMedia } });
  const withGif = api.selectCircleSharedMedia({ incoming: [record('photo-1', photo, 1), record('moment-1', moment, 2), record('gif-1', gifPhoto, 3)], outgoing: [] }, circle);
  assert.deepEqual(withGif.map(item => [item.kind, item.caption, item.epoch]), [['gif', 'A wave', 3], ['moment', 'Sunday', 3], ['photo', 'Team lunch', 3]]);
});
