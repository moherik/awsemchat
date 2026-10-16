import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { NativePrivacyScreen } from '../src/features/social/privacy-screen';
import { NativeSettings } from '../src/features/social/private-profile-screen';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/features/ui', () => ({
  usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }),
  Page: ({ title, children }: any) => { const React = require('react'); const { Text, View } = require('react-native'); return React.createElement(View, null, React.createElement(Text, null, title), children); },
  Copy: ({ children }: any) => { const React = require('react'); const { Text } = require('react-native'); return React.createElement(Text, null, children); },
  Action: ({ label, onPress }: any) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label, onPress }, React.createElement(Text, null, label)); },
}));

test('privacy screen links to real blocked contacts and friend verification entry points', async () => {
  await render(<NativePrivacyScreen />);
  expect(screen.getByText('Your phone number is private; friends connect with your PIN.')).toBeTruthy();
  expect(screen.getByText('AwsemChat does not show online, typing, or read indicators.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Blocked contacts'));
  expect(router.push).toHaveBeenCalledWith('/blocked');
  await fireEvent.press(screen.getByLabelText('Find a friend to verify'));
  expect(router.push).toHaveBeenCalledWith('/?tab=Friends');
});

test('native settings opens privacy and safety', async () => {
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByLabelText('Privacy & safety'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'privacy' } });
});
