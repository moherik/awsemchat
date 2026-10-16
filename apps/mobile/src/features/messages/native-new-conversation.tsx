import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import type { LoginSnapshot } from '../auth/login-flow';
import type { FriendsSnapshot } from '../social/friends-flow';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import type { PrivateProfileSelection } from '../social/private-profile';
import { PrivateProfileAvatar } from '../social/private-profile-avatar';

const noop = () => () => undefined;
const noLogin: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
const noHistory = Object.freeze({ phase: 'idle' as const, incoming: Object.freeze([]), outgoing: Object.freeze([]) });
const noOwner = Object.freeze({ status: 'signed-out' as const, generation: 0, account: undefined });
const noProfiles: Record<string, PrivateProfileSelection> = Object.freeze({});
const idle = Object.freeze({ phase: 'idle' as const, items: [], refreshing: false });
const noFriends: FriendsSnapshot = Object.freeze({
  lists: Object.freeze({ accepted: idle, incoming: idle, outgoing: idle, blocked: idle }), pinDraft: '', busy: false,
});

export function NativeNewConversation() {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [failedAttempt, setFailedAttempt] = useState(-1), [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const failed = failedAttempt === attempt;
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailedAttempt(attempt); });
    return () => { active = false; };
  }, [attempt]);
  const auth = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noLogin), () => noLogin);
  const friends = useSyncExternalStore(runtime?.friends.subscribe ?? noop, runtime?.friends.getSnapshot ?? (() => noFriends), () => noFriends);
  const history = useSyncExternalStore(runtime?.history.subscribe ?? noop, runtime?.history.getSnapshot ?? (() => noHistory), () => noHistory);
  const owner = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => noOwner), () => noOwner);
  const list = friends.lists.accepted;
  const query = search.trim().toLocaleLowerCase();
  useEffect(() => {
    if (!runtime || auth.phase !== 'ready' || !query || !list.nextCursor || list.refreshing || list.error) return;
    const timer = setTimeout(() => { void runtime.friends.loadMore('accepted').catch(() => {}); }, 250);
    return () => clearTimeout(timer);
  }, [runtime, auth.phase, query, list.nextCursor, list.refreshing, list.error]);
  useEffect(() => {
    if (runtime && auth.phase === 'ready') {
      void runtime.friends.refresh('accepted').catch(() => {});
      void runtime.syncMessages().catch(() => {});
    }
  }, [runtime, auth.phase]);
  const profileKey = useMemo(() => ({ accountId: owner.account?.id ?? '', generation: owner.generation, items: list.items, incoming: history.incoming, ready: auth.phase === 'ready' && history.phase === 'ready' }), [owner.account?.id, owner.generation, list.items, history.incoming, auth.phase, history.phase]);
  const [resolvedProfiles, setResolvedProfiles] = useState<{ key: typeof profileKey; values: Record<string, PrivateProfileSelection> }>();
  useEffect(() => {
    if (!runtime || !profileKey.ready || !profileKey.accountId) return;
    let active = true;
    const accepted = profileKey.items.filter(item => item.status === 'accepted' && !!item.requestId);
    void Promise.all(accepted.map(async item => {
      try { return [item.accountId, await runtime.privateProfileForFriend(item.accountId, item.requestId!)] as const; }
      catch { return [item.accountId, { state: 'empty' } as const] as const; }
    })).then(entries => { if (active) setResolvedProfiles({ key: profileKey, values: Object.fromEntries(entries) }); });
    return () => { active = false; };
  }, [runtime, profileKey]);
  const profiles = resolvedProfiles?.key === profileKey ? resolvedProfiles.values : noProfiles;
  const visible = list.items.filter(item => {
    if (item.status !== 'accepted') return false;
    if (!query || item.pin.toLocaleLowerCase().includes(query)) return true;
    const profile = profiles[item.accountId];
    return profile?.state === 'ready' && profile.profile.name.toLocaleLowerCase().includes(query);
  });
  const retry = () => setAttempt(value => value + 1);
  const openCircleCreation = () => router.push({ pathname: '/flow', params: { view: 'circle' } });
  const openChat = (peer: string, pin: string) => router.push({ pathname: '/chat', params: { peer, pin } });
  const createCircleRow = <Pressable accessibilityRole="button" accessibilityLabel="Create a Circle" onPress={openCircleCreation} style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
    <View style={{ width: 46, height: 46, borderRadius: 13, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-multiple-plus-outline" size={25} color={c.accent} /></View>
    <Text style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>Create a Circle</Text><Icon name="chevron-right" size={22} color={c.muted} />
  </Pressable>;
  const listHeader = <View style={{ paddingBottom: 8 }}>
    {createCircleRow}
    <Text style={{ color: c.muted, fontSize: 14, marginTop: 16, marginBottom: 8 }}>Accepted friends</Text>
    <TextInput accessibilityLabel="Search accepted friends" value={search} onChangeText={setSearch} placeholder="Search by name or PIN" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 15 }} />
  </View>;
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ height: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>New conversation</Text>
    </View>
    {!runtime ? <View style={{ flex: 1, padding: 18, alignItems: 'center', justifyContent: 'center', gap: 12 }}>{failed ? <><Text style={{ color: c.text }}>Could not open your friends.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Loading your account" color={c.accent} />}</View>
      : auth.phase !== 'ready' ? <View style={{ flex: 1, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 12 }}><Text style={{ color: c.muted, textAlign: 'center' }}>{auth.phase === 'offline' ? 'Reconnect to load accepted friends.' : 'Sign in to start a conversation.'}</Text>{auth.phase === 'offline' ? <Pressable accessibilityRole="button" onPress={() => void runtime.flow.restore().catch(() => showFeedback('Could not reconnect. Please retry.'))}><Text style={{ color: c.accent }}>Retry connection</Text></Pressable> : <Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 8, backgroundColor: c.accent }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign in</Text></Pressable>}</View>
      : <FlatList data={visible} keyExtractor={item => item.accountId} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 }} ListHeaderComponent={listHeader} refreshing={list.refreshing} onRefresh={() => void runtime.friends.refresh('accepted').catch(() => showFeedback('Could not refresh friends. Please retry.'))}
        renderItem={({ item }) => {
          const selection = profiles[item.accountId];
          const profile = selection?.state === 'ready' ? selection.profile : undefined;
          return <Pressable accessibilityRole="button" accessibilityLabel={`Start a chat with ${item.pin}`} onPress={() => openChat(item.accountId, item.pin)} style={{ minHeight: 72, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
            <PrivateProfileAvatar name={profile?.name ?? item.pin} size={46} runtime={runtime} peerId={item.accountId} requestId={item.requestId} avatar={profile?.version === 2 ? profile.avatar : null} />
            <View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{profile?.name ?? item.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{profile?.status || 'Accepted friend'}</Text><Text style={{ color: c.muted, fontSize: 12 }}>PIN · {item.pin}</Text></View>
            <Icon name="chevron-right" size={22} color={c.muted} />
          </Pressable>;
        }}
        ListEmptyComponent={<View style={{ paddingVertical: 20, gap: 12 }}>{query && list.refreshing ? <><ActivityIndicator accessibilityLabel="Searching remaining friends" color={c.accent} /><Text style={{ color: c.muted, fontSize: 15 }}>Searching the rest of your accepted friends…</Text></> : list.phase === 'loading' ? <ActivityIndicator accessibilityLabel="Loading accepted friends" color={c.accent} /> : <Text style={{ color: c.muted, fontSize: 15 }}>{query ? 'No accepted friends match your search.' : list.error ? 'Could not load accepted friends.' : 'No accepted friends yet. Add someone by PIN.'}</Text>}{list.error && <Pressable accessibilityRole="button" onPress={() => void runtime.friends.refresh('accepted').catch(() => {})}><Text style={{ color: c.accent }}>Retry</Text></Pressable>}</View>}
        ListFooterComponent={list.nextCursor ? <Pressable accessibilityRole="button" accessibilityLabel="Load more friends" onPress={() => void runtime.friends.loadMore('accepted').catch(() => showFeedback('Could not load more friends. Please retry.'))} style={{ minHeight: 46, justifyContent: 'center' }}><Text style={{ color: c.accent, textAlign: 'center' }}>Load more friends</Text></Pressable> : null}
      />}
  </SafeAreaView>;
}
