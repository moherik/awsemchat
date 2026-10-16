import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeNewConversation } from '../src/features/messages/native-new-conversation';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));

const accepted = [
  { accountId: 'peer-1', pin: 'NAYA47', status: 'accepted', requestId: 'request-1' },
  { accountId: 'peer-2', pin: 'RAKA12', status: 'accepted', requestId: 'request-2' },
];
function runtime(snapshot: any = { phase: 'ready', items: accepted, busy: false }, phase = 'ready', secondPage: any[] = []) {
  let auth = Object.freeze({ phase, busy: false, phone: '' });
  let page = Object.freeze({ refreshing: false, ...snapshot });
  let friendSnapshot = Object.freeze({ lists: Object.freeze({ accepted: page, incoming: page, outgoing: page, blocked: page }), pinDraft: '', busy: false });
  const listeners = new Set<() => void>();
  const friends = {
    getSnapshot: () => friendSnapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: jest.fn(async () => undefined),
    loadMore: jest.fn(async () => {
      if (!secondPage.length) return;
      page = Object.freeze({ ...page, items: [...page.items, ...secondPage], nextCursor: undefined });
      friendSnapshot = Object.freeze({ ...friendSnapshot, lists: Object.freeze({ ...friendSnapshot.lists, accepted: page }) });
      for (const listener of listeners) listener();
    }),
  };
  const flow = { getSnapshot: () => auth, subscribe: () => () => undefined };
  const incoming: any[] = [];
  const historySnapshot = { phase: 'ready', incoming, outgoing: [] };
  const history = { getSnapshot: () => historySnapshot, subscribe: () => () => undefined, refresh: jest.fn(async () => undefined) };
  const ownerSnapshot = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self' }), generation: 1 });
  const value = { owner: { getSnapshot: () => ownerSnapshot, subscribe: () => () => undefined }, friends, flow, history, syncMessages: jest.fn(async () => undefined), privateProfileForFriend: jest.fn(async () => ({ state: 'empty' })) } as any;
  return { value, friends, setAuth(next: any) { auth = Object.freeze(next); } };
}

test('native picker lists real accepted friends and filters them by PIN', async () => {
  const setup = runtime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  expect(await screen.findByText('NAYA47')).toBeTruthy();
  expect(screen.getByText('RAKA12')).toBeTruthy();
  expect(screen.getByText('Create a Circle')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search accepted friends'), 'raka');
  expect(screen.getByText('RAKA12')).toBeTruthy();
  expect(screen.queryByText('NAYA47')).toBeNull();
  expect(setup.friends.refresh).toHaveBeenCalledWith('accepted');
});

test('native picker shows accepted friends’ encrypted display names and current statuses', async () => {
  const setup = runtime();
  setup.value.privateProfileForFriend = jest.fn(async (accountId: string) => accountId === 'peer-1'
    ? { state: 'ready', profile: { version: 1, revision: 4, name: 'Naya', status: 'Taking the scenic route' } }
    : { state: 'empty' });
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  expect(screen.getByText('PIN · NAYA47')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Search accepted friends'), 'naya');
  expect(screen.getByText('PIN · NAYA47')).toBeTruthy();
  expect(screen.queryByText('RAKA12')).toBeNull();
});

test('native picker decrypts the accepted friend’s profile photo using that friendship audience', async () => {
  const setup = runtime();
  const avatar = { version: 1, id: 'media-1', key: 'a'.repeat(64), mimeType: 'image/jpeg', size: 3 };
  setup.value.privateProfileForFriend = jest.fn(async (accountId: string) => accountId === 'peer-1'
    ? { state: 'ready', profile: { version: 2, revision: 4, name: 'Naya', status: '', avatar } }
    : { state: 'empty' });
  setup.value.privateProfilePhotoBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  expect(await screen.findByLabelText('Profile photo of Naya')).toBeTruthy();
  expect(setup.value.privateProfilePhotoBytes).toHaveBeenCalledWith('peer-1', 'request-1', avatar);
});

test('Circle creation and friend selection route into their production flows', async () => {
  const setup = runtime(); jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  await waitFor(() => expect(screen.getByText('NAYA47')).toBeTruthy());
  await fireEvent.press(screen.getByLabelText('Create a Circle'));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'circle' } });
  await fireEvent.press(screen.getByLabelText('Start a chat with NAYA47'));
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/chat', params: { peer: 'peer-1', pin: 'NAYA47' } });
});

test('picker shows empty state and paginates accepted friends', async () => {
  const setup = runtime({ phase: 'ready', items: [], busy: false, nextCursor: 'page-2' });
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  expect(await screen.findByText('No accepted friends yet. Add someone by PIN.')).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Load more friends'));
  expect(setup.friends.loadMore).toHaveBeenCalledWith('accepted');
});

test('search automatically finds accepted friends on later pages', async () => {
  const setup = runtime({ phase: 'ready', items: accepted, busy: false, nextCursor: 'page-2' }, 'ready', [
    { accountId: 'peer-3', pin: 'LIA77', status: 'accepted', requestId: 'request-3' },
  ]);
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  await screen.findByText('NAYA47');
  await fireEvent.changeText(screen.getByLabelText('Search accepted friends'), 'Lia');
  expect(await screen.findByText('LIA77')).toBeTruthy();
  expect(setup.friends.loadMore).toHaveBeenCalledWith('accepted');
});

test('picker requires sign-in and exposes retry for a failed friend list', async () => {
  const setup = runtime({ phase: 'error', items: [], busy: false, error: 'NETWORK' }, 'phone');
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  await fireEvent.press(await screen.findByText('Sign in'));
  expect(router.push).toHaveBeenCalledWith('/auth');
});

test('failed accepted-friend load can be retried', async () => {
  const setup = runtime({ phase: 'error', items: [], busy: false, error: 'NETWORK' });
  jest.mocked(authenticationRuntime).mockResolvedValue(setup.value);
  await render(<NativeNewConversation />);
  await fireEvent.press(await screen.findByText('Retry'));
  expect(setup.friends.refresh).toHaveBeenCalledWith('accepted');
});
