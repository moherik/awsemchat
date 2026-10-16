import React from 'react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeNotificationsScreen } from '../src/features/notifications/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';

const mockNotifications = {
  __esModule: true,
  AndroidImportance: { HIGH: 4 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExpoPushToken[abc123]' })),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
};

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-notifications', () => mockNotifications);
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'expo-project' } } } } }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

beforeEach(() => { jest.clearAllMocks(); });

test('notifications screen requests permission, registers this account device, and reports generic alerts', async () => {
  jest.mocked(mockNotifications.getPermissionsAsync).mockResolvedValue({ granted: false });
  const register = jest.fn(async () => undefined);
  const runtime = {
    notifications: { status: jest.fn(async () => false), register, unregister: jest.fn(async () => undefined) },
    conversationPreferences: async () => ({ getSnapshot: () => ({ values: { 'circle:circle-1': { muted: true } } }) }),
  };
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime as any);

  await render(<NativeNotificationsScreen notifications={mockNotifications as any} physicalDevice projectId="expo-project" platform="android" />);
  expect(await screen.findByText(/Notifications never include message text, names, or photos/)).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Turn on notifications' }));
  await waitFor(() => expect(register).toHaveBeenCalledWith('ExpoPushToken[abc123]', ['circle:circle-1']));
  expect(mockNotifications.setNotificationChannelAsync).toHaveBeenCalledWith('messages', expect.objectContaining({ name: 'Messages' }));
  expect(await screen.findByText('On for this phone')).toBeTruthy();
});

test('notifications stay disabled until an EAS project is configured', async () => {
  jest.mocked(authenticationRuntime).mockResolvedValue({ notifications: { status: jest.fn(async () => false) } } as any);
  await render(<NativeNotificationsScreen notifications={mockNotifications as any} physicalDevice projectId="" />);
  expect(await screen.findByText(/An EAS project ID is needed/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Turn on notifications' }).props.accessibilityState.disabled).toBe(true);
  expect(mockNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

test('revoked operating-system permission clears a stale server registration', async () => {
  const unregister = jest.fn(async () => undefined);
  jest.mocked(authenticationRuntime).mockResolvedValue({ notifications: { status: jest.fn(async () => true), unregister } } as any);
  jest.mocked(mockNotifications.getPermissionsAsync).mockResolvedValue({ granted: false });
  await render(<NativeNotificationsScreen notifications={mockNotifications as any} physicalDevice projectId="expo-project" platform="android" />);
  expect(await screen.findByText('Stay in touch')).toBeTruthy();
  await waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
});
