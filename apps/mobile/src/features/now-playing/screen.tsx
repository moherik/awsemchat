import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host, Switch } from '@expo/ui';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';

type Controller = Awaited<ReturnType<AuthenticationRuntime['nowPlaying']>>;
export function NativeNowPlayingScreen() {
  const c = usePalette();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; runtime: AuthenticationRuntime; controller: Controller }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(async runtime => {
      const controller = await runtime.nowPlaying();
      await controller.load();
      if (active) { setLoaded({ attempt, runtime, controller }); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  const controller = loaded?.attempt === attempt ? loaded.controller : undefined;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? (() => () => undefined), controller?.getSnapshot ?? (() => idleSnapshot), controller?.getSnapshot ?? (() => idleSnapshot));
  const refresh = useCallback(() => {
    if (!controller) return;
    void controller.refreshPermission().then(() => controller.refreshTrack()).catch(() => undefined);
  }, [controller]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => listener.remove();
  }, [refresh]);

  const openPermissionSettings = async () => {
    if (!controller) return;
    try { await controller.openPermissionSettings(); }
    catch { showFeedback('Could not open Android notification access settings.'); }
  };
  const changeSharing = async (enabled: boolean) => {
    if (!controller) return;
    try {
      await controller.setSharing(enabled);
      if (loaded?.runtime) await loaded.runtime.syncNowPlaying().catch(() => {});
      showFeedback(enabled ? 'Now Playing sharing enabled.' : 'Now Playing sharing paused.');
    }
    catch (error) {
      if (error instanceof Error && error.message === 'NOTIFICATION_ACCESS_REQUIRED') showFeedback('Allow notification access first, then turn on sharing here.');
      else showFeedback('Could not save Now Playing settings. Please retry.');
    }
  };

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Now Playing</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 18, gap: 18 }}>
      <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>Share the song you’re listening to with accepted friends. AwsemChat reads only the active music session’s title and artist.</Text>
      <View style={{ padding: 14, borderRadius: 10, backgroundColor: c.bg, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name="shield-alert-outline" size={21} color={c.muted} />
        <Text style={{ flex: 1, color: c.muted, fontSize: 14, lineHeight: 20 }}>Android notification access is broad and can expose notifications from every app to the listener service. AwsemChat filters on this phone and uses only music-session title and artist. It does not share other notifications. Permission and sharing are separate.</Text>
      </View>
      {failed ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Could not load Now Playing. Tap to retry.</Text></Pressable> : null}
      {snapshot.phase === 'loading' ? <Text accessibilityRole="progressbar" style={{ color: c.muted }}>Checking this phone…</Text> : null}
      {snapshot.phase === 'ready' && <>
        <View style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
          <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Android notification access</Text><Text style={{ color: c.muted, fontSize: 13 }}>{snapshot.permission === 'granted' ? 'Allowed on this phone' : 'Not allowed'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open Android notification access settings" onPress={() => { void openPermissionSettings(); }} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>{snapshot.permission === 'granted' ? 'Manage' : 'Allow'}</Text></Pressable>
        </View>
        <View style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: c.line }}>
          <View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Share with accepted friends</Text><Text style={{ color: c.muted, fontSize: 13 }}>Only in private chats. Never in Circles.</Text></View>
          <Host matchContents seedColor={c.accent}><Switch testID="now-playing-share" label="Share with accepted friends" value={snapshot.sharing} disabled={snapshot.permission !== 'granted'} onValueChange={value => { void changeSharing(value); }} /></Host>
        </View>
        <View style={{ minHeight: 58, justifyContent: 'center', gap: 4 }}>
          <Text style={{ color: c.muted, fontSize: 13 }}>Currently shared</Text>
          <Text accessibilityLabel="Current song" style={{ color: c.text, fontSize: 15 }}>{snapshot.sharing && snapshot.track ? `${snapshot.track.title} · ${snapshot.track.artist}` : snapshot.sharing ? 'No active music session' : 'Sharing is off'}</Text>
        </View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const idleSnapshot = Object.freeze({ phase: 'loading' as const, permission: 'unknown' as const, sharing: false, track: null });
