import React from 'react';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import BackupScreen from '../src/features/backup/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/backup/drive-panel', () => ({ DrivePanel: () => null }));
jest.mock('../src/features/ui', () => ({
  Page: ({ children, title }: any) => { const { Text, View } = require('react-native'); return <View><Text>{title}</Text>{children}</View>; },
  Copy: ({ children }: any) => { const { Text } = require('react-native'); return <Text>{children}</Text>; },
  Action: ({ label, onPress, primary }: any) => { const { Pressable, Text } = require('react-native'); return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}><Text>{label}</Text></Pressable>; },
  usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }),
}));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), canGoBack: () => true, back: jest.fn(), replace: jest.fn() } }));

const mockedRuntime = jest.mocked(authenticationRuntime);

function fixture(initial: string | null = null) {
  let stored = initial;
  const record = jest.fn(async (value: string) => { stored = value; });
  const account = { status: 'ready', account: { id: 'account-one' }, generation: 1 };
  const flow = { phase: 'ready' };
  const runtime = {
    owner: { subscribe: () => () => {}, getSnapshot: () => account },
    flow: { subscribe: () => () => {}, getSnapshot: () => flow },
    backup: { create: jest.fn(async () => ({ cancelled: false as const, recoveryKey: 'a'.repeat(64), records: 4, stickers: 1 })), restore: jest.fn() },
    lastLocalBackup: async () => ({ read: async () => stored, record }),
    history: { refresh: jest.fn() },
  } as unknown as Awaited<ReturnType<typeof authenticationRuntime>>;
  mockedRuntime.mockResolvedValue(runtime);
  return { runtime, record, get stored() { return stored; } };
}

beforeEach(() => { mockedRuntime.mockReset(); });
afterEach(cleanup);

test('shows the last local backup after the screen is reopened', async () => {
  const f = fixture();
  const first = await render(<BackupScreen />);
  expect(await screen.findByText('No local backup has been saved yet.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Save local backup' }));
  await waitFor(() => expect(f.record).toHaveBeenCalledTimes(1));
  expect(await screen.findByText(/Last local backup:/)).toBeTruthy();

  first.unmount();
  await render(<BackupScreen />);
  await waitFor(() => expect(screen.getByText(/Last local backup:/)).toBeTruthy());
});
