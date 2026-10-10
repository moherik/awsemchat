import test from 'node:test';
import assert from 'node:assert/strict';
import { showFeedback, dismissFeedback, feedbackStore, registerFeedbackSurface } from '../src/features/feedback/store.ts';
test('finishing an earlier operation cannot dismiss newer feedback', () => {
  const first = showFeedback('Opening photos', 0);
  const second = showFeedback('Could not open photos', 0);
  dismissFeedback(first);
  assert.equal(feedbackStore.getSnapshot().feedback.id, second);
  dismissFeedback(second);
  assert.equal(feedbackStore.getSnapshot().feedback, null);
});
test('feedback follows the frontmost sheet and returns to the screen when it closes', () => {
  const closeFirst = registerFeedbackSurface('picker');
  const closeSecond = registerFeedbackSurface('save');
  showFeedback('Saved', 0);
  assert.equal(feedbackStore.getSnapshot().surface, 'save');
  closeSecond(); assert.equal(feedbackStore.getSnapshot().surface, 'picker');
  closeFirst(); assert.equal(feedbackStore.getSnapshot().surface, 'root');
  assert.equal(feedbackStore.getSnapshot().feedback.message, 'Saved');
  dismissFeedback();
});
test('temporary feedback dismisses automatically', async () => {
  showFeedback('Crop applied', 15);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(feedbackStore.getSnapshot().feedback, null);
});
