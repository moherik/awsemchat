import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import AuthenticationScreen from '../src/features/auth/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn(), canGoBack: () => false } }));
jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/ui', () => ({
  usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }),
  Page: ({ title, children }: any) => { const React = require('react'); const { Text, View } = require('react-native'); return React.createElement(View, null, React.createElement(Text, null, title), children); },
  Copy: ({ children, muted }: any) => { const React = require('react'); const { Text } = require('react-native'); return React.createElement(Text, { style: muted ? { opacity: 0.7 } : undefined }, children); },
  Field: () => null,
}));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));

test('authenticated Android entry offers a real path into the app without development-only copy', async () => {
  const flowSnapshot = { phase: 'ready', busy: false, phone: '+15551234567' };
  const accountSnapshot = { status: 'ready', account: { id: 'account-1', pin: 'AWSE1234' }, generation: 1 };
  const noop = () => () => undefined;
  jest.mocked(authenticationRuntime).mockResolvedValue({
    flow: { getSnapshot: () => flowSnapshot, subscribe: noop },
    owner: { getSnapshot: () => accountSnapshot },
  } as any);
  await render(<AuthenticationScreen />);
  expect(screen.getByText(/Your account is ready/)).toBeTruthy();
  expect(screen.getByText(/SMS restores account access, but your old messages need an encrypted backup and its recovery key/)).toBeTruthy();
  expect(screen.queryByText(/sync is still being connected/)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Restore chats from backup' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'backup' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Open chats' }));
  expect(router.replace).toHaveBeenCalledWith('/');
});
