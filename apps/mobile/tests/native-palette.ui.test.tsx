import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';
import { usePalette } from '../src/features/ui';

jest.mock('../src/features/appearance-runtime', () => ({ useDeviceAppearance: () => ({ theme: 'dark' }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));

function PaletteProbe() {
  const palette = usePalette();
  return <Text>{palette.surface}</Text>;
}
test('Android palette uses device appearance', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  try {
    await render(<PaletteProbe />);
    expect(screen.getByText('#202C34')).toBeTruthy();
  } finally {
    if (descriptor) Object.defineProperty(Platform, 'OS', descriptor);
  }
});
