import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../src/features/messages/circle-sticker-sender.ts').catch(() => ({}));
const descriptor = { version: 1, id: 'media-one', key: 'a'.repeat(64), size: 3, mimeType: 'image/png' };

function fixture() {
  let binding = 'account-one', job, loseReply = true;
  const sent = [], uploaded = [], released = [], prepared = [];
  const ports = {
    account: () => binding,
    operation: () => 'operation-one',
    context: async ({ circleId }) => ({ circleId, conversation: circleId, epoch: 4, audience: 'circle:4', recipients: ['member-a', 'member-b'] }),
    upload: {
      pending: async () => job,
      prepare: async (input, epoch, profileRevision, collectionIntent, momentIntent, chatImageIntent, chatStickerIntent) => {
        prepared.push({ bytes: [...input.bytes], mimeType: input.mimeType, epoch, profileRevision, collectionIntent, momentIntent, chatImageIntent, chatStickerIntent });
        job = { version: 1, binding: 'account-one', circleId: 'circle-one', epoch, phase: 'prepared', prepared: { descriptor, ciphertext: 'AQID' }, ...(chatStickerIntent ? { chatStickerIntent } : {}) };
      },
      upload: async () => { uploaded.push(job.chatStickerIntent.operation); job = { ...job, phase: 'uploaded' }; return descriptor; },
      acknowledge: async () => { released.push(job); job = undefined; },
      release: async expected => { released.push(expected); job = undefined; },
      cancel: async () => { const committed = job?.phase === 'uploaded'; if (!committed) { released.push(job); job = undefined; } return committed ? { state: 'committed', eventId: 'event-one' } : { state: 'cancelled' }; },
    },
    send: async draft => { sent.push(draft); if (loseReply) { loseReply = false; throw new Error('NETWORK'); } return { id: 'event-one', operation: draft.operation, status: 'sent' }; },
  };
  return { ports, sent, uploaded, released, prepared, pending: () => job, changeAccount: () => { binding = 'account-two'; } };
}

function sender(value) {
  assert.equal(typeof module.createCircleStickerMessageSender, 'function', 'Circle personal sticker sender is missing');
  return module.createCircleStickerMessageSender(value.ports, 'circle-one');
}

test('a personal sticker upload retries the same encrypted one-off message without collection publication', async () => {
  const value = fixture(), controller = sender(value);
  await assert.rejects(controller.sendSticker({ label: 'Made for you', image: 'data:image/png;base64,AQID' }), /NETWORK/);
  assert.deepEqual(value.prepared[0], { bytes: [1, 2, 3], mimeType: 'image/png', epoch: 4, profileRevision: undefined, collectionIntent: undefined, momentIntent: undefined, chatImageIntent: undefined, chatStickerIntent: { operation: 'operation-one', item: 'operation-one', label: 'Made for you' } });
  const pending = await controller.pending();
  assert.deepEqual(pending, { operation: 'operation-one', item: 'operation-one', label: 'Made for you', epoch: 4, phase: 'uploaded' });
  const recoveredAfterRestart = sender(value);
  await recoveredAfterRestart.retry();
  assert.deepEqual(value.sent[0], value.sent[1]);
  assert.equal(value.sent[1].circleId, 'circle-one');
  assert.equal(value.sent[1].expectedEpoch, 4);
  const body = JSON.parse(value.sent[1].plaintext);
  assert.equal(body.type, 'circle-sticker');
  assert.equal(body.item, 'operation-one');
  assert.equal(body.label, 'Made for you');
  assert.deepEqual(body.image, { epoch: 4, media: descriptor });
  assert.equal(await recoveredAfterRestart.pending(), undefined);
  assert.equal(value.uploaded.length, 2);
});

test('a personal sticker can only be discarded while its protected upload is still local', async () => {
  const value = fixture(), controller = sender(value);
  value.ports.upload.upload = async () => { throw new Error('UPLOAD_UNAVAILABLE'); };
  await assert.rejects(controller.sendSticker({ label: 'Made for you', image: 'data:image/png;base64,AQID' }), /UPLOAD_UNAVAILABLE/);
  assert.equal((await controller.pending()).phase, 'prepared');
  await controller.discard();
  assert.equal(await controller.pending(), undefined);
  assert.equal(value.released.length, 1);
  assert.equal(value.sent.length, 0);
});

test('a pending personal sticker reconciles a committed upload before reporting discard', async () => {
  const value = fixture(), controller = sender(value);
  await assert.rejects(controller.sendSticker({ label: 'Made for you', image: 'data:image/png;base64,AQID' }), /NETWORK/);
  const result = await controller.discard();assert.equal(result.state,'committed');assert.equal(await controller.pending(),undefined);assert.equal(value.sent.length,2);
});
