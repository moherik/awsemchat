import test from 'node:test';
import assert from 'node:assert/strict';
import { createCirclePhotoEditor } from '../src/features/messages/circle-photo-editor.ts';
import { decodeCirclePhotoMessage } from '../src/features/messages/circle-photo-message.ts';

const image = { version: 1, id: 'photo-1', key: 'd'.repeat(64), size: 128, mimeType: 'image/jpeg' };
const context = { circleId: 'circle-a', conversation: 'circle-a', audience: 'circle:3', epoch: 3, recipients: [{ accountId: 'member-b' }] };
function fixture(overrides = {}) {
  let account = 'account-a', uploadJob, sends = 0;
  const sent = [], uploaded = [];
  const contextPort = overrides.context ?? (async () => context);
  const upload = {
    pending: async () => uploadJob,
    prepare: async (photo, epoch, _revision, _collection, _moment, intent) => { uploadJob = { epoch, phase: 'prepared', chatImageIntent: intent, prepared: { descriptor: image, ciphertext: 'opaque-ciphertext' }, bytes: photo.bytes.slice() }; return uploadJob; },
    upload: async () => { if (overrides.failUpload) throw new Error('NETWORK'); uploaded.push(uploadJob.bytes.slice()); uploadJob.phase = 'uploaded'; return image; },
    release: async expected => { if (JSON.stringify(uploadJob) !== JSON.stringify(expected)) throw new Error('MEDIA_CONFLICT'); uploadJob = undefined; },
    acknowledge: async () => { uploadJob = undefined; },
    cancel: async () => { const committed = !!overrides.failFirstSend; if (!committed) uploadJob = undefined; return committed ? { state: 'committed', eventId: 'event-1' } : { state: 'cancelled' }; },
  };
  const ports = {
    account: () => account,
    operation: () => 'operation-photo-1',
    context: contextPort,
    upload,
    send: async draft => { const active = await contextPort(); if (draft.expectedEpoch !== active.epoch) throw new Error('CONTEXT_MISMATCH'); sends++; sent.push(draft); if (overrides.failFirstSend && sends === 1) throw new Error('NETWORK'); return { id: 'event-1', status: 'sent', operation: draft.operation }; },
    ...overrides,
  };
  return { editor: createCirclePhotoEditor(ports, 'circle-a'), sent, uploaded, setAccount: value => { account = value; }, getUpload: () => uploadJob };
}

test('photo editor uploads ciphertext and sends a validated message for the captured Circle epoch', async () => {
  const { editor, sent, uploaded } = fixture();
  await editor.sendPhoto({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', caption: 'Sunday together' });
  const message = decodeCirclePhotoMessage(sent[0].plaintext);
  assert.equal(sent[0].circleId, 'circle-a');
  assert.equal(sent[0].expectedEpoch, 3);
  assert.equal(sent[0].operation, 'operation-photo-1');
  assert.equal(message.caption, 'Sunday together');
  assert.deepEqual(message.image, { epoch: 3, media: image });
  assert.equal(uploaded.length, 1);
});

test('lost send replies retain the exact protected photo intent for retry', async () => {
  const { editor, sent, uploaded, getUpload } = fixture({ failFirstSend: true });
  await assert.rejects(editor.sendPhoto({ bytes: new Uint8Array([9, 8, 7]), mimeType: 'image/jpeg', caption: 'At the lake' }), /NETWORK/);
  const original = sent[0];
  assert.equal(getUpload().phase, 'uploaded');
  await editor.retry();
  assert.equal(sent[1].operation, original.operation);
  assert.equal(sent[1].plaintext, original.plaintext);
  assert.deepEqual(uploaded, [new Uint8Array([9, 8, 7]), new Uint8Array([9, 8, 7])]);
  assert.equal(getUpload(), undefined);
});

test('photo send refuses a Circle epoch change before sending and retains local recovery', async () => {
  let reads = 0;
  const { editor, sent, getUpload } = fixture({ context: async () => ++reads === 1 ? context : ({ ...context, audience: 'circle:4', epoch: 4 }) });
  await assert.rejects(editor.sendPhoto({ bytes: new Uint8Array([4]), mimeType: 'image/jpeg', caption: '' }), /CONTEXT_MISMATCH/);
  assert.equal(sent.length, 0);
  assert.equal(getUpload().epoch, 3);
});

test('photo editor can discard a photo that has not been uploaded', async () => {
  const { editor, getUpload } = fixture({ failUpload: true });
  await assert.rejects(editor.sendPhoto({ bytes: new Uint8Array([4]), mimeType: 'image/jpeg', caption: '' }), /NETWORK/);
  assert.equal(typeof editor.discard, 'function', 'safe pending photo discard is missing');
  await editor.discard();
  assert.equal(getUpload(), undefined);
});

test('photo editor reconciles an uploaded photo whose send result was uncertain', async () => {
  const { editor, getUpload, sent } = fixture({ failFirstSend: true });
  await assert.rejects(editor.sendPhoto({ bytes: new Uint8Array([4]), mimeType: 'image/jpeg', caption: '' }), /NETWORK/);
  const result = await editor.discard();
  assert.equal(result.state, 'committed');assert.equal(sent.length, 2);assert.equal(getUpload(), undefined);
});

