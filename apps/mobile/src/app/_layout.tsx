import { SnackbarHost } from "@/features/feedback/snackbar";
import { StatusBar } from 'expo-status-bar';
import { usePalette } from '@/features/ui';
import { InboxLifecycle } from '@/features/messages/sync-lifecycle';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Stack, router, useSegments } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '@/features/auth/runtime';
import type { LoginSnapshot } from '@/features/auth/login-flow';
import type { AuthSnapshot } from '@/features/auth/session-owner';
import { sessionRouteDecision } from '@/features/auth/session-route-policy';
import { installNotificationNavigation } from '@/features/notifications/navigation';

const noAuth: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
const noOwner: AuthSnapshot = Object.freeze({ status: 'signed-out' });
const noop = () => () => undefined;

function NativeSessionGate({ children }: { children: ReactNode }) {
  const c = usePalette();
  const segments = useSegments();
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [runtimeState, setRuntimeState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => {
      if (!active) return;
      setRuntime(value);
      setRuntimeState('ready');
    }, () => { if (active) setRuntimeState('failed'); });
    return () => { active = false; };
  }, []);
  const flow = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noAuth), () => noAuth);
  const owner = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => noOwner), () => noOwner);
  const decision = sessionRouteDecision({
    segment: segments[0],
    runtime: runtimeState,
    authenticated: owner.status === 'ready' && flow.phase === 'ready',
    sessionChecking: owner.status === 'checking',
    development: __DEV__,
  });
  return <View style={{ flex: 1 }}>
    {children}
    {decision.kind === 'redirect' && <Redirect href={decision.href} />}
    {decision.kind !== 'allow' && <View accessibilityViewIsModal style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
      <ActivityIndicator accessibilityLabel="Checking your account" color={c.accent} />
    </View>}
  </View>;
}

export default function Layout() {
  const colors = usePalette();
  const stack = <Stack screenOptions={{ headerShown: false }} />;
  useEffect(() => {
    let active = true;
    let dispose: (() => void) | undefined;
    void import('expo-notifications').then(Notifications => {
      if (!active) return;
      dispose = installNotificationNavigation({
        addNotificationResponseReceivedListener: listener => Notifications.addNotificationResponseReceivedListener(response => listener(response)),
        getLastNotificationResponseAsync: () => Notifications.getLastNotificationResponseAsync(),
        clearLastNotificationResponseAsync: () => Notifications.clearLastNotificationResponseAsync(),
      }, () => router.replace({ pathname: '/', params: { tab: 'Chats' } }));
    }).catch(() => {});
    return () => { active = false; dispose?.(); };
  }, []);
  return <><InboxLifecycle /><StatusBar style={colors.surface === '#FFFFFF' ? 'dark' : 'light'} /><NativeSessionGate>{stack}</NativeSessionGate><SnackbarHost /></>;
}
