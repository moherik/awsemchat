import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeCircleDetails } from '../src/features/social/circle-details-screen';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn(), push: jest.fn() } }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('../src/features/social/circle-creation-screen', () => ({ CreationButton: ({ label, action }: any) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label, onPress: action }, React.createElement(Text, null, label)); } }));
jest.mock('../src/features/social/circle-avatar-view', () => ({ CircleAvatarView: () => null }));
jest.mock('../src/features/social/circle-avatar-controls', () => ({ CircleAvatarControls: () => null }));
jest.mock('../src/features/social/circle-membership-screen', () => ({ CircleMembershipActions: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

test('Circle details mute action saves the existing Circle notification preference', async () => {
  const empty = () => () => undefined;
  const authState = { phase: 'ready', busy: false, phone: '' };
  const account = { status: 'ready', account: { id: 'self' }, generation: 1 };
  const detailsState = {
    details: { memberCount: 3, members: [{ accountId: 'self', role: 'admin' }] },
    profile: { state: 'ready', revision: 1, profile: { name: 'Family', description: 'Us', avatar: null } },
    canEdit: true,
    busy: false,
    pending: null,
  };
  const details = { getSnapshot: () => detailsState, subscribe: empty(), refresh: jest.fn(async () => undefined), update: jest.fn(async () => undefined), retry: jest.fn(), recover: jest.fn() };
  const preferencesState = { phase: 'ready', values: {} };
  const preferences = { getSnapshot: () => preferencesState, subscribe: empty(), set: jest.fn(async () => undefined) };
  const runtime = {
    flow: { getSnapshot: () => authState, subscribe: empty() },
    owner: { getSnapshot: () => account, subscribe: empty() },
    circleDetails: jest.fn(() => details),
    conversationPreferences: jest.fn(async () => preferences),
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);

  await render(<NativeCircleDetails circleId="circle-1" />);
  await waitFor(() => expect(screen.getByLabelText('Mute Circle')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Mute Circle'));
  await waitFor(() => expect(preferences.set).toHaveBeenCalledWith('circle:circle-1', 'muted', true));
});
