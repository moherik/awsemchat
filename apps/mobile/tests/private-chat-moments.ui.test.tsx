import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { ReadyChat } from '../src/features/messages/screen';
import { encodePrivateMoment, encodePrivateMomentReply } from '../src/features/messages/private-moments';
import { encodePing, encodePong } from '../src/features/messages/ping-pong';
import { encodeCircleMemberProfile } from '../src/features/social/circle-member-profile';
import { encodePrivateProfile } from '../src/features/social/private-profile';
import { showFeedback } from '../src/features/feedback/snackbar';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('../src/features/giphy/favorites.native', () => ({ gifFavorites: { list: async () => [], toggle: async () => [] } }));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => React.forwardRef((props: Record<string, unknown>, ref: unknown) => React.createElement(name, { ...props, ref }, props.children));
  const View = host('View');
  const Text = host('Text');
  const Pressable = host('Pressable');
  const TextInput = host('TextInput');
  return {
    ActivityIndicator: host('ActivityIndicator'), Alert: { alert: jest.fn() },
    FlatList: React.forwardRef(({ data, renderItem, ListEmptyComponent, ListHeaderComponent, ListFooterComponent, ...props }: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: jest.fn() }));
      return React.createElement('FlatList', props, ListHeaderComponent, data.length ? data.map((item: unknown, index: number) => React.createElement(React.Fragment, { key: index }, renderItem({ item, index }))) : ListEmptyComponent, ListFooterComponent);
    }),
    Image: host('Image'), KeyboardAvoidingView: host('KeyboardAvoidingView'), Modal: ({ visible, children }: any) => visible ? children : null,
    Platform: { OS: 'android' }, Pressable, Text, TextInput, View, StyleSheet: { flatten: (style: unknown) => style },
  };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/scrolling-status', () => ({ ScrollingStatus: ({ text }: { text: string }) => require('react').createElement('Text', null, text) }));
