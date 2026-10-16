import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeSharedMedia } from '../src/features/messages/native-shared-media';
import { authenticationRuntime } from '../src/features/auth/runtime';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/photos/viewer', () => ({ PhotoViewer: ({ photo }: any) => { const { Text } = require('react-native'); return <Text accessibilityLabel="Photo viewer">{photo.caption}</Text>; } }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

test('native shared media loads the signed-in conversation history and shows a real empty state', async () => {
  const loginSnapshot = { phase: 'ready' };
  const ownerSnapshot = { status: 'ready', account: { id: 'self' } };
  const historySnapshot = { phase: 'ready', incoming: [], outgoing: [] };
  const history = { ...historySnapshot, subscribe: () => () => undefined, getSnapshot: () => historySnapshot, refresh: jest.fn(async () => undefined) };
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined },
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined },
    history,
    messages: { context: jest.fn(async () => ({ conversation: `private:${'a'.repeat(64)}`, audience: 'friend:request-7', sender: { identity: 'self' }, recipients: [] })) },
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeSharedMedia peer="friend-1" />);
  expect(await screen.findByText('No photos, GIFs or Moments shared yet.')).toBeTruthy();
  expect(runtime.messages.context).toHaveBeenCalledWith({ targetId: 'friend-1' });
  expect(history.refresh).toHaveBeenCalledTimes(1);
});

test('native shared media decrypts a chat photo and opens its caption in the photo viewer', async () => {
  const conversation = `private:${'a'.repeat(64)}`;
  const photo = JSON.stringify({ version: 1, type: 'private-photo-message', id: 'photo-1', audience: 'friend:request-7', caption: 'At the lake', media: { version: 1, id: 'asset-1', key: 'f'.repeat(64), size: 128, mimeType: 'image/jpeg' } });
  const historySnapshot = { phase: 'ready', incoming: [{ conversation, audience: 'friend:request-7', operation: 'photo-1', plaintext: photo, direction: 'incoming', sender: { identity: 'peer-key' }, sequence: 1 }], outgoing: [] };
  const loginSnapshot = { phase: 'ready' };
  const ownerSnapshot = { status: 'ready', account: { id: 'self' } };
  const history = { ...historySnapshot, subscribe: () => () => undefined, getSnapshot: () => historySnapshot, refresh: jest.fn(async () => undefined) };
  const photoDownload = jest.fn(async () => new Uint8Array([1, 2, 3]));
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined },
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined },
    history,
    messages: { context: jest.fn(async () => ({ conversation, audience: 'friend:request-7', sender: { identity: 'self' }, recipients: [] })) },
    privatePhotoEditor: jest.fn(async () => ({ download: photoDownload })),
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeSharedMedia peer="friend-1" />);
  const tile = await screen.findByRole('button', { name: 'Open photo: At the lake' });
  expect(photoDownload).toHaveBeenCalledWith(JSON.parse(photo).media);
  await fireEvent.press(tile);
  expect(screen.getByLabelText('Photo viewer').props.children).toBe('At the lake');
});

test('native shared media decrypts items in pages and loads the next page on request', async () => {
  const conversation = `private:${'a'.repeat(64)}`;
  const audience = 'friend:request-7';
  const media = (index: number) => ({ version: 1, id: `asset-${index}`, key: 'f'.repeat(64), size: 128, mimeType: 'image/jpeg' });
  const incoming = Array.from({ length: 41 }, (_, index) => ({
    conversation, audience, operation: `photo-${index}`, direction: 'incoming', sender: { identity: 'peer-key' }, sequence: index + 1,
    plaintext: JSON.stringify({ version: 1, type: 'private-photo-message', id: `photo-${index}`, audience, caption: `Photo ${index}`, media: media(index) }),
  }));
  const historySnapshot = { phase: 'ready', incoming, outgoing: [] };
  const loginSnapshot = { phase: 'ready' };
  const ownerSnapshot = { status: 'ready', account: { id: 'self' } };
  const history = { ...historySnapshot, subscribe: () => () => undefined, getSnapshot: () => historySnapshot, refresh: jest.fn(async () => undefined) };
  const photoDownload = jest.fn(async () => new Uint8Array([1, 2, 3]));
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined },
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined }, history,
    messages: { context: jest.fn(async () => ({ conversation, audience, sender: { identity: 'self' }, recipients: [] })) },
    privatePhotoEditor: jest.fn(async () => ({ download: photoDownload })),
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeSharedMedia peer="friend-1" />);
  await screen.findByRole('button', { name: 'Open photo: Photo 40' });
  await waitFor(() => expect(photoDownload).toHaveBeenCalledTimes(40));
  await fireEvent.press(screen.getByRole('button', { name: 'Load more shared media' }));
  await waitFor(() => expect(photoDownload).toHaveBeenCalledTimes(41));
});

