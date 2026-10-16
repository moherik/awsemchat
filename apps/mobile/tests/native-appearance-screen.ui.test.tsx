import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { NativeAppearanceScreen } from '../src/features/native-appearance-screen';
import { useDeviceAppearance } from '../src/features/appearance-runtime';
import { showFeedback } from '../src/features/feedback/snackbar';

jest.mock('../src/features/appearance-runtime', () => ({ useDeviceAppearance: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

test('Android appearance choices persist locally and report a save result', async () => {
  const setTheme = jest.fn(async (_theme: string) => undefined);
  jest.mocked(useDeviceAppearance).mockReturnValue({ phase: 'ready', theme: 'system', load: async () => undefined, setTheme } as any);
  await render(<NativeAppearanceScreen />);
  expect(screen.getByRole('radio', { name: 'Use device theme' }).props.accessibilityState.checked).toBe(true);
  await fireEvent.press(screen.getByRole('radio', { name: 'Dark' }));
  expect(setTheme).toHaveBeenCalledWith('dark');
  expect(showFeedback).toHaveBeenCalledWith('Appearance saved on this device.');
});
