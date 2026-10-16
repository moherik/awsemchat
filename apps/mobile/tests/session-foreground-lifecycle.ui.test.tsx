import React from 'react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import TestRenderer, { act } from 'react-test-renderer';

const listeners = new Set<(state: string) => void>();
const mockSchedulers: Array<{ enabled: () => boolean; sync: () => Promise<{ more: boolean }>; refresh: () => void }> = [];
const mockAppState = {
  currentState: 'active',
  addEventListener: (_event: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
  emit(state: string) { this.currentState = state; for (const listener of listeners) listener(state); },
  reset() { listeners.clear(); this.currentState = 'active'; },
};

function loadLifecycle() {
  jest.doMock('react-native', () => ({ AppState: mockAppState }));
  jest.doMock('../src/features/auth/runtime', () => ({ authenticationRuntime: jest.fn() }));
  jest.doMock('../src/features/messages/sync-scheduler', () => ({
    createSyncScheduler: (enabled: () => boolean, sync: () => Promise<{ more: boolean }>) => {
      const scheduler = { enabled, sync, refresh: () => { if (enabled()) void sync(); } };
      mockSchedulers.push(scheduler);
      return { ...scheduler, dispose: jest.fn() };
    },
  }));
  return {
    InboxLifecycle: require('../src/features/messages/sync-lifecycle.native').InboxLifecycle,
    runtimeFactory: require('../src/features/auth/runtime').authenticationRuntime as jest.MockedFunction<typeof import('../src/features/auth/runtime').authenticationRuntime>,
  };
}

beforeEach(() => {
  mockSchedulers.length = 0;
  mockAppState.reset();
  jest.clearAllMocks();
});

test('returning to foreground validates the saved session before resuming message sync', async () => {
  const events: string[] = [];
  let finishValidation!: () => void;
  const runtime = {
    owner: { getSnapshot: () => ({ status: 'ready' }), subscribe: () => () => {} },
    flow: {
      getSnapshot: () => ({ phase: 'ready' }),
      subscribe: () => () => {},
      restore: jest.fn(() => { events.push('validate'); return new Promise<void>(resolve => { finishValidation = resolve; }); }),
    },
    syncMessages: jest.fn(async () => { events.push('sync'); return { more: false }; }),
    syncNowPlaying: jest.fn(async () => {}),
    syncNotificationPreferences: jest.fn(async () => {}),
  } as any;
  const { InboxLifecycle, runtimeFactory } = loadLifecycle();
  runtimeFactory.mockResolvedValue(runtime);

  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<InboxLifecycle />);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(mockSchedulers).toHaveLength(2);
  runtime.syncMessages.mockClear();
  events.length = 0;

  act(() => mockAppState.emit('background'));
  await act(async () => { mockAppState.emit('active'); await Promise.resolve(); });
  expect(runtime.flow.restore).toHaveBeenCalledTimes(1);
  expect(runtime.syncMessages).not.toHaveBeenCalled();

  await act(async () => { finishValidation(); await Promise.resolve(); });
  expect(runtime.syncMessages).toHaveBeenCalledTimes(1);
  expect(events).toEqual(['validate', 'sync']);
  act(() => tree.unmount());
});
