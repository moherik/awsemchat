import React from 'react';
import { Alert } from 'react-native';
import { expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeBlockedContacts, NativeFriends } from '../src/features/social/friends-screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/ui/community/menu', () => ({ MenuView: ({ children, actions, onPressAction }: any) => {
  const React = require('react');
  const { Pressable, View, Text } = require('react-native');
  return React.createElement(View, null,
    React.createElement(Pressable, { accessibilityLabel: 'Open friend actions', onLongPress: () => undefined }, children),
    ...actions.map((action: any) => React.createElement(Pressable, { key: action.id, accessibilityRole: 'button', accessibilityLabel: `Select ${action.id} action`, onPress: () => onPressAction({ nativeEvent: { event: action.id } }) }, React.createElement(Text, null, action.title))));
} }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));

const noop = () => () => undefined;
function makeRuntime(kind: 'accepted' | 'blocked', profile?: any, nextCursor = '', secondPage: any[] = []) {
  const items = [{ accountId: 'friend-1', pin: 'NAYA47', status: kind, requestId: 'request-1' }];
  const lists = { accepted: { phase: 'ready', items: kind === 'accepted' ? items : [], refreshing: false, ...(kind === 'accepted' && nextCursor ? { nextCursor } : {}) }, incoming: { phase: 'ready', items: [], refreshing: false }, outgoing: { phase: 'ready', items: [], refreshing: false }, blocked: { phase: 'ready', items: kind === 'blocked' ? items : [], refreshing: false } };
  let friendSnapshot = { lists, pinDraft: '', busy: false };
  const listeners = new Set<() => void>();
  const authSnapshot = { phase: 'ready', busy: false, phone: '' };
  const friends = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => friendSnapshot,
    refresh: jest.fn(async () => undefined),
    loadMore: jest.fn(async () => {
      if (!secondPage.length) return;
      friendSnapshot = { ...friendSnapshot, lists: { ...friendSnapshot.lists, accepted: { ...friendSnapshot.lists.accepted, items: [...friendSnapshot.lists.accepted.items, ...secondPage], nextCursor: undefined } } };
      for (const listener of listeners) listener();
    }),
    block: jest.fn(async () => undefined),
  };
  const flow = { subscribe: noop, getSnapshot: () => authSnapshot };
  const ownerSnapshot = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self' }), generation: 1 });
  const runtime = { owner: { getSnapshot: () => ownerSnapshot, subscribe: noop }, friends, flow,
    privateProfileForFriend: jest.fn(async () => profile ?? { state: 'empty' }), privateProfilePhotoBytes: jest.fn(async () => new Uint8Array([1, 2, 3])) } as any;
  return { friends, flow, runtime };
}

test('accepted friend actions explain blocking and block only after explicit confirmation', async () => {
  const value = makeRuntime('accepted');
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  let confirm: (() => void) | undefined;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    confirm = buttons?.find(button => button.style === 'destructive')?.onPress;
  });
  try {
    await render(<NativeFriends />);
    expect(await screen.findByText('NAYA47')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Select block action'));
    expect(alert).toHaveBeenCalledWith('Block NAYA47?', expect.stringContaining('Shared Circle membership stays unchanged.'), expect.any(Array));
    expect(value.friends.block).not.toHaveBeenCalled();
    await act(async () => confirm?.());
    await waitFor(() => expect(value.friends.block).toHaveBeenCalledWith('friend-1', true));
  } finally { alert.mockRestore(); }
});

test('Friends links to the blocked contacts list', async () => {
  const value = makeRuntime('accepted');
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  await render(<NativeFriends />);
  await fireEvent.press(await screen.findByText('Blocked contacts'));
  expect(router.push).toHaveBeenCalledWith('/blocked');
});

test('accepted Friends show the current encrypted profile name, status, and friendship-scoped avatar', async () => {
  const avatar = { version: 1, id: 'media-1', key: 'a'.repeat(64), mimeType: 'image/jpeg', size: 3 };
  const value = makeRuntime('accepted', { state: 'ready', profile: { version: 2, revision: 4, name: 'Naya', status: 'Taking the scenic route', avatar } });
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  await render(<NativeFriends />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(await screen.findByLabelText('Profile photo of Naya')).toBeTruthy();
  expect(value.runtime.privateProfilePhotoBytes).toHaveBeenCalledWith('friend-1', 'request-1', avatar);
});

test('friend PIN search automatically includes accepted contacts on later pages', async () => {
  const value = makeRuntime('accepted', undefined, 'page-2', [
    { accountId: 'friend-2', pin: 'LIA77', status: 'accepted', requestId: 'request-2' },
  ]);
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  await render(<NativeFriends />);
  await screen.findByText('NAYA47');
  await fireEvent.changeText(screen.getByLabelText('Search friends'), 'LIA');
  expect(await screen.findByText('LIA77')).toBeTruthy();
  expect(value.friends.loadMore).toHaveBeenCalled();
});

test('accepted friend search matches the decrypted profile name', async () => {
  const value = makeRuntime('accepted', { state: 'ready', profile: { version: 2, revision: 4, name: 'Naya Putri', status: 'Taking the scenic route' } });
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  await render(<NativeFriends />);
  await screen.findByText('Naya Putri');
  await fireEvent.changeText(screen.getByLabelText('Search friends'), 'Putri');
  expect(screen.getByText('Naya Putri')).toBeTruthy();
  expect(screen.queryByText('NAYA47')).toBeNull();
  await fireEvent.changeText(screen.getByLabelText('Search friends'), 'scenic');
  expect(screen.getByText('Naya Putri')).toBeTruthy();
});

test('blocked contacts can be unblocked without restoring friendship', async () => {
  const value = makeRuntime('blocked');
  jest.mocked(authenticationRuntime).mockResolvedValue(value.runtime);
  await render(<NativeBlockedContacts />);
  expect(await screen.findByText('NAYA47')).toBeTruthy();
  expect(value.friends.refresh).toHaveBeenCalledWith('blocked');
  await fireEvent.press(screen.getByLabelText('Unblock NAYA47'));
  await waitFor(() => expect(value.friends.block).toHaveBeenCalledWith('friend-1', false));
});

