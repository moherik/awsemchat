import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { act, render, screen } from '@testing-library/react-native';
import Layout from '../src/app/_layout';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => React.createElement(Text, null, `Redirecting to ${href}`),
    Stack: () => React.createElement(View, { testID: 'navigation-stack' }, React.createElement(Text, null, 'Navigation stack mounted')),
    router: { replace: jest.fn() },
    useSegments: () => [],
  };
});
jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/ui', () => ({
  usePalette: () => ({ surface: '#FFFFFF', accent: '#066DB8' }),
}));
jest.mock('../src/features/messages/sync-lifecycle', () => ({ InboxLifecycle: () => null }));
jest.mock('../src/features/feedback/snackbar', () => ({ SnackbarHost: () => null }));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

test('keeps Expo Router mounted while the authentication runtime is loading', async () => {
  let resolveRuntime!: (value: unknown) => void;
  jest.mocked(authenticationRuntime).mockReturnValue(new Promise(resolve => { resolveRuntime = resolve; }) as any);

  const tree = await render(<Layout />);

  expect(JSON.stringify(tree.toJSON())).toContain('navigation-stack');
  expect(screen.getByLabelText('Checking your account')).toBeTruthy();

  const flowSnapshot = { phase: 'phone', busy: false, phone: '' };
  const ownerSnapshot = { status: 'signed-out' };
  await act(async () => {
    resolveRuntime({
      flow: { getSnapshot: () => flowSnapshot, subscribe: () => () => undefined },
      owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined },
    });
    await Promise.resolve();
  });
});
