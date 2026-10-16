import test from 'node:test';
import assert from 'node:assert/strict';
import { createCircleMemberProfileFanout } from '../src/features/social/circle-member-profile-fanout.ts';

function setup(overrides = {}) {
  let binding = 'account/device/1';
  const sent = [], contexts = [], saved = [], audiences = new Map();
  const ports = {
    binding: () => binding,
    page: async () => ({ items: [{ id: 'circle-admin', role: 'admin' }, { id: 'circle-member', role: 'member' }] }),
    context: async circleId => { contexts.push(circleId); const audience = 'circle:2'; audiences.set(circleId, audience); return { conversation: circleId, audience, epoch: 2, recipients: [{ accountId: `peer-${circleId}` }] }; },
    outgoing: async () => saved,
    operation: (revision, circleId, audience) => `member-profile-${revision}-${circleId}-${audience}`,
    send: async draft => { sent.push(draft); saved.push({ conversation: draft.circleId, audience: audiences.get(draft.circleId), circle: draft.circleId, target: null, operation: draft.operation, contentType: draft.contentType, plaintext: draft.plaintext, status: 'sent' }); return { status: 'sent' }; },
    ...overrides,
  };
  return { fanout: createCircleMemberProfileFanout(ports), sent, contexts, saved, setBinding: value => { binding = value; } };
}

test('Circle member profile fanout sends to every current Circle role using Circle-only encrypted events', async () => {
  const value = setup();
  await value.fanout.run({ revision: 3, name: 'Naya', status: 'Taking the scenic route' });
  assert.deepEqual(value.contexts, ['circle-admin', 'circle-member']);
  assert.deepEqual(value.sent.map(({ circleId, expectedEpoch, operation, contentType, plaintext }) => [circleId, expectedEpoch, operation, contentType, JSON.parse(plaintext)]), [
    ['circle-admin', 2, 'member-profile-3-circle-admin-circle:2', 'circle-member-profile', { version: 1, revision: 3, name: 'Naya', status: 'Taking the scenic route' }],
    ['circle-member', 2, 'member-profile-3-circle-member-circle:2', 'circle-member-profile', { version: 1, revision: 3, name: 'Naya', status: 'Taking the scenic route' }],
  ]);
  assert.ok(value.sent.every(draft => draft.targetId === undefined));
});

test('Circle member status is not sent when there is no valid current profile or no other member', async () => {
  const value = setup({ context: async circleId => ({ conversation: circleId, audience: 'circle:2', recipients: [] }) });
  await value.fanout.run({ revision: 0, name: '', status: '' });
  await value.fanout.run({ revision: 1, name: 'Naya', status: '' });
  assert.deepEqual(value.sent, []);
});

test('Circle profile retry reuses the exact saved operation and a new Circle epoch publishes a fresh snapshot', async () => {
  const value = setup();
  await value.fanout.run({ revision: 3, name: 'Naya', status: 'Here' });
  value.sent.length = 0;
  value.saved.find(record => record.circle === 'circle-admin').status = 'queued';
  await value.fanout.run({ revision: 3, name: 'Naya', status: 'Here' });
  assert.equal(value.sent[0].operation, 'member-profile-3-circle-admin-circle:2');
  assert.equal(value.sent.length, 1);
});

test('Circle membership audience changes cannot reuse a previous epoch profile event', async () => {
  let epoch = 2;
  let value;
  value = setup({ context: async circleId => ({ conversation: circleId, audience: `circle:${epoch}`, epoch, recipients: [{ accountId: 'friend' }] }) });
  await value.fanout.run({ revision: 3, name: 'Naya', status: 'Here' });
  epoch = 4;
  await value.fanout.run({ revision: 3, name: 'Naya', status: 'Here' });
  assert.equal(value.sent.length, 4);
  assert.deepEqual(value.sent.map(item => item.expectedEpoch), [2, 2, 4, 4]);
});

test('account replacement during Circle profile fanout rejects the old run', async () => {
  let value;
  value = setup({ context: async circleId => { value.setBinding('account/device/2'); return { conversation: circleId, audience: 'circle:2', epoch: 2, recipients: [{ accountId: 'peer' }] }; } });
  await assert.rejects(value.fanout.run({ revision: 3, name: 'Naya', status: 'Here' }), /SESSION_CHANGED/);
  assert.deepEqual(value.sent, []);
});
