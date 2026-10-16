import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativePrivateProfile, NativeSettings } from '../src/features/social/private-profile-screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { showFeedback } from '../src/features/feedback/snackbar';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn(() => ({ crop: jest.fn(), resize: jest.fn(), renderAsync: jest.fn(async () => ({ saveAsync: jest.fn(async () => ({ uri: 'file://profile-photo.jpg', base64: 'AQID' })) })) })) }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: jest.fn(() => ({ exists: true, delete: jest.fn() })) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

function makeRuntime(options: { sharePending?: boolean; photo?: { mimeType: 'image/jpeg'; bytes: Uint8Array } } = {}) {
  let state: any = { phase: 'ready', profile: { version: 1, revision: 2, name: 'Naya', status: 'Taking the scenic route' }, avatar: options.photo ?? null, busy: false, sharePending: false };
  const listeners = new Set<() => void>();
  const controller = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    load: jest.fn(async () => undefined),
    save: jest.fn(async (value: { name: string; status: string }) => {
      state = { ...state, profile: { ...state.profile, revision: state.profile.revision + 1, ...value }, sharePending: options.sharePending ?? false };
      for (const listener of listeners) listener();
    }),
    setPhoto: jest.fn(async (value: { mimeType: 'image/jpeg'; bytes: Uint8Array } | null) => { state = { ...state, avatar: value, sharePending: false }; for (const listener of listeners) listener(); }),
    sync: jest.fn(async () => undefined),
  };
  const accountSnapshot = { status: 'ready', account: { id: 'self', pin: 'SELF1234' }, generation: 1 };
  const loginSnapshot = { phase: 'ready', busy: false, phone: '' };
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined, logout: jest.fn(async () => undefined) },
    owner: { getSnapshot: () => accountSnapshot, subscribe: () => () => undefined },
    privateProfile: jest.fn(async () => controller),
  } as any;
  return { runtime, controller };
}

test('native account home uses the signed-in PIN and opens real profile settings', async () => {
  const setup = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativePrivateProfile mode="home" />);
  expect(await screen.findByText('SELF1234')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy();
  expect(screen.getByText('Naya')).toBeTruthy();
  expect(screen.queryByLabelText('Back')).toBeNull();
  expect(screen.queryByText('AW5EM42')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'profile' } });
});

test('native settings opens the encrypted sticker library through its production route', async () => {
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Personal stickers' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/stickers', params: { mode: 'library' } });
});

test('native settings routes Appearance to the device preference screen', async () => {
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Appearance' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'appearance' } });
});

test('native settings opens the Android Now Playing permission and sharing controls', async () => {
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Now Playing' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'music' } });
});

test('native settings opens notification permission and delivery controls', async () => {
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Notifications' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'notifications' } });
});

test('native settings makes account sign-out available and confirms before logging out', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const setup = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativeSettings />);
  await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
  expect(alert).toHaveBeenCalledWith(
    'Sign out of AwsemChat?',
    expect.stringContaining('backup and its recovery key'),
    expect.arrayContaining([
      expect.objectContaining({ text: 'Cancel' }),
      expect.objectContaining({ text: 'Sign out' }),
    ]),
  );
  const buttons = alert.mock.calls.at(-1)?.[2] as any[];
  await act(async () => { buttons.find(button => button.text === 'Sign out')?.onPress?.(); await Promise.resolve(); });
  expect(setup.runtime.flow.logout).toHaveBeenCalled();
});

test('native profile editor loads the saved profile and persists an edit through the encrypted profile flow', async () => {
  const setup = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativePrivateProfile />);
  expect(await screen.findByDisplayValue('Naya')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Naya K.');
  await fireEvent.changeText(screen.getByLabelText('Text status'), 'On the way home');
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(setup.controller.save).toHaveBeenCalledWith({ name: 'Naya K.', status: 'On the way home' }));
  expect(showFeedback).toHaveBeenCalledWith('Profile saved.');
  expect(screen.getByText(/Only accepted friends receive your name and status/)).toBeTruthy();
});

test('profile editor explains that an offline friend will receive the saved update later', async () => {
  const setup = makeRuntime({ sharePending: true }); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativePrivateProfile />);
  await screen.findByDisplayValue('Naya');
  await fireEvent.changeText(screen.getByLabelText('Text status'), 'Back soon');
  await fireEvent.press(screen.getByRole('button', { name: 'Save profile' }));
  await waitFor(() => expect(setup.controller.save).toHaveBeenCalledWith({ name: 'Naya', status: 'Back soon' }));
  await waitFor(() => expect(screen.getByText('Saved on this phone. Some friends will receive the update when they reconnect.')).toBeTruthy());
});

test('native profile editor shows the selected photo and supports explicit removal', async () => {
  const setup = makeRuntime({ photo: { mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) } }); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  await render(<NativePrivateProfile />);
  expect(await screen.findByLabelText('Your profile photo')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Remove profile photo' }));
  expect(screen.getByText('Remove your profile photo? Friends will see your initials instead.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Confirm remove profile photo' }));
  await waitFor(() => expect(setup.controller.setPhoto).toHaveBeenCalledWith(null));
});

test('native profile editor crops a selected photo square and sends compressed bytes to the encrypted profile flow', async () => {
  const setup = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://source.jpg', width: 1200, height: 900 }] } as any);
  await render(<NativePrivateProfile />);
  await screen.findByDisplayValue('Naya');
  await fireEvent.press(screen.getByRole('button', { name: 'Add profile photo' }));
  await waitFor(() => expect(setup.controller.setPhoto).toHaveBeenCalledWith({ mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }));
  expect(showFeedback).toHaveBeenCalledWith('Profile photo saved.');
});

test('native profile editor replaces an existing photo without removing it first', async () => {
  const setup = makeRuntime({ photo: { mimeType: 'image/jpeg', bytes: new Uint8Array([9, 9, 9]) } }); jest.mocked(authenticationRuntime).mockResolvedValue(setup.runtime);
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file://replacement.jpg', width: 900, height: 1200 }] } as any);
  await render(<NativePrivateProfile />);
  expect(await screen.findByLabelText('Your profile photo')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Change profile photo' }));
  await waitFor(() => expect(setup.controller.setPhoto).toHaveBeenCalledWith({ mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) }));
  expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeTruthy();
});
