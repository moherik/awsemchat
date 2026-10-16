import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircleMomentEditor } from '../src/features/messages/circle-moment-editor.ts';
import { decodeCircleMoment, encodeCircleMoment } from '../src/features/messages/circle-moments.ts';

const context = { circleId: 'circle-a', conversation: 'circle-a', audience: 'circle:3', epoch: 3, recipients: [{ accountId: 'member-b' }] };
const descriptor = { version: 1, id: 'media-1', key: 'a'.repeat(64), size: 12, mimeType: 'image/jpeg' };
function fixture({ failSend = false, failUpload = false, epoch = 3, account = () => 'account-a' } = {}) {
  let job, pending, sends = [], posts = [], acknowledged = 0, counter = 0;
  const upload = {
    async pending() { return job; },
    async prepare(input, selectedEpoch, _revision, _collection, momentIntent) { job = { phase: 'prepared', epoch: selectedEpoch, input, momentIntent, prepared: { descriptor } }; },
    async upload() { if (failUpload) throw new Error('NETWORK_UPLOAD'); job.phase = 'uploaded'; return descriptor; },
    async release(expected) { if (JSON.stringify(job) !== JSON.stringify(expected)) throw new Error('MEDIA_CONFLICT'); job = undefined; },
    async acknowledge() { job = undefined; acknowledged++; },
    async cancel() { job = undefined; return { state: 'cancelled' }; },
  };
  const publisher = {
    async pending() { return pending; },
    async post(caption, media, operation) { posts.push({ caption, media, operation }); const id = operation ?? `op-${posts.length}`, body = encodeCircleMoment({ id, caption, media }); sends.push(body); pending = { operation: id, moment: decodeCircleMoment(body) }; if (failSend) throw new Error('NETWORK_UNCERTAIN'); pending = undefined; return body; },
    async retry() { counter++; if (failSend) throw new Error('NETWORK_UNCERTAIN'); const result = pending; pending = undefined; return result; },
  };
  return { editor: createCircleMomentEditor({ account, operation: () => `op-${++counter}`, context: async () => ({ ...context, epoch }), upload, publisher }, 'circle-a'), upload, publisher, get sends() { return sends; }, get posts() { return posts; }, get acknowledged() { return acknowledged; }, get job() { return job; }, set failSend(value) { failSend = value; } };
}

test('photo Moment encrypts and uploads for the current Circle epoch before publishing its descriptor', async () => {
  const f = fixture();
  await f.editor.postPhoto({ caption: 'A sunny day', bytes: new Uint8Array([1, 2]), mimeType: 'image/jpeg' });
  assert.deepEqual(f.posts, [{ caption: 'A sunny day', media: { epoch: 3, media: descriptor }, operation: 'op-1' }]);
  assert.equal(decodeCircleMoment(f.sends[0]).media.media.id, descriptor.id);
  assert.equal(f.acknowledged, 1);
});

test('failed or uncertain publishing preserves prepared media for exact retry', async () => {
  const f = fixture({ failSend: true });
  await assert.rejects(f.editor.postPhoto({ caption: 'Saved', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }), /NETWORK_UNCERTAIN/);
  assert.equal(f.acknowledged, 0);
  assert.equal(f.job.phase, 'uploaded');
  assert.equal((await f.editor.pending()).messagePending, true);
  f.failSend = false;
  await f.editor.retryPhoto();
  assert.equal(f.acknowledged, 1);
});

test('photo publishing rejects stale Circle epochs before uploading', async () => {
  const f = fixture({ epoch: 2 });
  await assert.rejects(f.editor.postPhoto({ caption: 'Stale', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }), /CONTEXT_MISMATCH/);
  assert.equal(f.job, undefined);
});

test('photo publishing fences an account change before it can publish', async () => {
  let calls = 0;
  const f = fixture({ account: () => ++calls < 3 ? 'account-a' : 'account-b' });
  await assert.rejects(f.editor.postPhoto({ caption: 'Account switch', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }), /SESSION_CHANGED/);
  assert.equal(f.posts.length, 0);
});

test('an unuploaded Moment photo draft can be discarded safely', async () => {
  const f = fixture({ failUpload: true });
  await assert.rejects(f.editor.postPhoto({ caption: 'Draft', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }), /NETWORK_UPLOAD/);
  assert.equal(typeof f.editor.discardPhoto, 'function', 'safe Moment photo discard is missing');
  await f.editor.discardPhoto();
  assert.equal(f.job, undefined);
});

test('uploaded or published Moment photos cannot be discarded while delivery is uncertain', async () => {
  const f = fixture({ failSend: true });
  await assert.rejects(f.editor.postPhoto({ caption: 'Draft', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }), /NETWORK_UNCERTAIN/);
  assert.equal(typeof f.editor.discardPhoto, 'function', 'safe Moment photo discard is missing');
  await assert.rejects(f.editor.discardPhoto(), /MOMENT_PHOTO_UPLOAD_UNCERTAIN/);
  assert.ok(f.job);
});
