import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircleMomentPublisher } from '../src/features/messages/circle-moment-publisher.ts';
import { decodeCircleMoment, encodeCircleMoment } from '../src/features/messages/circle-moments.ts';
import { decodeCircleMomentReaction, encodeCircleMomentReaction } from '../src/features/messages/circle-moment-reactions.ts';
import { decodeCircleMomentReply } from '../src/features/messages/circle-moment-reply.ts';
import { decodeCircleMomentDeletion } from '../src/features/messages/circle-moment-deletion.ts';
import { decodeCirclePhotoMessage, encodeCirclePhotoMessage } from '../src/features/messages/circle-photo-message.ts';

const circleContext = { circleId: 'circle-a', conversation: 'circle-a', audience: 'circle:3', epoch: 3, collectionRevision: 2, recipients: [{ accountId: 'member-b' }] };
function publisherFixture(overrides = {}) {
  let account = 'account-a', counter = 0;
  const sent = [], records = [];
  const ports = {
    account: () => account,
    operation: () => `operation-${++counter}`,
    context: async () => circleContext,
    history: async () => ({ outgoing: records }),
    send: async draft => { sent.push(draft); return draft; },
    ...overrides,
  };
  return { publisher: createCircleMomentPublisher(ports, 'circle-a'), sent, records, replaceAccount: value => { account = value; } };
}

test('posting a Circle Moment sends a validated body using the current Circle audience', async () => {
  const { publisher, sent } = publisherFixture();
  await publisher.post('Sunday together');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].circleId, 'circle-a');
  assert.equal(sent[0].expectedEpoch, 3);
  assert.equal(decodeCircleMoment(sent[0].plaintext).caption, 'Sunday together');
});

test('posting a photo Moment includes the validated encrypted media descriptor in the encrypted body', async () => {
  const { publisher, sent } = publisherFixture();
  const media = { epoch: 3, media: { version: 1, id: 'photo-1', key: 'c'.repeat(64), size: 1024, mimeType: 'image/jpeg' } };
  await publisher.post('Sunday together', media);
  assert.deepEqual(decodeCircleMoment(sent[0].plaintext), { version: 1, type: 'circle-moment', id: 'operation-1', caption: 'Sunday together', media });
});

test('reacting to an accessible current-epoch Moment sends an encrypted reaction into that Circle', async () => {
  const moment = encodeCircleMoment({ id: 'friend-moment', caption: 'Sunday together' });
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [{ operation: 'source', conversation: 'circle-a', audience: 'circle:3', plaintext: moment, sender: { identity: 'friend' }, sequence: 2 }], outgoing: [] }) });
  await publisher.react('friend-moment', '❤️');
  assert.equal(sent[0].circleId, 'circle-a');
  assert.equal(sent[0].expectedEpoch, 3);
  assert.equal(decodeCircleMomentReaction(sent[0].plaintext).momentId, 'friend-moment');
});

test('reacting cannot reference a Moment from a prior Circle audience epoch', async () => {
  const moment = encodeCircleMoment({ id: 'old-moment', caption: 'Before joining' });
  const { publisher, sent } = publisherFixture({ context: async () => ({ ...circleContext, audience: 'circle:4', epoch: 4 }), history: async () => ({ incoming: [{ operation: 'source', conversation: 'circle-a', audience: 'circle:3', plaintext: moment, sender: { identity: 'friend' }, sequence: 2 }], outgoing: [] }) });
  await assert.rejects(publisher.react('old-moment', '😂'), /MOMENT_NOT_ACCESSIBLE/);
  assert.equal(sent.length, 0);
});

test('selecting an existing own reaction sends an inactive event to remove it', async () => {
  const moment = encodeCircleMoment({ id: 'friend-moment', caption: 'Sunday together' });
  const ownReaction = encodeCircleMomentReaction({ id: 'old-reaction', momentId: 'friend-moment', emoji: '❤️', active: true });
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [{ operation: 'source', conversation: 'circle-a', audience: 'circle:3', plaintext: moment, sender: { identity: 'friend' }, sequence: 2 }], outgoing: [{ operation: 'old-reaction', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: ownReaction, sequence: 4, createdAt: 4, status: 'sent', event: 'event-old' }] }) });
  await publisher.react('friend-moment', '❤️');
  assert.equal(decodeCircleMomentReaction(sent[0].plaintext).active, false);
});

test('replying to an accessible Moment embeds its preview in a current-audience Chat message', async () => {
  const moment = encodeCircleMoment({ id: 'friend-moment', caption: 'Sunday together' });
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [{ operation: 'source', conversation: 'circle-a', audience: 'circle:3', plaintext: moment, sender: { identity: 'friend' }, sequence: 2 }], outgoing: [] }) });
  await publisher.reply('friend-moment', 'That looks wonderful', 'reply-operation');
  const reply = decodeCircleMomentReply(sent[0].plaintext);
  assert.equal(sent[0].expectedEpoch, 3);
  assert.equal(reply.text, 'That looks wonderful');
  assert.deepEqual(reply.moment, { id: 'friend-moment', audience: 'circle:3', caption: 'Sunday together' });
});

test('reply publisher refuses a Moment unavailable to the current membership epoch', async () => {
  const moment = encodeCircleMoment({ id: 'old-moment', caption: 'Before joining' });
  const { publisher, sent } = publisherFixture({ context: async () => ({ ...circleContext, audience: 'circle:4', epoch: 4 }), history: async () => ({ incoming: [{ operation: 'source', conversation: 'circle-a', audience: 'circle:3', plaintext: moment, sender: { identity: 'friend' }, sequence: 2 }], outgoing: [] }) });
  await assert.rejects(publisher.reply('old-moment', 'Hello', 'reply-op'), /MOMENT_NOT_ACCESSIBLE/);
  assert.equal(sent.length, 0);
});

