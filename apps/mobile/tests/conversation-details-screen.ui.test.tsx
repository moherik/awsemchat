import React from 'react';
import { Alert } from 'react-native';
import { expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { NativeConversationDetails } from '../src/features/messages/conversation-details-screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { showFeedback } from '../src/features/feedback/snackbar';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));
jest.mock('../src/features/messages/identity-panel', () => ({ IdentityPanel: () => null }));
const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

function makeRuntime(profile?: object) {
  const history = Object.freeze({ phase: 'ready', outgoing: Object.freeze([]), incoming: Object.freeze([Object.freeze({
    conversation: 'private:request-1', audience: 'friend:request-1', contentType: 'private-profile', sequence: 1,
    plaintext: JSON.stringify(profile ?? { version: 1, revision: 3, name: 'Naya', status: 'Taking the scenic route' }),
  })]) });
  const accepted = Object.freeze({ phase: 'ready', items: Object.freeze([{ accountId: 'peer-1', pin: 'NAYA47', status: 'accepted', requestId: 'request-1' }]) });
  const friendSnapshot = Object.freeze({ lists: Object.freeze({ accepted, incoming: accepted, outgoing: accepted, blocked: accepted }), busy: false });
  const login = Object.freeze({ phase: 'ready', busy: false, phone: '' });
  const account = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self' }), generation: 1 });
  const runtime = {
    flow: { getSnapshot: () => login, subscribe: () => () => undefined },
    owner: { getSnapshot: () => account, subscribe: () => () => undefined },
    history: { getSnapshot: () => history, subscribe: () => () => undefined },
    friends: { getSnapshot: () => friendSnapshot, subscribe: () => () => undefined, refresh: jest.fn(async () => undefined), block: jest.fn(async () => undefined) },
    messages: { context: jest.fn(async () => ({ conversation: 'private:request-1', audience: 'friend:request-1' })) },
  } as any;
  return runtime;
}

test('private conversation details show the latest accepted profile and open real shared media', async () => {
  const runtime = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeConversationDetails peer="peer-1" />);
  expect(await screen.findByText('Naya')).toBeTruthy();
  expect(screen.getByText('PIN · NAYA47')).toBeTruthy();
  expect(screen.getByText('Taking the scenic route')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Open shared media' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'media', peer: 'peer-1' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Report conversation' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/flow', params: { view: 'report', peer: 'peer-1' } });
});

test('private conversation details decrypt the profile photo with the current friendship request', async () => {
  const avatar = { version: 1, id: 'media-1', key: 'a'.repeat(64), mimeType: 'image/jpeg', size: 3 };
  const runtime = makeRuntime({ version: 2, revision: 4, name: 'Naya', status: '', avatar });
  runtime.privateProfilePhotoBytes = jest.fn(async () => new Uint8Array([1, 2, 3]));
  jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeConversationDetails peer="peer-1" />);
  expect(await screen.findByLabelText('Profile photo of Naya')).toBeTruthy();
  expect(runtime.privateProfilePhotoBytes).toHaveBeenCalledWith('peer-1', 'request-1', avatar);
});

test('blocking from details requires confirmation and calls the authenticated friends flow', async () => {
  const runtime = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  await render(<NativeConversationDetails peer="peer-1" />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Block NAYA47' }));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('NAYA47'), expect.any(String), expect.any(Array));
  const actions = alert.mock.calls.at(-1)?.[2] as Array<{ text: string; onPress?: () => void }>;
  await act(async () => { actions.find(action => action.text === 'Block')?.onPress?.(); });
  await waitFor(() => expect(runtime.friends.block).toHaveBeenCalledWith('peer-1', true));
  expect(router.replace).toHaveBeenCalledWith('/');
  expect(showFeedback).toHaveBeenCalledWith('NAYA47 was blocked.');
});
