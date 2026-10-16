const nativeRoutes: Readonly<Record<string, string>> = Object.freeze({
  welcome: 'authentication',
  phone: 'authentication',
  verify: 'authentication',
  requests: 'friend-requests',
  'new-chat': 'new-conversation',
  profile: 'profile',
  settings: 'settings',
  privacy: 'privacy',
  music: 'now-playing',
  appearance: 'appearance',
  media: 'shared-media',
  'saved-circle-updates': 'saved-circle-updates',
  circles: 'circles',
  circle: 'circle-creation',
  members: 'circle-details',
  'invite-members': 'circle-invite',
  'invite-friends': 'circle-invite',
  'circle-invitations': 'circle-invitations',
  conversation: 'conversation-details',
  security: 'conversation-details',
  'group-stickers': 'group-stickers',
  report: 'conversation-report',
  stickers: 'personal-stickers',
  editor: 'sticker-maker',
  backup: 'backup',
  restore: 'backup',
  recovery: 'backup',
  archived: 'archived-chats',
  pin: 'profile-home',
  notifications: 'notifications',
});

const unavailableMessages: Readonly<Record<string, string>> = Object.freeze({
  music: "Now Playing needs Android notification access. AwsemChat won't read or share music until you choose to grant that permission and turn sharing on.",
});

export function resolveNativeFlow(view: string): string | null {
  return nativeRoutes[view] ?? null;
}

export function nativeFlowUnavailableMessage(view: string): string {
  return unavailableMessages[view] ?? 'This native feature is not connected yet.';
}