jest.mock('../src/features/messages/identity-panel', () => ({ IdentityPanel: () => null }));
jest.mock('../src/features/popup-menu', () => ({ PopupMenu: ({ label, actions, children }: any) => {
  const React = require('react'); const { Alert, Pressable } = require('react-native');
  return React.createElement(Pressable, { onLongPress: () => Alert.alert(label, undefined, actions.map((action: any) => ({ text: action.label, onPress: action.onPress }))) }, children);
} }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('../src/features/photos/viewer', () => ({ PhotoViewer: () => null }));
jest.mock('../src/features/photos/editor', () => ({ PhotoEditor: () => null }));
jest.mock('../src/features/social/circle-avatar-view', () => ({ CircleAvatarView: () => null }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => false, replace: jest.fn(), back: jest.fn(), push: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-operation' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn(() => ({ resize: jest.fn(), renderAsync: async () => ({ saveAsync: async () => ({ base64: 'AQ==', uri: 'file://prepared.jpg', width: 320, height: 240 }) }) })) }, SaveFormat: { JPEG: 'jpeg', PNG: 'png' }, FlipType: { Horizontal: 'horizontal' } }));
jest.mock('expo-file-system', () => ({ File: class { exists = false; delete() {} } }));

const conversation = `private:${'a'.repeat(64)}`;
const audience = 'friend:request-1';

test('private chat header combines the latest friend status and active song in one line', async () => {
  const now = Date.now();
  const runtime = makeRuntime({ incoming: [
    { conversation, audience, contentType: 'private-profile', direction: 'incoming', sequence: 1, plaintext: encodePrivateProfile({ revision: 1, name: 'Naya', status: 'Taking the scenic route' }) },
    { conversation, audience, contentType: 'now-playing', direction: 'incoming', sequence: 2, plaintext: JSON.stringify({ version: 1, state: 'playing', title: 'Sunset Lover', artist: 'Petit Biscuit', updatedAt: now, expiresAt: now + 15 * 60_000 }) },
  ], outgoing: [] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(await screen.findByText('Taking the scenic route · ♫ Sunset Lover · Petit Biscuit')).toBeTruthy();
});
function makeRuntime(history = { incoming: [], outgoing: [] }, options: { context?: any; circleMembers?: any[] } = {}) {
  const ownerSnapshot = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self' }), generation: 1 });
  const friendsSnapshot = { lists: { accepted: { items: [{ accountId: 'friend', pin: 'NAYA47', requestId: 'request-1', status: 'accepted' }] } } };
  const context = options.context ?? { conversation, audience, sender: { identity: 'self', signingIdentity: 'self-sign' }, recipients: [{ accountId: 'friend', generation: 1, keys: { identity: 'peer', signingIdentity: 'peer-sign' } }] };
  const photoEditor = { pending: jest.fn(async () => undefined), sendPhoto: jest.fn(async () => ({ id: 'event-1', operation: 'photo-operation', status: 'sent' })), sendSticker: jest.fn(async () => ({ id: 'event-1', operation: 'sticker-operation', status: 'sent' })), retry: jest.fn(async () => ({ id: 'event-1', operation: 'photo-operation', status: 'sent' })), discard: jest.fn(async () => ({ state: 'cancelled' })), download: jest.fn(async () => new Uint8Array([1])) };
  const moments = { post: jest.fn(async () => ({ id: 'moment-event', operation: 'moment-operation', status: 'sent' })), postPhoto: jest.fn(async () => ({ id: 'photo-moment-event', operation: 'photo-moment-operation', status: 'sent' })), promote: jest.fn(async () => ({})), react: jest.fn(async () => ({})), reply: jest.fn(async () => ({})), remove: jest.fn(async () => ({})), retry: jest.fn(async () => ({})) };
  let historySnapshot = history;
  const historyListeners = new Set<() => void>();
  let preferenceSnapshot = { phase: 'ready', values: {} as Record<string, Record<string, boolean>> };
  const preferenceListeners = new Set<() => void>();
  const preferenceStore = {
    subscribe: (listener: () => void) => { preferenceListeners.add(listener); return () => preferenceListeners.delete(listener); },
    getSnapshot: () => preferenceSnapshot,
    set: jest.fn(async (key: string, field: string, enabled: boolean) => {
      const next = { ...preferenceSnapshot.values };
      const settings = { ...(next[key] ?? {}) };
      if (enabled) settings[field] = true; else delete settings[field];
      if (Object.keys(settings).length) next[key] = settings; else delete next[key];
      preferenceSnapshot = { phase: 'ready', values: next };
      preferenceListeners.forEach(listener => listener());
    }),
  };
  return {
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => {} },
    history: { subscribe: (listener: () => void) => { historyListeners.add(listener); return () => historyListeners.delete(listener); }, getSnapshot: () => historySnapshot, refresh: jest.fn(async () => {}), replace: (value: typeof history) => { historySnapshot = value; historyListeners.forEach(listener => listener()); }, history },
    messageDeletion: { delete: jest.fn(async () => {}), retry: jest.fn(async () => {}) },
    messages: { context: jest.fn(async () => context) },
    social: { circle: jest.fn(async () => ({ members: options.circleMembers ?? [] })) },
    conversationPreferences: jest.fn(async () => preferenceStore), preferenceStore,
    friends: { subscribe: () => () => {}, getSnapshot: () => friendsSnapshot }, privateProfilePhotoBytes: jest.fn(async () => new Uint8Array([1, 2, 3])),
    sender: { send: jest.fn(async () => ({ id: 'chat-event', operation: 'chat-operation', status: 'sent' })) },
    privateMomentPublisher: jest.fn(() => moments), privateMomentEditor: jest.fn(async () => ({ ...moments, pending: jest.fn(async () => undefined), download: jest.fn(async () => new Uint8Array([1])) })),
    privatePhotoEditor: jest.fn(async () => photoEditor), circleMomentPublisher: jest.fn(() => moments),
    circleMomentEditor: jest.fn(async () => ({ ...moments, pending: jest.fn(async () => undefined) })),
    circlePhotoEditor: jest.fn(async () => photoEditor), circleStickerSender: jest.fn(async () => ({ ...photoEditor, pending: jest.fn(async () => undefined) })),
    personalStickers: jest.fn(async () => ({ list: async () => [{ id: 'personal-one', artwork: { image: 'data:image/png;base64,AQID', title: 'Tiny wave' } }] })),
    circleCollection: jest.fn(async () => ({ state: 'ready', items: [] })), circleAvatarBytes: jest.fn(async () => new Uint8Array([1])),
    historyData: history, contextData: context, photoEditor, moments,
  } as any;
}

test('long-pressing your own message offers Delete for everyone and confirms before calling the coordinator', async () => {
  const record = { conversation, audience, operation: 'own-message', plaintext: 'Made it home', status: 'sent', event: 'server-event', serverEventId: 'server-event', target: 'friend', circle: null, createdAt: 1 };
  const runtime = makeRuntime({ incoming: [], outgoing: [record] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent(screen.getByText('Made it home'), 'longPress');
  const options = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { options.find(button => button.text === 'Delete for everyone')?.onPress?.(); });
  const confirmation = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await confirmation.find(button => button.text === 'Delete for everyone')?.onPress?.(); });
  await waitFor(() => expect(runtime.messageDeletion.delete).toHaveBeenCalledWith({ eventId: 'server-event' }));
  expect(showFeedback).toHaveBeenCalledWith('Message deleted for everyone.');
});

test('private chat sends a PING as a typed encrypted message to that friend', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Send PING to friend'));
  await waitFor(() => expect(runtime.sender.send).toHaveBeenCalledWith({ targetId: 'friend', operation: 'test-operation', contentType: 'ping', plaintext: encodePing() }));
});

test('Circle bubbles show the sender’s current encrypted name and status, including for a nonfriend member', async () => {
  const circle = 'circle-1', sender = { identity: 'circle-member-key', signingIdentity: 'circle-member-signature' };
  const circleHistory = { incoming: [
    { conversation: circle, audience: 'circle:2', contentType: 'circle-member-profile', direction: 'incoming', sequence: 1, operation: 'member-profile', sender, plaintext: encodeCircleMemberProfile({ revision: 2, name: 'Naya', status: 'Taking the scenic route' }) },
    { conversation: circle, audience: 'circle:2', contentType: 'text', direction: 'incoming', sequence: 2, operation: 'circle-chat', sender, plaintext: 'Hello from Circle' },
    { conversation: circle, audience: 'circle:2', contentType: 'now-playing', direction: 'incoming', sequence: 3, operation: 'circle-music', sender, plaintext: JSON.stringify({ version: 1, state: 'playing', title: 'Circle leak', artist: 'Test', updatedAt: Date.now(), expiresAt: Date.now() + 60_000 }) },
  ], outgoing: [] };
  const runtime = makeRuntime(circleHistory as any, {
    context: { conversation: circle, audience: 'circle:2', circleId: circle, epoch: 2, sender: { identity: 'self', signingIdentity: 'self-sign' }, recipients: [{ accountId: 'member-account', generation: 1, keys: sender }] },
    circleMembers: [{ accountId: 'member-account', pin: 'NAYA47', role: 'member', intervalId: 'interval-1', joinedEpoch: 1 }],
  });
  await render(<ReadyChat runtime={runtime} circle={circle} />);
  expect(await screen.findByText('Hello from Circle')).toBeTruthy();
  expect(screen.getByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(screen.queryByText(/Circle leak/)).toBeNull();
});

test('a PING with an uncertain send retries the same encrypted operation', async () => {
  const runtime = makeRuntime();
  runtime.sender.send.mockRejectedValueOnce(new Error('NETWORK'));
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Send PING to friend'));
  await fireEvent.press(await screen.findByLabelText('Retry PING to friend'));
  await waitFor(() => expect(runtime.sender.send).toHaveBeenCalledTimes(2));
  expect(runtime.sender.send.mock.calls[0][0]).toEqual(runtime.sender.send.mock.calls[1][0]);
  expect(runtime.sender.send.mock.calls[0][0]).toEqual({ targetId: 'friend', operation: 'test-operation', contentType: 'ping', plaintext: encodePing() });
});

test('an incoming private PING offers an explicit PONG linked to that PING', async () => {
  const runtime = makeRuntime({ incoming: [{ conversation, audience, operation: 'their-ping', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend', signingIdentity: 'friend-sign' }, sequence: 1 }], outgoing: [] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(runtime.sender.send).not.toHaveBeenCalled();
  await fireEvent.press(await screen.findByLabelText('Reply PONG'));
  await waitFor(() => expect(runtime.sender.send).toHaveBeenCalledWith({ targetId: 'friend', operation: 'test-operation', contentType: 'pong', plaintext: encodePong('their-ping') }));
  expect(showFeedback).not.toHaveBeenCalledWith('PING! A friend sent you a nudge.', 3500);
});

test('an uncertain PONG can be retried with the same operation and original PING reference', async () => {
  const runtime = makeRuntime({ incoming: [{ conversation, audience, operation: 'their-ping', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend', signingIdentity: 'friend-sign' }, sequence: 1 }], outgoing: [] } as any);
  runtime.sender.send.mockRejectedValueOnce(new Error('NETWORK'));
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Reply PONG'));
  await fireEvent.press(await screen.findByLabelText('Retry PONG'));
  await waitFor(() => expect(runtime.sender.send).toHaveBeenCalledTimes(2));
  expect(runtime.sender.send.mock.calls[0][0]).toEqual(runtime.sender.send.mock.calls[1][0]);
  expect(runtime.sender.send.mock.calls[0][0]).toEqual({ targetId: 'friend', operation: 'test-operation', contentType: 'pong', plaintext: encodePong('their-ping') });
});

test('a newly arriving PING shows one in-app alert and does not alert for history already present on open', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  jest.mocked(showFeedback).mockClear();
  await act(async () => runtime.history.replace({ incoming: [
    { conversation, audience, operation: 'new-ping-one', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend' }, sequence: 1 },
    { conversation, audience, operation: 'new-ping-two', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend' }, sequence: 2 },
  ], outgoing: [] } as any));
  await waitFor(() => expect(showFeedback).toHaveBeenCalledTimes(1));
  expect(showFeedback).toHaveBeenCalledWith('PING! A friend sent you a nudge.', 3500);
  const oldRuntime = makeRuntime({ incoming: [{ conversation, audience, operation: 'old-ping', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend' }, sequence: 1 }], outgoing: [] } as any);
  jest.mocked(showFeedback).mockClear();
  await render(<ReadyChat runtime={oldRuntime} peer="friend" />);
  await screen.findByText('PING!');
  expect(showFeedback).not.toHaveBeenCalledWith('PING! A friend sent you a nudge.', 3500);
});

test('muting PING alerts keeps incoming PING messages visible without showing the alert', async () => {
  const runtime = makeRuntime();
  await runtime.preferenceStore.set(conversation, 'pingMuted', true);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  jest.mocked(showFeedback).mockClear();
  await act(async () => runtime.history.replace({ incoming: [{ conversation, audience, operation: 'muted-ping', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend' }, sequence: 1 }], outgoing: [] } as any));
  expect(await screen.findByText('PING!')).toBeTruthy();
  expect(showFeedback).not.toHaveBeenCalledWith('PING! A friend sent you a nudge.', 3500);
});

test('Circle chat does not offer PING or PONG controls', async () => {
  const runtime = makeRuntime({ incoming: [{ conversation: 'family', audience: 'circle:2', operation: 'circle-ping', plaintext: encodePing(), contentType: 'ping', sender: { identity: 'friend', signingIdentity: 'friend-sign' }, sequence: 1 }], outgoing: [] } as any);
  runtime.messages.context.mockResolvedValue({ ...runtime.contextData, conversation: 'family', audience: 'circle:2', epoch: 2 });
  await render(<ReadyChat runtime={runtime} circle="family" />);
  await screen.findByText('Chat');
  expect(screen.queryByLabelText('Send PING to friend')).toBeNull();
  expect(screen.queryByLabelText('Reply PONG')).toBeNull();
});

test('private chat has a separate control for muting PING alerts', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Mute PING alerts'));
  await waitFor(() => expect(runtime.preferenceStore.set).toHaveBeenCalledWith(conversation, 'pingMuted', true));
  expect(await screen.findByLabelText('Unmute PING alerts')).toBeTruthy();
});

test('private chat profile header opens native conversation details', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Open conversation details'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'conversation', peer: 'friend' } });
});

test('private chat header uses the latest profile from this accepted friendship only', async () => {
  const profile = { version: 1, revision: 3, name: 'Naya', status: 'Taking the scenic route' };
  const record = { conversation, audience, operation: 'profile-3', plaintext: JSON.stringify(profile), contentType: 'private-profile', sequence: 3, sender: { identity: 'peer', signingIdentity: 'peer-sign' } };
  const runtime = makeRuntime({ incoming: [record], outgoing: [] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(screen.queryByText('NAYA47')).toBeNull();
});

test('private chat header decrypts and shows the latest friendship profile photo', async () => {
  const avatar = { version: 1, id: 'media-1', key: 'a'.repeat(64), mimeType: 'image/jpeg', size: 3 };
  const profile = { version: 2, revision: 4, name: 'Naya', status: 'Taking the scenic route', avatar };
  const record = { conversation, audience, operation: 'profile-4', plaintext: JSON.stringify(profile), contentType: 'private-profile', sequence: 4, sender: { identity: 'peer', signingIdentity: 'peer-sign' } };
  const runtime = makeRuntime({ incoming: [record], outgoing: [] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(await screen.findByLabelText('Profile photo of Naya')).toBeTruthy();
  expect(runtime.privateProfilePhotoBytes).toHaveBeenCalledWith('friend', 'request-1', avatar);
});

test.each(['admin', 'member'] as const)('Circle %s cannot delete another author’s message', async role => {
  const incoming = { conversation: 'family', audience: 'circle:2', operation: 'friend-message', plaintext: 'See everyone soon', sender: { identity: 'friend', signingIdentity: 'friend-sign' }, serverEventId: 'friend-event', sequence: 1 };
  const runtime = makeRuntime({ incoming: [incoming], outgoing: [] } as any);
  runtime.messages.context.mockResolvedValue({ ...runtime.contextData, conversation: 'family', audience: 'circle:2', epoch: 2 });
  runtime.social.circle.mockResolvedValue({ members: [{ accountId: 'self', role, pin: 'SELF1234' }] });
  await render(<ReadyChat runtime={runtime} circle="family" />);
  await fireEvent(await screen.findByText('See everyone soon'), 'longPress');
  expect(Alert.alert).not.toHaveBeenCalledWith('Delete for everyone?', expect.anything(), expect.anything());
  expect(runtime.messageDeletion.delete).not.toHaveBeenCalled();
});

test('Circle Chat lets an author delete their own message for the original participants', async () => {
  const own = { conversation: 'family', audience: 'circle:2', operation: 'circle-own-message', plaintext: 'Dinner was lovely', status: 'sent', event: 'circle-event', serverEventId: 'circle-event', target: null, circle: 'family', createdAt: 1 };
  const runtime = makeRuntime({ incoming: [], outgoing: [own] } as any);
  runtime.messages.context.mockResolvedValue({ ...runtime.contextData, conversation: 'family', audience: 'circle:2', epoch: 2 });
  await render(<ReadyChat runtime={runtime} circle="family" />);
  await fireEvent(await screen.findByText('Dinner was lovely'), 'longPress');
  const options = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { options.find(button => button.text === 'Delete for everyone')?.onPress?.(); });
  const confirmation = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await confirmation.find(button => button.text === 'Delete for everyone')?.onPress?.(); });
  await waitFor(() => expect(runtime.messageDeletion.delete).toHaveBeenCalledWith({ eventId: 'circle-event' }));
  expect(showFeedback).toHaveBeenCalledWith('Message deleted for everyone.');
});

test('multi-select offers only the author’s messages and labels an offline deletion as pending', async () => {
  const own = { conversation, audience, operation: 'own-message', plaintext: 'My update', status: 'sent', event: 'server-event', serverEventId: 'server-event', target: 'friend', circle: null, createdAt: 1 };
  const incoming = { conversation, audience, operation: 'friend-message', plaintext: 'Their update', sender: { identity: 'friend', signingIdentity: 'friend-sign' }, serverEventId: 'friend-event', sequence: 2 };
  const runtime = makeRuntime({ incoming: [incoming], outgoing: [own] } as any);
  runtime.messageDeletion.delete.mockRejectedValue(Object.assign(new Error('DELETION_PENDING'), { code: 'DELETION_PENDING' }));
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent(await screen.findByText('My update'), 'longPress');
  const options = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { options.find(button => button.text === 'Select messages')?.onPress?.(); });
  expect(screen.getByText('1 selected')).toBeTruthy();
  expect(screen.queryByLabelText('Select message: Their update')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Delete selected messages for everyone'));
  const confirmation = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await confirmation.find(button => button.text === 'Delete for everyone')?.onPress?.(); });
  await waitFor(() => expect(screen.getByText(/Deletion pending/)).toBeTruthy());
  expect(showFeedback).toHaveBeenCalledWith('Delete request saved. It will finish when you are back online.');
});

test('private conversation renders Chat and Moments tabs and opens the private Moment composer', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(await screen.findByText('Chat')).toBeTruthy();
  expect(screen.getByPlaceholderText('Message')).toBeTruthy();
  await fireEvent.press(screen.getByText('Moments'));
  expect(await screen.findByText('Share a Moment with NAYA47')).toBeTruthy();
  expect(screen.getByText('No Moments yet. Save something just for the two of you.')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('A little moment worth keeping…'), 'Sunday pancakes');
  await fireEvent.press(screen.getByText('Share Moment'));
  await waitFor(() => expect(runtime.moments.post).toHaveBeenCalledWith('Sunday pancakes'));
});

test('private chat sends an encrypted sticker from the personal library', async () => {
  const runtime = makeRuntime();
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(await screen.findByLabelText('Open personal stickers'));
  await fireEvent.press(await screen.findByLabelText('Send personal sticker Tiny wave'));
  await waitFor(() => expect(runtime.photoEditor.sendSticker).toHaveBeenCalledWith({ image: 'data:image/png;base64,AQID', label: 'Tiny wave' }));
});

test('private Moment photo shows a local preview before encrypted sharing', async () => {
  const runtime = makeRuntime();
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://local.jpg', width: 640, height: 480 }] } as never);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(screen.getByText('Moments'));
  await fireEvent.press(screen.getByLabelText('Add a photo to Moment'));
  expect(await screen.findByLabelText('Selected Moment photo preview')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('A little moment worth keeping…'), 'Garden afternoon');
  await fireEvent.press(screen.getByText('Share Moment'));
  await waitFor(() => expect(runtime.moments.postPhoto).toHaveBeenCalledWith({ caption: 'Garden afternoon', bytes: new Uint8Array([1]), mimeType: 'image/jpeg' }));
});

test('failed private Moment photo offers exact retry from its saved draft', async () => {
  const runtime = makeRuntime();
  const editor = { ...runtime.moments, pending: jest.fn(async (): Promise<any> => undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue({ prepared: true }), retry: jest.fn(async () => ({ id: 'retried', operation: 'photo-moment-operation', status: 'sent' })) };
  editor.postPhoto.mockRejectedValueOnce(new Error('NETWORK'));
  runtime.privateMomentEditor.mockResolvedValue(editor as any);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://local.jpg', width: 640, height: 480 }] } as never);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(screen.getByText('Moments'));
  await fireEvent.press(screen.getByLabelText('Add a photo to Moment'));
  await screen.findByLabelText('Selected Moment photo preview');
  await fireEvent.press(screen.getByText('Share Moment'));
  await fireEvent.press(await screen.findByText('Retry photo'));
  await waitFor(() => expect(editor.retry).toHaveBeenCalledTimes(1));
});

test('saved private Moment photo discard requires explicit confirmation', async () => {
  const runtime = makeRuntime();
  const editor = { ...runtime.moments, pending: jest.fn(async (): Promise<any> => undefined).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockResolvedValue({ prepared: true }), discard: jest.fn(async () => ({ state: 'cancelled' })) };
  editor.postPhoto.mockRejectedValueOnce(new Error('NETWORK'));
  runtime.privateMomentEditor.mockResolvedValue(editor as any);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://local.jpg', width: 640, height: 480 }] } as never);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(screen.getByText('Moments'));
  await fireEvent.press(screen.getByLabelText('Add a photo to Moment'));
  await screen.findByLabelText('Selected Moment photo preview');
  await fireEvent.press(screen.getByText('Share Moment'));
  await fireEvent.press(await screen.findByText('Discard'));
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await buttons.find(button => button.text === 'Discard')?.onPress?.(); });
  await waitFor(() => expect(editor.discard).toHaveBeenCalledTimes(1));
});

test('Moment reactions and replies stay on the private Moment and reply in Chat embeds it', async () => {
  const moment = { id: 'saved-moment', audience, caption: 'Sunday pancakes' };
  const record = { conversation, audience, operation: moment.id, plaintext: encodePrivateMoment(moment), direction: 'outgoing', sender: { identity: 'self' }, sequence: 1, status: 'delivered', event: 'event-moment' };
  const reply = { conversation, audience, operation: 'reply-event', plaintext: encodePrivateMomentReply({ id: 'reply-event', audience, text: 'Pancakes saved', moment }), direction: 'outgoing', sender: { identity: 'self' }, sequence: 2, status: 'delivered', event: 'event-reply' };
  const runtime = makeRuntime({ incoming: [], outgoing: [record, reply] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  expect(screen.queryByLabelText('Delete Moment')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Open Moment: Sunday pancakes'));
  expect(await screen.findByText('Sunday pancakes')).toBeTruthy();
  await fireEvent.press(screen.getByText('Chat'));
  await fireEvent.press(screen.getByText('Moments'));
  expect(await screen.findByText('Sunday pancakes')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Add ❤️ reaction'));
  await waitFor(() => expect(runtime.moments.react).toHaveBeenCalledWith('saved-moment', '❤️'));
  await fireEvent.press(screen.getByLabelText('Reply to Moment in Chat'));
  expect(screen.getByText('Replying to a Moment')).toBeTruthy();
  expect(screen.getByPlaceholderText('Write a reply…')).toBeTruthy();
  await fireEvent.changeText(screen.getByPlaceholderText('Write a reply…'), 'Save me a pancake');
  await fireEvent.press(screen.getByLabelText('Send message'));
  await waitFor(() => expect(runtime.moments.reply).toHaveBeenCalledWith('saved-moment', 'Save me a pancake'));
});

test('only the Moment delete confirmation invokes its author delete action', async () => {
  const moment = { id: 'mine', audience, caption: 'Mine to keep' };
  const record = { conversation, audience, operation: moment.id, plaintext: encodePrivateMoment(moment), direction: 'outgoing', sender: { identity: 'self' }, sequence: 1, status: 'delivered', event: 'event-mine' };
  const runtime = makeRuntime({ incoming: [], outgoing: [record] } as any);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  await fireEvent.press(screen.getByText('Moments'));
  await fireEvent.press(screen.getByLabelText('Delete Moment'));
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { await buttons.find(button => button.text === 'Delete')?.onPress?.(); });
  await waitFor(() => expect(runtime.moments.remove).toHaveBeenCalledWith('mine'));
});

test('chat history retries a failed earlier-page fetch and reaches the end', async () => {
  const pager = { load: jest.fn<(conversation: string, audience: string) => Promise<{ more: boolean; cursor?: string }>>().mockRejectedValueOnce(new Error('NETWORK')).mockResolvedValueOnce({ more: false }) };
  const runtime = makeRuntime() as any;
  runtime.historyPager = jest.fn(() => pager);
  await render(<ReadyChat runtime={runtime} peer="friend" />);
  const button = await screen.findByLabelText('Retry loading earlier messages');
  expect(pager.load).toHaveBeenCalledWith(conversation, audience);
  await fireEvent.press(button);
  await waitFor(() => expect(pager.load).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('Your conversation starts here.')).toBeTruthy();
  expect(screen.queryByLabelText('Load earlier messages')).toBeNull();
});
