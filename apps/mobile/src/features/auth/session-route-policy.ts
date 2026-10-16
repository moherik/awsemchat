type RouteState = {
  segment?: string;
  runtime: 'loading' | 'ready' | 'failed';
  authenticated: boolean;
  sessionChecking?: boolean;
  development: boolean;
};

export type SessionRouteDecision = { kind: 'allow' } | { kind: 'loading' } | { kind: 'redirect'; href: '/' | '/auth' };

const developmentProbes = new Set([
  'durable-crypto-probe',
  'native-auth-probe',
  'native-backup-probe',
  'native-crypto-probe',
  'native-storage-probe',
]);

export function sessionRouteDecision(state: RouteState): SessionRouteDecision {
  if (state.development && developmentProbes.has(state.segment ?? '')) return { kind: 'allow' };
  if (state.sessionChecking) return { kind: 'loading' };
  if (state.segment === 'auth') return state.authenticated ? { kind: 'redirect', href: '/' } : { kind: 'allow' };
  if (state.authenticated) return { kind: 'allow' };
  if (state.runtime === 'loading') return { kind: 'loading' };
  return { kind: 'redirect', href: '/auth' };
}
