import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { MenuView } from '@expo/ui/community/menu';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import type { LoginSnapshot } from '../auth/login-flow';
import type { FriendsSnapshot } from '../social/friends-flow';
import type { CircleListSnapshot } from '../social/circle-list';
import type { HistorySnapshot } from './history-store';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { projectConversations, type ConversationFilter, type ConversationRow } from './conversation-list';
import { CircleAvatarView } from '../social/circle-avatar-view';
import { PrivateProfileAvatar } from '../social/private-profile-avatar';
import type { PrivateProfileSelection } from '../social/private-profile';

const noop = () => () => undefined;
const noHistory: HistorySnapshot = Object.freeze({ phase: 'idle', incoming: [], outgoing: [] });
const idleFriendList = Object.freeze({ phase: 'idle' as const, items: [] as const, refreshing: false });
const noFriends: FriendsSnapshot = Object.freeze({ lists: Object.freeze({ accepted: idleFriendList, incoming: idleFriendList, outgoing: idleFriendList, blocked: idleFriendList }), pinDraft: '', busy: false });
const noCircles: CircleListSnapshot = Object.freeze({ phase: 'idle', items: [], busy: false });
const noAuth: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
type PreferencesController = Awaited<ReturnType<AuthenticationRuntime['conversationPreferences']>>;
const noPreferences: ReturnType<PreferencesController['getSnapshot']> = Object.freeze({ phase: 'idle', values: {} });
const filters: ConversationFilter[] = ['All', 'Private', 'Circles'];
type PreferenceKey = 'pinned' | 'muted' | 'archived';

function selectedProfile(selection?: PrivateProfileSelection) { return selection?.state === 'ready' ? selection.profile : undefined; }
function displayedName(selection: PrivateProfileSelection | undefined, fallback: string) { return selectedProfile(selection)?.name ?? fallback; }
function displayedStatus(selection: PrivateProfileSelection | undefined, fallback: string) { return selectedProfile(selection)?.status || fallback; }
function displayedAvatar(selection: PrivateProfileSelection | undefined) { const profile = selectedProfile(selection); return profile?.version === 2 ? profile.avatar : null; }

function useChatData(runtime: AuthenticationRuntime | null) {
  const auth = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noAuth), () => noAuth);
  const friends = useSyncExternalStore(runtime?.friends.subscribe ?? noop, runtime?.friends.getSnapshot ?? (() => noFriends), () => noFriends);
  const circles = useSyncExternalStore(runtime?.circles.subscribe ?? noop, runtime?.circles.getSnapshot ?? (() => noCircles), () => noCircles);
  const history = useSyncExternalStore(runtime?.history.subscribe ?? noop, runtime?.history.getSnapshot ?? (() => noHistory), () => noHistory);
  const session = runtime?.owner.getSnapshot();
  const accepted = friends.lists.accepted.items;
  const profileKey = JSON.stringify([session?.account?.id, session?.generation, auth.phase, accepted.map(item => [item.accountId, item.requestId])]);
  const [loadedProfiles, setLoadedProfiles] = useState<{ key: string; values: Record<string, PrivateProfileSelection> }>();
  useEffect(() => {
    if (!runtime || auth.phase !== 'ready' || !runtime.privateProfileForFriend) return;
    let active = true;
    void Promise.all(accepted.filter(item => item.status === 'accepted' && !!item.requestId).map(async item => {
      try { return [item.accountId, await runtime.privateProfileForFriend(item.accountId, item.requestId!)] as const; }
      catch { return [item.accountId, { state: 'empty' } as const] as const; }
    })).then(entries => { if (active) setLoadedProfiles({ key: profileKey, values: Object.fromEntries(entries) }); });
    return () => { active = false; };
  }, [runtime, auth.phase, profileKey, accepted]);
  const privateProfiles = loadedProfiles?.key === profileKey ? loadedProfiles.values : {};
  const preferenceKey = session?.account && session.generation !== undefined ? JSON.stringify([session.account.id, session.generation, auth.phase]) : '';
  const [loadedPreferences, setLoadedPreferences] = useState<{ key: string; store: PreferencesController } | null>(null);
  useEffect(() => { let active = true; if (runtime && auth.phase === 'ready') void runtime.conversationPreferences().then(value => { if (active) setLoadedPreferences({ key: preferenceKey, store: value }); }, () => { if (active) showFeedback('Could not load chat settings. Please retry.'); }); return () => { active = false; }; }, [runtime, auth.phase, preferenceKey]);
  const preferenceStore = loadedPreferences?.key === preferenceKey ? loadedPreferences.store : null;
  const preferences = useSyncExternalStore(preferenceStore?.subscribe ?? noop, preferenceStore?.getSnapshot ?? (() => noPreferences), () => noPreferences);
  return { auth, friends, circles, history, preferences, preferenceStore, privateProfiles };
}

function useRuntime() {
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [failedAttempt, setFailedAttempt] = useState(-1), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailedAttempt(attempt); }); return () => { active = false; }; }, [attempt]);
  return { runtime, failed: failedAttempt === attempt, retry: () => setAttempt(value => value + 1) };
}

