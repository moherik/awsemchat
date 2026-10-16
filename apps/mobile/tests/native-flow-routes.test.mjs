import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNativeFlow, nativeFlowUnavailableMessage } from '../src/features/native-flow-routes.ts';

test('native flow resolves every production route to its native screen', () => {
  const routes = {
    phone: 'authentication', verify: 'authentication', requests: 'friend-requests',
    'new-chat': 'new-conversation', profile: 'profile', settings: 'settings',
    appearance: 'appearance', media: 'shared-media', 'saved-circle-updates': 'saved-circle-updates',
    circles: 'circles', circle: 'circle-creation', members: 'circle-details',
    'invite-members': 'circle-invite', 'invite-friends': 'circle-invite',
    'circle-invitations': 'circle-invitations', conversation: 'conversation-details', 'group-stickers': 'group-stickers',
    stickers: 'personal-stickers', editor: 'sticker-maker',
    backup: 'backup', restore: 'backup', archived: 'archived-chats', pin: 'profile-home', music: 'now-playing',
    welcome: 'authentication', security: 'conversation-details', recovery: 'backup', privacy: 'privacy', report: 'conversation-report',
  };
  for (const [view, screen] of Object.entries(routes)) {
    assert.equal(resolveNativeFlow(view), screen, `${view} resolves to a native screen`);
  }
});

test('native flow refuses demo-only routes and unknown routes', () => {
  for (const view of ['']) {
    assert.equal(resolveNativeFlow(view), null, `${view || 'empty route'} is unavailable natively`);
  }
});

test('notifications opens the native device notification settings screen', () => {
  assert.equal(resolveNativeFlow('notifications'), 'notifications');
});

test('native unavailable routes explain their real production dependency', () => {
  assert.match(nativeFlowUnavailableMessage('music'), /Android notification access/);
});
