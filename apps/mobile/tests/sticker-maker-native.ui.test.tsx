import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import StickerScreen from '../src/features/stickers/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { showFeedback } from '../src/features/feedback/snackbar';
import { removePhotoBackground } from '../src/features/stickers/background-removal';
import * as ImagePicker from 'expo-image-picker';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ mode: 'maker' }) }));
jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/stickers/controls', () => ({
  IconButton: ({ label, onPress }: any) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label, onPress }, React.createElement(Text, null, label)); },
  PanelHeader: ({ title }: any) => { const React = require('react'); const { Text } = require('react-native'); return React.createElement(Text, null, title); },
  Primary: ({ label, onPress }: any) => { const React = require('react'); const { Pressable, Text } = require('react-native'); return React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: label, onPress }, React.createElement(Text, null, label)); },
}));
jest.mock('../src/features/feedback/sheet', () => ({ FeedbackSheet: ({ isPresented, children }: any) => isPresented ? children : null }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn(), dismissFeedback: jest.fn() }));
jest.mock('../src/features/stickers/editor-canvas', () => ({ CropCanvas: () => null, DraggableText: () => null }));
jest.mock('../src/features/stickers/background-removal', () => ({ canRemoveBackground: true, removePhotoBackground: jest.fn() }));
jest.mock('../src/features/stickers/artwork', () => ({ Artwork: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: () => ({ crop: jest.fn(), renderAsync: jest.fn() }) }, SaveFormat: { PNG: 'png' } }));
jest.mock('expo-file-system', () => ({ File: class File {} }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'sticker-1' }));
jest.mock('@expo/ui', () => ({ Host: ({ children }: any) => children, Slider: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

test('native sticker maker offers packs from the signed-in encrypted library', async () => {
  const store = { list: jest.fn(async () => [{ id: 'saved-1', artwork: { pack: 'Family' } }]) };
  jest.mocked(authenticationRuntime).mockResolvedValue({ personalStickers: async () => store } as any);
  await render(<StickerScreen />);
  await waitFor(() => expect(store.list).toHaveBeenCalled());
  await fireEvent.press(screen.getByRole('button', { name: 'Save sticker' }));
  expect(screen.getByText('Family')).toBeTruthy();
});

test('native sticker maker describes photos as local without calling the app a demo', async () => {
  jest.mocked(authenticationRuntime).mockResolvedValue({ personalStickers: async () => ({ list: async () => [] }) } as any);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://photo.jpg', width: 800, height: 600 }] } as any);
  await render(<StickerScreen />);
  expect(screen.getByText('Transparent sample · Choose a photo for background removal')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo' }));
  await waitFor(() => expect(screen.getByText('Your photo stays on this device.')).toBeTruthy());
  expect(screen.queryByText(/in the demo/i)).toBeNull();
});

test('native sticker maker removes the selected photo background and keeps the cutout editable locally', async () => {
  jest.mocked(authenticationRuntime).mockResolvedValue({ personalStickers: async () => ({ list: async () => [] }) } as any);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://photo.jpg', width: 800, height: 600 }] } as any);
  jest.mocked(removePhotoBackground).mockResolvedValue({ uri: 'file://photo-cutout.png', width: 800, height: 600 });

  await render(<StickerScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Background' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Remove background' }));

  await waitFor(() => expect(removePhotoBackground).toHaveBeenCalledWith('file://photo.jpg'));
  expect(showFeedback).toHaveBeenCalledWith('Background removed. Your photo stayed on this phone.');
  expect(screen.getByRole('button', { name: 'Undo background removal' })).toBeTruthy();
});
