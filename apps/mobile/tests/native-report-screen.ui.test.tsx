import React from 'react';
import { expect, jest, test } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeConversationReport } from '../src/features/reports/screen';
import { authenticationRuntime } from '../src/features/auth/runtime';
import { showFeedback } from '../src/features/feedback/snackbar';
import { router } from 'expo-router';

jest.mock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
jest.mock('../src/features/feedback/snackbar', () => ({ showFeedback: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() } }));
jest.mock('expo-crypto', () => ({ __esModule: true, CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, randomUUID: () => 'operation-1', digestStringAsync: async () => 'a'.repeat(64) }));
jest.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', View: 'View', StyleSheet: { flatten: (value: unknown) => value } }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('../src/features/ui', () => ({ usePalette: () => ({ bg: '#F4F6F8', surface: '#FFFFFF', text: '#1B2731', muted: '#627079', line: '#E4E9ED', accent: '#066DB8' }) }));

function makeRuntime() {
  const history = Object.freeze({ phase: 'ready', incoming: Object.freeze([Object.freeze({ serverEventId: 'event-1', conversation: `private:${'a'.repeat(64)}`, operation: 'message-1', audience: 'friend-1', sender: {}, plaintext: 'Only this selected message', archival: false })]), outgoing: Object.freeze([]) });
  const login = Object.freeze({ phase: 'ready' });
  const account = Object.freeze({ status: 'ready', account: Object.freeze({ id: 'self' }), generation: 1 });
  const runtime = {
    flow: { getSnapshot: () => login, subscribe: () => () => undefined },
    owner: { getSnapshot: () => account, subscribe: () => () => undefined },
    messages: { context: jest.fn(async () => ({ conversation: `private:${'a'.repeat(64)}`, audience: 'friend-1' })) },
    history: { getSnapshot: () => history, subscribe: () => () => undefined, refresh: jest.fn(async () => undefined) },
    reports: { submit: jest.fn(async () => ({ id: 'report-1', operationId: 'operation-1', expiresAt: '2027-01-13T00:00:00.000Z' })) },
  } as any;
  return runtime;
}

test('Android report requires explicit message selection and reviews 90-day disclosure before sending', async () => {
  const runtime = makeRuntime(); jest.mocked(authenticationRuntime).mockResolvedValue(runtime);
  const view = await render(<NativeConversationReport peer="peer-1" />);
  expect(authenticationRuntime).toHaveBeenCalled();
  expect(runtime.messages.context).toHaveBeenCalled();
  expect(runtime.history.refresh).toHaveBeenCalled();
  expect(view.getByLabelText(/Only this selected message/)).toBeTruthy();
  expect(runtime.reports.submit).not.toHaveBeenCalled();
  await fireEvent.press(view.getByText('Spam'));
  await fireEvent.press(view.getByLabelText(/Only this selected message/));
  await fireEvent.press(view.getByLabelText('Review report'));
  expect(view.getByText(/deleted after 90 days/)).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Send report'));
  await waitFor(() => expect(runtime.reports.submit).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'peer-1', reason: 'spam', selected: [{ eventId: 'event-1', text: 'Only this selected message' }] })));
  expect(showFeedback).toHaveBeenCalledWith(expect.stringContaining('90 days'));
  expect(router.back).toHaveBeenCalled();
});
