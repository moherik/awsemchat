import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { CircleStickerLibrary } from '../src/features/stickers/circle-library';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { createCircleStickerManagement } from '../src/features/social/circle-sticker-management.ts';

jest.mock('expo-router', () => {
  const React = require('react');
  return { router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useFocusEffect: (callback: () => unknown) => React.useEffect(callback, [callback]) };
});
jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/social/circle-sticker-management.ts', () => ({ createCircleStickerManagement: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/stickers/controls', () => ({
  IconButton: ({ label }: { label: string }) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label }, React.createElement(Text, null, label)); },
  Primary: ({ label }: { label: string }) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label }, React.createElement(Text, null, label)); },
}));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

test('Circle sticker management shows and counts stickers without exposing deferred custom emoji', async () => {
  const sticker = { id: 'sticker-1', kind: 'sticker', label: 'Coffee break', image: { epoch: 1, media: { mimeType: 'image/png' } } };
  const emoji = { id: 'emoji-1', kind: 'emoji', label: 'Custom wink', image: { epoch: 1, media: { mimeType: 'image/png' } } };
  const manager = { load: jest.fn(async () => ({ state: 'ready', items: [sticker, emoji], canRemove: false, needsRefresh: false })), download: jest.fn(async () => new Uint8Array([1])), remove: jest.fn() };
  jest.mocked(createCircleStickerManagement).mockReturnValue(manager as any);
  jest.mocked(authenticationRuntime).mockResolvedValue({
    owner: { requireSession: () => ({ account: { id: 'account-1' }, deviceId: 'device-1', generation: 1, accessToken: 'token' }) },
    circleCollectionPublisher: () => ({ pending: async () => undefined }),
    circleCollectionMedia: () => ({ pending: async () => undefined }),
    social: { circle: async () => ({}) },
  } as any);

  await act(async () => {
    render(<CircleStickerLibrary circleId="circle-1" />);
    for (let index = 0; index < 6; index++) await Promise.resolve();
  });

  await waitFor(() => expect(screen.getByText('Coffee break')).toBeTruthy());
  expect(screen.queryByText('Custom wink')).toBeNull();
  expect(screen.getByText('1 shared sticker')).toBeTruthy();
});