test('only the author can delete an accessible Moment in the current epoch', async () => {
  const ownMoment = encodeCircleMoment({ id: 'own-moment', caption: 'Sunday together' });
  const friendMoment = encodeCircleMoment({ id: 'friend-moment', caption: 'Their Sunday' });
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [
    { operation: 'own-op', direction: 'outgoing', conversation: 'circle-a', audience: 'circle:3', plaintext: ownMoment, sender: { identity: 'self' }, sequence: 2 },
    { operation: 'friend-op', conversation: 'circle-a', audience: 'circle:3', plaintext: friendMoment, sender: { identity: 'friend' }, sequence: 3 },
  ], outgoing: [] }) });
  await publisher.remove('own-moment');
  assert.equal(decodeCircleMomentDeletion(sent[0].plaintext).momentId, 'own-moment');
  await assert.rejects(publisher.remove('friend-moment'), /MOMENT_NOT_ACCESSIBLE/);
  assert.equal(sent.length, 1);
});

test('promotion copies an accepted own Circle message into a Moment for the same audience', async () => {
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [], outgoing: [{ operation: 'source-op', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: 'Sunday was lovely', contentType: 'text', status: 'delivered', event: 'event-1' }] }) });
  await publisher.promote('source-op');
  const moment = decodeCircleMoment(sent[0].plaintext);
  assert.equal(moment.caption, 'Sunday was lovely');
  assert.equal(sent[0].expectedEpoch, 3);
});

test('promotion of an accepted Circle photo reuses its encrypted image for the same audience', async () => {
  const image = { epoch: 3, media: { version: 1, id: 'photo-1', key: 'e'.repeat(64), size: 1024, mimeType: 'image/jpeg' } };
  const body = encodeCirclePhotoMessage({ id: 'photo-source', caption: 'At the park', image });
  const { publisher, sent } = publisherFixture({ history: async () => ({ incoming: [], outgoing: [{ operation: 'photo-source', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: body, contentType: 'text', status: 'delivered', event: 'event-photo' }] }) });
  await publisher.promote('photo-source');
  const promoted = decodeCircleMoment(sent[0].plaintext);
  assert.equal(promoted.caption, 'At the park');
  assert.deepEqual(promoted.media, image);
});

test('promotion refuses old-audience or unaccepted Circle messages', async () => {
  const oldAudience = publisherFixture({ history: async () => ({ incoming: [], outgoing: [{ operation: 'old-op', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:2', plaintext: 'Before joining', contentType: 'text', status: 'delivered', event: 'event-2' }] }) });
  await assert.rejects(oldAudience.publisher.promote('old-op'), /MOMENT_NOT_ACCESSIBLE/);
  const queued = publisherFixture({ history: async () => ({ incoming: [], outgoing: [{ operation: 'queued-op', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: 'Still sending', contentType: 'text', status: 'queued', event: null }] }) });
  await assert.rejects(queued.publisher.promote('queued-op'), /MOMENT_NOT_ACCESSIBLE/);
  assert.equal(oldAudience.sent.length + queued.sent.length, 0);
});

test('promotion refuses Moment controls and text that cannot fit a Moment', async () => {
  const source = text => publisherFixture({ history: async () => ({ incoming: [], outgoing: [{ operation: 'source', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: text, contentType: 'text', status: 'delivered', event: 'event-1' }] }) });
  const control = source(JSON.stringify({ version: 1, type: 'circle-moment-reply', id: 'reply', text: 'Hi', moment: { id: 'm', audience: 'circle:3', caption: 'Moment' } }));
  await assert.rejects(control.publisher.promote('source'), /MOMENT_SOURCE_INVALID/);
  const long = source('x'.repeat(281));
  await assert.rejects(long.publisher.promote('source'), /MOMENT_SOURCE_TOO_LONG/);
  assert.equal(control.sent.length + long.sent.length, 0);
});

test('Moment publishing refuses an unrelated Circle context and an account changed during publish', async () => {
  const different = publisherFixture({ context: async () => ({ ...circleContext, circleId: 'circle-b' }) });
  await assert.rejects(different.publisher.post('Hello'), /CONTEXT_MISMATCH/);
  assert.equal(different.sent.length, 0);
  let calls = 0;
  const changed = publisherFixture({ account: () => ++calls < 3 ? 'account-a' : 'account-b' });
  await assert.rejects(changed.publisher.post('Hello'), /SESSION_CHANGED/);
  assert.equal(changed.sent.length, 0);
});

test('queued Circle Moment blocks a replacement and retries its exact original operation and body', async () => {
  const body = encodeCircleMoment({ id: 'original-operation', caption: 'One quiet Sunday' });
  const records = [{ operation: 'original-operation', conversation: 'circle-a', circle: 'circle-a', target: null, audience: 'circle:3', plaintext: body, status: 'queued', event: null }];
  const sent = [];
  const publisher = createCircleMomentPublisher({ account: () => 'account-a', operation: () => 'replacement-operation', context: async () => circleContext, history: async () => ({ outgoing: records }), send: async draft => { sent.push(draft); return draft; } }, 'circle-a');
  await assert.rejects(publisher.post('Replacement'), /MOMENT_PENDING/);
  await publisher.retry();
  assert.deepEqual(sent, [{ circleId: 'circle-a', expectedEpoch: 3, operation: 'original-operation', plaintext: body }]);
});
