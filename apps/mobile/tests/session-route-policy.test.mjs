import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionRouteDecision } from '../src/features/auth/session-route-policy.ts';

const base = { runtime: 'ready', authenticated: false, development: false };

test('native protected routes wait for restored session state, then send unsigned users to sign-in', () => {
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'chat', runtime: 'loading' }), { kind: 'loading' });
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'chat' }), { kind: 'redirect', href: '/auth' });
});

test('sign-in remains reachable until authentication is ready and then returns to Chats', () => {
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'auth' }), { kind: 'allow' });
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'auth', authenticated: true }), { kind: 'redirect', href: '/' });
});

test('only authenticated sessions can use protected routes', () => {
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'chat', authenticated: true }), { kind: 'allow' });
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'chat' }), { kind: 'redirect', href: '/auth' });
});

test('developer probes stay reachable in development but require sign-in in release builds', () => {
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'native-crypto-probe', development: true }), { kind: 'allow' });
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'native-crypto-probe' }), { kind: 'redirect', href: '/auth' });
});

test('protected content stays covered while a saved session is being revalidated', () => {
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'chat', authenticated: true, sessionChecking: true }), { kind: 'loading' });
  assert.deepEqual(sessionRouteDecision({ ...base, segment: 'auth', authenticated: false, sessionChecking: true }), { kind: 'loading' });
});
