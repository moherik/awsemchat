import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';
import { NativeCircleInvite } from '../src/features/social/circle-invite-screen';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() } }));
jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('../src/features/social/circle-creation-screen', () => ({ CreationButton: ({ label, action }: any) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label, onPress: action }, React.createElement(Text, null, label)); } }));
jest.mock('../src/features/social/private-profile-avatar', () => ({ PrivateProfileAvatar: ({ name }: any) => { const React = require('react'); const { Text } = require('react-native'); return React.createElement(Text, { accessibilityLabel: `Avatar of ${name}` }, name.charAt(0)); } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

test('Circle invitation rows show the latest friendship profile and keep its PIN visible', async () => {
  const friend = { accountId: 'friend-1', pin: 'NAYA47', status: 'accepted', requestId: 'request-1' };
  const inviteState = { phase: 'ready', busy: false, items: [friend], selected: [], search: '', details: { memberCount: 2 }, nextCursor: undefined };
  const account = { status: 'ready', account: { id: 'self' }, generation: 1 };
  const authState = { phase: 'ready', busy: false, phone: '' };
  const noop = () => () => undefined;
  const controller = { getSnapshot: () => inviteState, subscribe: noop, refresh: jest.fn(async () => undefined), visible: () => [friend], search: jest.fn(), toggle: jest.fn(), send: jest.fn(async () => undefined) };
  const runtime = {
    flow: { getSnapshot: () => authState, subscribe: noop },
    owner: { getSnapshot: () => account, subscribe: noop },
    circleInviteSelection: jest.fn(() => controller),
    privateProfileForFriend: jest.fn(async () => ({ state: 'ready', profile: { version: 1, revision: 3, name: 'Naya', status: 'Taking the scenic route' } })),
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeCircleInvite circleId="circle-1" />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(screen.getByText('PIN · NAYA47')).toBeTruthy();
  await waitFor(() => expect(runtime.privateProfileForFriend).toHaveBeenCalledWith('friend-1', 'request-1'));
});
