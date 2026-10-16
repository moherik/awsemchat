import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';
import { CreationButton } from './circle-creation-screen';

export function NativeSavedCircleUpdates() {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Saved Circle updates</Text>
    </View>
    {runtime ? <SavedRows runtime={runtime} /> : <View style={{ padding: 18 }}>{failed ? <CreationButton label="Retry opening saved updates" action={() => { setFailed(false); setAttempt(value => value + 1); }} /> : <ActivityIndicator accessibilityLabel="Opening saved updates" color={c.accent} />}</View>}
  </SafeAreaView>;
}
function SavedRows({ runtime }: { runtime: AuthenticationRuntime }) {
  const c = usePalette();
  const auth = useSyncExternalStore(runtime.flow.subscribe, runtime.flow.getSnapshot, runtime.flow.getSnapshot);
  const account = useSyncExternalStore(runtime.owner.subscribe, runtime.owner.getSnapshot, runtime.owner.getSnapshot);
  const saved = useSyncExternalStore(runtime.savedCircleUpdates.subscribe, runtime.savedCircleUpdates.getSnapshot, runtime.savedCircleUpdates.getSnapshot);
  const ready = auth.phase === 'ready' && account.status === 'ready';
  const refresh = useCallback(() => {
    if (!ready) return;
    const bound = runtime.owner.getSnapshot();
    void runtime.savedCircleUpdates.refresh().catch(() => { if (runtime.owner.getSnapshot() === bound && runtime.flow.getSnapshot().phase === 'ready') showFeedback('Could not open your saved updates. Please retry.'); });
  }, [ready, runtime]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  if (!ready) return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to open your saved updates.</Text><CreationButton label="Sign in" action={() => router.push('/auth')} /></View>;
  return <FlatList data={saved.items} keyExtractor={item => item.operation} refreshing={saved.phase === 'loading'} onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18 }}
    ListHeaderComponent={<Text style={{ color: c.muted, fontSize: 14, paddingVertical: 16 }}>Review updates that haven’t finished sending, including Circles you’ve left.</Text>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Review saved update for ${item.name}`} onPress={() => router.push({ pathname: '/flow', params: { view: 'members', circle: item.circleId } })} style={{ minHeight: 76, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
      <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="content-save-outline" size={24} color={c.muted} /></View>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text><Text style={{ color: c.muted, fontSize: 13 }}>Pending Circle update</Text></View><Icon name="chevron-right" size={22} color={c.muted} />
    </Pressable>}
    ListEmptyComponent={saved.phase === 'loading' ? <ActivityIndicator accessibilityLabel="Loading saved updates" color={c.accent} /> : <View style={{ gap: 12 }}><Text style={{ color: c.muted }}>{saved.phase === 'error' ? 'Could not read saved updates. They remain on this phone.' : 'No pending Circle updates.'}</Text>{saved.phase === 'error' && <CreationButton label="Retry" action={refresh} />}</View>} />;
}
