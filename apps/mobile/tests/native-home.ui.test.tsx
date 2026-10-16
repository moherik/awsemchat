import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeHome } from '../src/features/native-home';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({ router: { setParams: jest.fn(), push: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/messages/native-chat-list', () => ({ NativeChatList: () => require('react').createElement('Text', null, 'Production chats') }));
jest.mock('../src/features/social/friends-screen', () => ({ NativeFriends: () => require('react').createElement('Text', null, 'Production friends') }));
jest.mock('../src/features/social/private-profile-screen', () => ({ NativePrivateProfile: () => require('react').createElement('Text', null, 'Production profile') }));

test('native home starts with production chats and switches to connected friends and profile screens', async () => {
  await render(<NativeHome />);
  expect(screen.getByText('Production chats')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'Friends' }));
  expect(screen.getByText('Production friends')).toBeTruthy();
  await fireEvent.press(screen.getByRole('tab', { name: 'You' }));
  expect(screen.getByText('Production profile')).toBeTruthy();
});

test('native home opens real settings from its header', async () => {
  await render(<NativeHome />);
  await fireEvent.press(screen.getByLabelText('Open settings'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'settings' } });
});
