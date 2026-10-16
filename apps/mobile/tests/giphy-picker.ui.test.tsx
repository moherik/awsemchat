import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { GiphyPicker } from '../src/features/giphy/picker';
import type { Gif } from '../src/features/giphy/client';

jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('expo-image', () => ({ Image: ({ accessibilityLabel }: any) => { const React = require('react'); const { Text } = require('react-native'); return React.createElement(Text, null, accessibilityLabel); } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('react-native', () => {
  const React = require('react');
  const host = (name: string) => React.forwardRef((props: Record<string, unknown>, ref: unknown) => React.createElement(name, { ...props, ref }, props.children));
  return { ActivityIndicator: host('ActivityIndicator'), Modal: ({ visible, children }: any) => visible ? children : null, Platform: { OS: 'android' }, Pressable: host('Pressable'), SafeAreaView: host('SafeAreaView'), ScrollView: host('ScrollView'), Text: host('Text'), TextInput: host('TextInput'), View: host('View'), StyleSheet: { flatten: (value: unknown) => value } };
});
const gif: Gif = { id: 'gif-1', title: 'Happy wave', previewURL: 'https://media1.giphy.com/p.webp', downloadURL: 'https://media1.giphy.com/d.gif' };
function setup() {
  const client = { list: jest.fn(async () => ({ items: [gif], hasMore: false })), favorites: jest.fn(async () => ({ items: [gif], hasMore: false })) };
  const favoriteStore = { list: jest.fn(async () => []), toggle: jest.fn(async () => [{ id: gif.id, title: gif.title }]) };
  const onSend = jest.fn();
  return { client, favoriteStore, onSend };
}

test('picker loads trending GIFs, shows attribution and asks for confirmation before sending', async () => {
  const f = setup();
  await render(<GiphyPicker open client={f.client} favoriteStore={f.favoriteStore} onSend={f.onSend} onClose={jest.fn()} />);
  expect(await screen.findByLabelText('Preview Happy wave')).toBeTruthy();
  expect(screen.getByText('Powered by GIPHY · Trending')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Preview Happy wave'));
  expect(screen.getByLabelText('GIF caption')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('GIF caption'), 'Hi there');
  await fireEvent.press(screen.getByLabelText('Send GIF'));
  expect(f.onSend).toHaveBeenCalledWith(gif, 'Hi there');
});

test('favorites toggle and load live GIFs by saved ID', async () => {
  const f = setup();
  await render(<GiphyPicker open client={f.client} favoriteStore={f.favoriteStore} onSend={f.onSend} onClose={jest.fn()} />);
  await screen.findByLabelText('Preview Happy wave');
  await fireEvent.press(screen.getByLabelText('Save GIF to favorites'));
  await waitFor(() => expect(f.favoriteStore.toggle).toHaveBeenCalledWith(gif));
  await fireEvent.press(screen.getByLabelText('Favorites'));
  await waitFor(() => expect(f.client.favorites).toHaveBeenCalledWith(['gif-1'], expect.any(AbortSignal)));
  expect(await screen.findByLabelText('Preview Happy wave')).toBeTruthy();
});
