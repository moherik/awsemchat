import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeChatList, NativeArchivedChats } from '../src/features/messages/native-chat-list';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { showFeedback } from '../src/features/feedback/snackbar';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/ui/community/menu', () => ({ MenuView: ({ children, shouldOpenOnLongPress, actions, onPressAction }: any) => {
  const React = require('react');
  const { Pressable, View } = require('react-native');
  return React.createElement(View, null,
    React.createElement(Pressable, { accessibilityLabel: 'Open chat actions', onLongPress: shouldOpenOnLongPress ? () => undefined : undefined, testActions: actions }, children),
    ...actions.map((action: any) => React.createElement(Pressable, { key: action.id, accessibilityRole: 'button', accessibilityLabel: `Select ${action.id} action`, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) }, React.createElement('Text', null, action.title))));
} }));
jest.mock('../src/features/social/circle-avatar-view', () => ({ CircleAvatarView: () => null }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));

const empty = { phase: 'ready', incoming: [], outgoing: [] };
const listeners = () => ({ subscribe: () => () => undefined });
function runtime() {
  const preferenceSnapshot = Object.freeze({ phase: 'ready', values: {} });
  const prefs = { ...listeners(), getSnapshot: () => preferenceSnapshot, set: jest.fn(async () => undefined) };
  const friendItems = Object.freeze([{ accountId: 'peer-1', pin: 'NAYA47', status: 'accepted', requestId: 'request-1' }]);
  const circleItems = Object.freeze([{ id: 'circle-1', memberCount: 4, role: 'admin' }]);
  const history = { ...listeners(), getSnapshot: () => empty, refresh: jest.fn(async () => undefined) };
  const friendSnapshot = Object.freeze({ lists: Object.freeze({ accepted: Object.freeze({ phase: 'ready', items: friendItems }) }) });
  const circleSnapshot = Object.freeze({ phase: 'ready', items: circleItems });
  const authSnapshot = Object.freeze({ phase: 'ready' });
  const friends = { ...listeners(), getSnapshot: () => friendSnapshot, refresh: jest.fn(async () => undefined) };
  const circles = { ...listeners(), getSnapshot: () => circleSnapshot, refresh: jest.fn(async () => undefined) };
  const flow = { ...listeners(), getSnapshot: () => authSnapshot };
  const ownerSnapshot = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self', pin: 'SELF1234' }), generation: 1 });
  const owner = { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined };
  return { runtime: { owner, friends, circles, history, flow, conversationPreferences: jest.fn(async () => prefs), syncMessages: jest.fn(async () => undefined), privateProfileForFriend: jest.fn(async () => ({ state: 'empty' })), privateProfilePhotoBytes: jest.fn(async () => new Uint8Array([1, 2, 3])) } as any, prefs };
}

test('native chat list uses accepted friends and Circles, with search and category filters', async () => {
  const setup = runtime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativeChatList />);
  expect(await screen.findByText('NAYA47')).toBeTruthy();
  expect(screen.getByText('Circle')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search conversations'), 'NAYA');
  expect(screen.getByText('NAYA47')).toBeTruthy();
  expect(screen.queryByText('Circle')).toBeNull();
  expect(setup.runtime.syncMessages).toHaveBeenCalled();
});

test('native chat list shows the newest accepted-friend profile and its encrypted avatar', async () => {
  const setup = runtime();
  const avatar = { version: 1, id: 'media-1', key: 'a'.repeat(64), mimeType: 'image/jpeg', size: 3 };
  setup.runtime.privateProfileForFriend = jest.fn(async () => ({ state: 'ready', profile: { version: 2, revision: 4, name: 'Naya', status: 'Taking the scenic route', avatar } }));
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativeChatList />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(await screen.findByLabelText('Profile photo of Naya')).toBeTruthy();
  expect(setup.runtime.privateProfilePhotoBytes).toHaveBeenCalledWith('peer-1', 'request-1', avatar);
});

test('long-press actions persist pin, mute, and archive preferences', async () => {
  const setup = runtime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativeChatList />);
  expect(await screen.findByText('NAYA47')).toBeTruthy();
  const menu = screen.getAllByLabelText('Open chat actions')[1];
  expect(menu).toBeTruthy();
  await fireEvent(menu, 'longPress');
  await fireEvent.press(screen.getAllByLabelText('Select pin action')[1]);
  await fireEvent.press(screen.getAllByLabelText('Select mute action')[1]);
  await fireEvent.press(screen.getAllByLabelText('Select archive action')[1]);
  await waitFor(() => {
    expect(setup.prefs.set).toHaveBeenCalledWith('private:peer-1', 'pinned', true);
    expect(setup.prefs.set).toHaveBeenCalledWith('private:peer-1', 'muted', true);
    expect(setup.prefs.set).toHaveBeenCalledWith('private:peer-1', 'archived', true);
    expect(showFeedback).toHaveBeenLastCalledWith('Chat archived.');
  });
});

test('archived page lists saved chats and unarchives from Settings', async () => {
  const setup = runtime();
  const archivedSnapshot = Object.freeze({ phase: 'ready', values: Object.freeze({ 'private:peer-1': Object.freeze({ archived: true }) }) });
  const prefs = { ...setup.prefs, getSnapshot: () => archivedSnapshot };
  setup.runtime.conversationPreferences.mockResolvedValue(prefs as any);
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativeArchivedChats />);
  expect(await screen.findByText('NAYA47')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Unarchive NAYA47'));
  await waitFor(() => expect(setup.prefs.set).toHaveBeenCalledWith('private:peer-1', 'archived', false));
  expect(router.push).not.toHaveBeenCalled();
});
