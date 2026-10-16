import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeNowPlayingScreen } from '../src/features/now-playing/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { createNowPlayingSettings } from '../src/features/now-playing/settings';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/ui', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Host: ({ children }: any) => React.createElement(View, null, children),
    Switch: ({ value, onValueChange, label, disabled }: any) => React.createElement(Pressable, { accessibilityRole: 'switch', accessibilityLabel: label, accessibilityState: { checked: value, disabled }, disabled, onPress: () => onValueChange(!value) }, React.createElement(Text, null, label)),
  };
});
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

test('Now Playing explains notification access and keeps friend sharing behind a second opt-in', async () => {
  const native = { hasNotificationAccess: async () => true, openNotificationAccessSettings: jest.fn(async () => undefined), activeTrack: async () => ({ title: 'Sunset Lover', artist: 'Petit Biscuit' }) };
  const controller = createNowPlayingSettings({ bridge: native, store: { read: async () => false, write: async () => undefined } });
  jest.mocked(authenticationRuntime).mockResolvedValue({ nowPlaying: async () => controller } as any);
  await render(<NativeNowPlayingScreen />);
  expect(await screen.findByText(/notification access is broad and can expose notifications from every app/)).toBeTruthy();
  const toggle = await screen.findByRole('switch', { name: 'Share with accepted friends' });
  expect(toggle.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Open Android notification access settings' }));
  expect(native.openNotificationAccessSettings).toHaveBeenCalledTimes(1);
  await fireEvent.press(toggle);
  await waitFor(() => expect(screen.getByRole('switch', { name: 'Share with accepted friends' }).props.accessibilityState.checked).toBe(true));
  expect(await screen.findByText('Sunset Lover · Petit Biscuit')).toBeTruthy();
});
