import test from 'node:test';
import assert from 'node:assert/strict';
const feedback = await import('../src/features/social/circle-creation-feedback.ts').catch(() => ({}));
test('invalid profile input points to fields rather than claiming saved recovery', () => {
  assert.equal(typeof feedback.creationFailure, 'function');
  assert.equal(feedback.creationFailure(new Error('INVALID_PROFILE'), false, true).kind, 'invalid-input');
});
test('a failed initial save never claims a recoverable creation exists', () => {
  assert.equal(typeof feedback.creationFailure, 'function');
  assert.equal(feedback.creationFailure(new Error('STORAGE'), false, true).kind, 'retry');
  assert.equal(feedback.creationFailure(new Error('NETWORK'), true, true).kind, 'resume');
});
test('unreadable recovery state does not invite starting a replacement Circle', () => {
  assert.equal(typeof feedback.creationFailure, 'function');
  assert.equal(feedback.creationFailure(new Error('VAULT_INVALID'), false, false).kind, 'unavailable');
});