test('native shared media loads older relay history after the local media page is exhausted', async () => {
  const conversation = `private:${'a'.repeat(64)}`;
  const audience = 'friend:request-7';
  const media = (index: number) => ({ version: 1, id: `asset-${index}`, key: 'f'.repeat(64), size: 128, mimeType: 'image/jpeg' });
  const photoMessage = (index: number) => ({
    conversation, audience, operation: `photo-${index}`, direction: 'incoming', sender: { identity: 'peer-key' }, sequence: index + 1,
    plaintext: JSON.stringify({ version: 1, type: 'private-photo-message', id: `photo-${index}`, audience, caption: `Photo ${index}`, media: media(index) }),
  });
  let historySnapshot: { phase: string; incoming: any[]; outgoing: any[] } = { phase: 'ready', incoming: Array.from({ length: 40 }, (_, index) => photoMessage(index)), outgoing: [] };
  const listeners = new Set<() => void>();
  const history = {
    ...historySnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => historySnapshot,
    refresh: jest.fn(async () => { historySnapshot = { ...historySnapshot, incoming: [...historySnapshot.incoming] }; for (const listener of listeners) listener(); }),
  };
  const photoDownload = jest.fn(async () => new Uint8Array([1, 2, 3]));
  const loadOlder = jest.fn(async () => {
    historySnapshot = { ...historySnapshot, incoming: [photoMessage(40), ...historySnapshot.incoming] };
    return { more: false };
  });
  const loginSnapshot = { phase: 'ready' };
  const ownerSnapshot = { status: 'ready', account: { id: 'self' } };
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined },
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined },
    history,
    historyPager: jest.fn(() => ({ load: loadOlder })),
    messages: { context: jest.fn(async () => ({ conversation, audience, sender: { identity: 'self' }, recipients: [] })) },
    privatePhotoEditor: jest.fn(async () => ({ download: photoDownload })),
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeSharedMedia peer="friend-1" />);
  await screen.findByRole('button', { name: 'Open photo: Photo 39' });
  await waitFor(() => expect(photoDownload).toHaveBeenCalledTimes(40));

  await fireEvent.press(screen.getByRole('button', { name: 'Load earlier shared media' }));

  await waitFor(() => expect(loadOlder).toHaveBeenCalledWith(conversation, audience));
  expect(await screen.findByRole('button', { name: 'Open photo: Photo 40' })).toBeTruthy();
  await waitFor(() => expect(photoDownload).toHaveBeenCalledTimes(41));
  expect(runtime.history.refresh).toHaveBeenCalledTimes(2);
});

test('native shared media offers retry when loading older relay history fails', async () => {
  const conversation = `private:${'a'.repeat(64)}`;
  const audience = 'friend:request-7';
  const loginSnapshot = { phase: 'ready' };
  const ownerSnapshot = { status: 'ready', account: { id: 'self' } };
  const historySnapshot = { phase: 'ready', incoming: [], outgoing: [] };
  const history = { ...historySnapshot, subscribe: () => () => undefined, getSnapshot: () => historySnapshot, refresh: jest.fn(async () => undefined) };
  const loadOlder = jest.fn<() => Promise<{ more: boolean }>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ more: false });
  const runtime = {
    flow: { getSnapshot: () => loginSnapshot, subscribe: () => () => undefined },
    owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined }, history,
    historyPager: jest.fn(() => ({ load: loadOlder })),
    messages: { context: jest.fn(async () => ({ conversation, audience, sender: { identity: 'self' }, recipients: [] })) },
  } as any;
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeSharedMedia peer="friend-1" />);

  const loadButton = await screen.findByRole('button', { name: 'Load earlier shared media' });
  await fireEvent.press(loadButton);
  const retry = await screen.findByRole('button', { name: 'Retry loading earlier shared media' });
  await fireEvent.press(retry);

  await waitFor(() => expect(loadOlder).toHaveBeenCalledTimes(2));
  expect(runtime.historyPager).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('No photos, GIFs or Moments shared yet.')).toBeTruthy();
});