export function NativeChatList() {
  const c = usePalette();
  const { runtime, failed, retry } = useRuntime();
  const { auth, friends, circles, history, preferences, preferenceStore, privateProfiles } = useChatData(runtime);
  const [filter, setFilter] = useState<ConversationFilter>('All');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!runtime || auth.phase !== 'ready') return;
    void runtime.friends.refresh('accepted').catch(() => {});
    void runtime.circles.refresh().catch(() => {});
    void runtime.syncMessages().catch(() => {});
  }, [runtime, auth.phase]);
  const rows = useMemo(() => projectConversations({
    friends: friends.lists.accepted.items,
    circles: circles.items,
    history,
    preferences: preferences.values,
    filter,
    query,
  }), [friends, circles, history, preferences.values, filter, query]);
  const setPreference = async (row: ConversationRow, key: PreferenceKey) => {
    if (!preferenceStore) return;
    const value = row[key];
    try {
      await preferenceStore.set(row.id, key, !value);
      const messages = key === 'pinned' ? (value ? 'Chat unpinned.' : 'Chat pinned.')
        : key === 'muted' ? (value ? 'Chat unmuted.' : 'Chat muted.')
          : value ? 'Chat unarchived.' : 'Chat archived.';
      showFeedback(messages);
    } catch { showFeedback('Could not save chat settings. Please retry.'); }
  };
  const open = (row: ConversationRow) => router.push({ pathname: '/chat', params: row.kind === 'private' ? { peer: row.peerId!, pin: row.title } : { circle: row.circleId! } });
  const openNew = () => router.push({ pathname: '/flow', params: { view: 'new-chat' } });
  const header = <View>
    <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderColor: c.line, paddingHorizontal: 14, gap: 10 }}>
      {filters.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)} style={{ minHeight: 44, minWidth: 72, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderBottomWidth: filter === value ? 2 : 0, borderColor: c.accent }}><Text style={{ color: filter === value ? c.accent : c.muted, fontSize: 14, fontWeight: '600' }}>{value}</Text></Pressable>)}
    </View>
    <TextInput accessibilityLabel="Search conversations" placeholder="Search chats" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} style={{ minHeight: 44, marginHorizontal: 16, marginTop: 12, paddingHorizontal: 14, borderRadius: 8, color: c.text, backgroundColor: c.bg, fontSize: 15 }} />
  </View>;
  if (!runtime) return <View style={{ flex: 1, padding: 18, justifyContent: 'center', alignItems: 'center', gap: 12 }}>{failed ? <><Text style={{ color: c.text }}>Could not open your chats.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Loading your chats" color={c.accent} />}</View>;
  if (auth.phase !== 'ready') return <View style={{ flex: 1, padding: 20, justifyContent: 'center', alignItems: 'center', gap: 12 }}><Text style={{ color: c.muted, textAlign: 'center' }}>Sign in to see your private chats and Circles.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 8, backgroundColor: c.accent }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign in</Text></Pressable></View>;
  return <View style={{ flex: 1 }}>
    <FlatList data={rows} extraData={preferences.values} keyExtractor={item => item.id} ListHeaderComponent={header} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 12 }}
      refreshing={friends.lists.accepted.phase === 'loading' || circles.phase === 'loading'} onRefresh={() => { void runtime.friends.refresh('accepted').catch(() => {}); void runtime.circles.refresh().catch(() => {}); void runtime.syncMessages().catch(() => showFeedback('Could not refresh chats. Please retry.')); }}
      ListFooterComponent={<View style={{ paddingHorizontal: 18, paddingVertical: 6, gap: 4 }}>
        {friends.lists.accepted.nextCursor && <Pressable accessibilityRole="button" onPress={() => { void runtime.friends.loadMore('accepted').catch(() => showFeedback('Could not load more friends. Please retry.')); }} style={{ minHeight: 42, justifyContent: 'center' }}><Text style={{ color: c.accent, textAlign: 'center' }}>Load more friends</Text></Pressable>}
        {circles.nextCursor && <Pressable accessibilityRole="button" onPress={() => { void runtime.circles.loadMore().catch(() => showFeedback('Could not load more Circles. Please retry.')); }} style={{ minHeight: 42, justifyContent: 'center' }}><Text style={{ color: c.accent, textAlign: 'center' }}>Load more Circles</Text></Pressable>}
      </View>}
      renderItem={({ item }) => <MenuView shouldOpenOnLongPress actions={[
        { id: 'pin', title: item.pinned ? 'Unpin chat' : 'Pin chat', image: 'pin' },
        { id: 'mute', title: item.muted ? 'Unmute chat' : 'Mute chat', image: item.muted ? 'bell' : 'bell.slash' },
        { id: 'archive', title: 'Archive chat', image: 'archivebox' },
      ]} onPressAction={({ nativeEvent }) => { if (nativeEvent.event === 'pin' || nativeEvent.event === 'mute') void setPreference(item, nativeEvent.event === 'pin' ? 'pinned' : 'muted'); else if (nativeEvent.event === 'archive') void setPreference(item, 'archived'); }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => open(item)} style={{ minHeight: 78, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
          {item.kind === 'circle' ? <CircleAvatarView runtime={runtime} circleId={item.circleId!} avatar={item.avatar} /> : <PrivateProfileAvatar name={displayedName(privateProfiles[item.peerId!], item.title)} size={52} runtime={runtime} peerId={item.peerId} requestId={friends.lists.accepted.items.find(friend => friend.accountId === item.peerId)?.requestId} avatar={displayedAvatar(privateProfiles[item.peerId!])} />}
          <View style={{ flex: 1, gap: 3 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}><Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 16, fontWeight: '600' }}>{item.kind === 'private' ? displayedName(privateProfiles[item.peerId!], item.title) : item.title}</Text>{item.pinned && <Icon name="pin" size={15} color={c.muted} />}{item.muted && <Icon name="bell-off-outline" size={15} color={c.muted} />}</View><Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>{item.kind === 'private' ? displayedStatus(privateProfiles[item.peerId!], item.subtitle) : item.subtitle}</Text><Text numberOfLines={1} style={{ color: c.text, fontSize: 14 }}>{item.preview}</Text></View>
          <View style={{ minWidth: 46, alignItems: 'flex-end', gap: 8 }}><Text style={{ color: c.muted, fontSize: 12 }}>{item.time}</Text><Icon name="chevron-right" size={20} color={c.muted} /></View>
        </Pressable>
      </MenuView>}
      ListEmptyComponent={<View style={{ padding: 22, gap: 10, alignItems: 'center' }}><Text style={{ color: c.muted, textAlign: 'center' }}>{query ? 'No chats match your search.' : friends.lists.accepted.phase === 'loading' || circles.phase === 'loading' ? 'Loading conversations…' : 'Your personal chats will appear here.'}</Text>{friends.lists.accepted.error && <Pressable accessibilityRole="button" onPress={() => void runtime.friends.refresh('accepted')}><Text style={{ color: c.accent }}>Retry</Text></Pressable>}</View>}
    />
    <Pressable accessibilityRole="button" accessibilityLabel="New conversation" onPress={openNew} style={{ position: 'absolute', right: 20, bottom: 18, width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: c.accent, elevation: 4 }}><Icon name="message-plus" size={24} color="#FFFFFF" /></Pressable>
  </View>;
}

