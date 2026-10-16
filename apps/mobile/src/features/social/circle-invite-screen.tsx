import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { CreationButton } from './circle-creation-screen';
import type { createCircleInviteSelection } from './circle-invite-selection';
import { PrivateProfileAvatar } from './private-profile-avatar';
import type { PrivateProfileSelection } from './private-profile';
export function NativeCircleInvite({ circleId }: { circleId: string }) {
  const c = usePalette(); const [runtime, setRuntime] = useState<AuthenticationRuntime>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); }); return () => { active = false; }; }, [attempt]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}><View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 0.5, borderColor: c.line }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable><Text style={{ color: c.text, fontSize: 20, fontWeight: '600' }}>Invite friends</Text></View>{runtime ? <AccountSelection runtime={runtime} circleId={circleId} /> : <View style={{ padding: 18 }}>{failed ? <CreationButton label="Retry" action={() => { setFailed(false); setAttempt(value => value + 1); }} /> : <ActivityIndicator accessibilityLabel="Opening invitation selector" color={c.accent} />}</View>}</SafeAreaView>;
}
function AccountSelection({ runtime, circleId }: { runtime: AuthenticationRuntime; circleId: string }) {
  const c = usePalette(); const auth = useSyncExternalStore(runtime.flow.subscribe, runtime.flow.getSnapshot, runtime.flow.getSnapshot), account = useSyncExternalStore(runtime.owner.subscribe, runtime.owner.getSnapshot, runtime.owner.getSnapshot);
  if (auth.phase !== 'ready' || account.status !== 'ready') return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to invite friends.</Text><CreationButton label="Sign in" action={() => router.push('/auth')} /></View>;
  let controller: ReturnType<typeof createCircleInviteSelection>;
  try { controller = runtime.circleInviteSelection(circleId); } catch { return <Text style={{ padding: 18, color: c.muted }}>This Circle is not available.</Text>; }
  return <Selection key={`${account.account?.id}/${account.generation}/${circleId}`} runtime={runtime} controller={controller} />;
}
function Selection({ runtime, controller }: { runtime: AuthenticationRuntime; controller: ReturnType<typeof createCircleInviteSelection> }) {
  const c = usePalette(); const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const account = runtime.owner.getSnapshot();
  const profileKey = JSON.stringify([account.account?.id, account.generation, state.items.map(item => [item.accountId, item.requestId])]);
  const [loadedProfiles, setLoadedProfiles] = useState<{ key: string; values: Record<string, PrivateProfileSelection> }>();
  useEffect(() => {
    if (account.status !== 'ready' || !runtime.privateProfileForFriend) return;
    let active = true;
    const accepted = state.items.filter(item => item.status === 'accepted' && !!item.requestId);
    void Promise.all(accepted.map(async item => {
      try { return [item.accountId, await runtime.privateProfileForFriend(item.accountId, item.requestId!)] as const; }
      catch { return [item.accountId, { state: 'empty' } as const] as const; }
    })).then(entries => { if (active && runtime.owner.getSnapshot() === account) setLoadedProfiles({ key: profileKey, values: Object.fromEntries(entries) }); });
    return () => { active = false; };
  }, [runtime, account, profileKey, state.items]);
  const profiles = loadedProfiles?.key === profileKey ? loadedProfiles.values : {};
  useEffect(() => { void controller.refresh().catch(() => {}); }, [controller]);
  async function action(job: () => Promise<void>, sending = false) {
    const account = runtime.owner.getSnapshot();
    try { await job(); if (sending && runtime.owner.getSnapshot() === account) showFeedback('Invitations sent. Friends choose whether to join.'); }
    catch (error) { if (runtime.owner.getSnapshot() !== account) return; const code = error instanceof Error ? error.message : ''; showFeedback(code === 'DENIED' ? 'Only admins can invite accepted friends.' : code === 'CIRCLE_FULL' ? 'This selection exceeds the remaining Circle spaces.' : sending ? 'Unfinished invitations stay selected. Retry sending them.' : 'Could not load friends. Please retry.'); }
  }
  return <FlatList data={controller.visible()} keyExtractor={item => item.accountId} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18 }} ListHeaderComponent={<View style={{ gap: 12, paddingBottom: 12 }}><Text style={{ color: c.muted }}>{state.details ? `${state.details.memberCount}/20 members · ${state.selected.length} selected` : 'Choose accepted friends to invite.'}</Text><TextInput accessibilityLabel="Search accepted friends by PIN" value={state.search} onChangeText={controller.search} autoCapitalize="characters" placeholder="Search friends by PIN" placeholderTextColor={c.muted} style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 48 }} /><CreationButton label={state.busy ? 'Finishing…' : `Invite selected friends (${state.selected.length})`} disabled={state.busy || !state.selected.length || state.error === 'DENIED'} primary action={() => { void action(controller.send, true); }} /></View>} renderItem={({ item }) => {
    const selection = profiles[item.accountId], profile = selection?.state === 'ready' ? selection.profile : undefined;
    return <Pressable accessibilityRole="checkbox" accessibilityLabel={`Invite ${profile?.name ?? item.pin}`} accessibilityState={{ checked: state.selected.includes(item.accountId), disabled: state.busy }} disabled={state.busy} onPress={() => { try { controller.toggle(item.accountId); } catch { showFeedback('A Circle can have up to 20 members.'); } }} style={{ minHeight: 76, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><PrivateProfileAvatar name={profile?.name ?? item.pin} size={48} runtime={runtime} peerId={item.accountId} requestId={item.requestId} avatar={profile?.version === 2 ? profile.avatar : null} /><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{profile?.name ?? item.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{profile?.status || 'Accepted friend'}</Text><Text style={{ color: c.muted, fontSize: 12 }}>PIN · {item.pin}</Text></View><Icon name={state.selected.includes(item.accountId) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={state.selected.includes(item.accountId) ? c.accent : c.muted} /></Pressable>;
  }} ListEmptyComponent={state.phase === 'loading' || state.phase === 'idle' ? <ActivityIndicator accessibilityLabel="Loading accepted friends" color={c.accent} /> : <Text style={{ color: c.muted }}>{state.error ? 'Could not load invitation choices.' : state.search ? 'No matching friends.' : 'No other accepted friends on this page.'}</Text>} ListFooterComponent={<View style={{ gap: 12, paddingVertical: 12 }}>{state.error && <CreationButton label="Retry loading friends" disabled={state.busy} action={() => { void action(controller.refresh); }} />}{state.nextCursor && <CreationButton label="Load more friends" disabled={state.busy} action={() => { void action(controller.loadMore); }} />}<Text style={{ color: c.muted }}>Invitations do not reserve spaces. New members see content shared after they join.</Text></View>} />;
}