export function NativeArchivedChats() {
  const c = usePalette();
  const { runtime, failed, retry } = useRuntime();
  const { auth, friends, circles, history, preferences, preferenceStore, privateProfiles } = useChatData(runtime);
  useEffect(() => { if (runtime && auth.phase === 'ready') { void runtime.friends.refresh('accepted').catch(() => {}); void runtime.circles.refresh().catch(() => {}); void runtime.history.refresh().catch(() => {}); } }, [runtime, auth.phase]);
  const rows = useMemo(() => projectConversations({ friends: friends.lists.accepted.items, circles: circles.items, history, preferences: preferences.values, filter: 'All', query: '', archived: 'only' }), [friends, circles, history, preferences.values]);
  if (!runtime) return <View style={{ flex: 1, padding: 18, gap: 12 }}>{failed ? <><Text style={{ color: c.text }}>Could not open archived chats.</Text><Pressable accessibilityRole="button" onPress={retry}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Loading archived chats" color={c.accent} />}</View>;
  if (auth.phase !== 'ready') return <Text style={{ color: c.muted, padding: 18 }}>Sign in to view archived chats.</Text>;
  return <FlatList data={rows} keyExtractor={row => row.id} contentContainerStyle={{ paddingHorizontal: 16 }} ListEmptyComponent={<Text style={{ color: c.muted, paddingVertical: 18 }}>No archived chats.</Text>} renderItem={({ item }) => <View style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: c.line }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={() => router.push({ pathname: '/chat', params: item.kind === 'private' ? { peer: item.peerId!, pin: item.title } : { circle: item.circleId! } })} style={{ flex: 1, minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {item.kind === 'circle' ? <CircleAvatarView runtime={runtime} circleId={item.circleId!} avatar={item.avatar} /> : <PrivateProfileAvatar name={displayedName(privateProfiles[item.peerId!], item.title)} size={44} runtime={runtime} peerId={item.peerId} requestId={friends.lists.accepted.items.find(friend => friend.accountId === item.peerId)?.requestId} avatar={displayedAvatar(privateProfiles[item.peerId!])} />}
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.text, fontWeight: '600', fontSize: 15 }}>{item.kind === 'private' ? displayedName(privateProfiles[item.peerId!], item.title) : item.title}</Text><Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>{item.preview}</Text></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={`Unarchive ${item.title}`} onPress={() => { void preferenceStore?.set(item.id, 'archived', false).then(() => showFeedback('Chat unarchived.')).catch(() => showFeedback('Could not unarchive chat. Please retry.')); }} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="archive-arrow-up-outline" size={22} color={c.muted} /></Pressable>
  </View>} />;
}

