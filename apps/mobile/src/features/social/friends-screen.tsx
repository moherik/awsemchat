import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { MenuView } from '@expo/ui/community/menu';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authenticationRuntime } from '../auth/runtime';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { LoginSnapshot } from '../auth/login-flow';
import type { FriendsSnapshot } from './friends-flow';
import { selectFriends } from './friends-view';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';
import { PrivateProfileAvatar } from './private-profile-avatar';
import type { PrivateProfileSelection } from './private-profile';
const idleList = Object.freeze({ phase: 'idle' as const, items: [], refreshing: false });
const idle: FriendsSnapshot = Object.freeze({ lists: { accepted: idleList, incoming: idleList, outgoing: idleList, blocked: idleList }, pinDraft: '', busy: false });
const login: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
const noop = () => () => {};
const messages: Record<string, string> = { NETWORK: 'Could not connect. Please retry.', UNAVAILABLE: 'Could not finish. Please retry.', INVALID_INPUT: 'Enter an eight-character PIN.', DENIED: 'This request is not available.', SESSION_REVOKED: 'Your session ended. Please sign in again.', SESSION_CHANGED: 'Your account changed. Please retry.', RATE_LIMITED: 'Please wait before trying again.' };
export function NativeFriends({ requests = false }: { requests?: boolean }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0), [search, setSearch] = useState('');
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); }); return () => { active = false; }; }, [attempt]);
  const state = useSyncExternalStore(runtime?.friends.subscribe ?? noop, runtime?.friends.getSnapshot ?? (() => idle), () => idle);
  const auth = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => login), () => login);
  const kind = requests ? 'incoming' : 'accepted';
  const acceptedItems = state.lists.accepted.items;
  const acceptedCursor = state.lists.accepted.nextCursor;
  const acceptedRefreshing = state.lists.accepted.refreshing;
  const acceptedError = state.lists.accepted.error;
  const profileKey = JSON.stringify([auth.phase, acceptedItems.map(item => [item.accountId, item.requestId])]);
  const [loadedProfiles, setLoadedProfiles] = useState<{ key: string; values: Record<string, PrivateProfileSelection> }>();
  const work = (job: () => Promise<unknown>, success?: string) => { void job().then(() => { if (success) showFeedback(success); }, error => { const code = error && typeof error.code === 'string' ? error.code : 'UNAVAILABLE'; if (code !== 'BUSY') showFeedback(messages[code] ?? messages.UNAVAILABLE); if (code === 'SESSION_REVOKED') void runtime?.flow.restore().catch(() => {}); }); };
  useEffect(() => { if (runtime && auth.phase === 'ready') { void runtime.friends.refresh(kind).catch(() => {}); if (!requests) void runtime.friends.refresh('outgoing').catch(() => {}); } }, [runtime, auth.phase, kind, requests]);
  useEffect(() => {
    if (!runtime || requests || auth.phase !== 'ready') return;
    let active = true;
    void Promise.all(acceptedItems.filter(item => item.status === 'accepted' && !!item.requestId).map(async item => {
      try { return [item.accountId, await runtime.privateProfileForFriend(item.accountId, item.requestId!)] as const; }
      catch { return [item.accountId, { state: 'empty' } as const] as const; }
    })).then(entries => { if (active) setLoadedProfiles({ key: profileKey, values: Object.fromEntries(entries) }); });
    return () => { active = false; };
  }, [runtime, requests, auth.phase, profileKey, acceptedItems]);
  useEffect(() => {
    if (!runtime || requests || auth.phase !== 'ready' || !search.trim() || !acceptedCursor || acceptedRefreshing || acceptedError) return;
    const timer = setTimeout(() => { void runtime.friends.loadMore('accepted').catch(() => {}); }, 250);
    return () => clearTimeout(timer);
  }, [runtime, requests, auth.phase, search, acceptedCursor, acceptedRefreshing, acceptedError]);
  function button(label: string, action: () => void, primary = false, disabled = false) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: primary ? c.accent : c.bg, opacity: disabled ? 0.55 : 1 }}><Text style={{ color: primary ? c.accent === '#066DB8' ? '#FFFFFF' : '#172027' : c.text, fontSize: 15, fontWeight: primary ? '600' : '400' }}>{label}</Text></Pressable>; }
  if (!runtime) return <View style={{ flex: 1, padding: 18, gap: 12 }}>{failed ? <>{<Text style={{ color: c.text }}>Could not open your friends.</Text>}{button('Retry', () => { setFailed(false); setAttempt(value => value + 1); })}</> : <ActivityIndicator accessibilityLabel="Loading your account" color={c.accent} />}</View>;
  if (auth.phase !== 'ready') return <View style={{ flex: 1, padding: 18, gap: 12 }}><Text style={{ color: c.text }}>{auth.phase === 'offline' ? 'Reconnect to load your friends.' : 'Sign in to connect with friends.'}</Text>{auth.phase === 'offline' ? button('Retry connection', () => work(() => runtime.flow.restore())) : button('Sign in', () => router.push('/auth'), true)}</View>;
  const list = state.lists[kind], selected = selectFriends(list, search, item => {
    const selection = loadedProfiles?.key === profileKey ? loadedProfiles.values[item.accountId] : undefined;
    return selection?.state === 'ready' ? [selection.profile.name, selection.profile.status] : [];
  });
  return <FlatList style={{ flex: 1 }} data={selected.items} keyExtractor={item => item.accountId} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 }} refreshing={list.refreshing && list.phase === 'ready'} onRefresh={() => work(() => runtime.friends.refresh(kind))}
    ListHeaderComponent={<View style={{ gap: 10, paddingBottom: 8 }}>{requests ? <Text style={{ color: c.muted, fontSize: 15 }}>Accept a request to open private chat.</Text> : <>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/flow', params: { view: 'requests' } })} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name="account-clock-outline" size={23} color={c.muted} /><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>Friend requests</Text><Icon name="chevron-right" size={23} color={c.muted} /></Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/blocked')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name="account-cancel-outline" size={22} color={c.muted} /><Text style={{ flex: 1, color: c.text, fontSize: 15 }}>Blocked contacts</Text><Icon name="chevron-right" size={22} color={c.muted} /></Pressable>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Add someone by PIN</Text><TextInput accessibilityLabel="Friend PIN" value={state.pinDraft} onChangeText={runtime.friends.setPIN} maxLength={8} autoCapitalize="characters" autoCorrect={false} placeholder="Enter their PIN" placeholderTextColor={c.muted} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16 }} />
      {button('Your Circles', () => router.push({ pathname: '/flow', params: { view: 'circles' } }))}
      {button('Circle invitations', () => router.push({ pathname: '/flow', params: { view: 'circle-invitations' } }))}
      {button(state.busy ? 'Sending…' : 'Send friend request', () => work(() => runtime.friends.request(), 'Friend request sent.'), true, state.busy || state.pinDraft.length !== 8)}
      {state.lists.outgoing.items.map(item => <Text key={item.accountId} style={{ color: c.muted, fontSize: 13 }}>PIN · {item.pin} · Request pending</Text>)}
      <TextInput accessibilityLabel="Search friends" value={search} onChangeText={setSearch} placeholder="Search friends by name, status or PIN" placeholderTextColor={c.muted} autoCorrect={false} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16 }} />
    </>}{list.error && button('Retry', () => work(() => runtime.friends.refresh(kind)))}</View>}
    renderItem={({ item }) => {
      const selection = loadedProfiles?.key === profileKey ? loadedProfiles.values[item.accountId] : undefined;
      const profile = selection?.state === 'ready' ? selection.profile : undefined;
      const row = <Pressable accessibilityRole={requests ? undefined : "button"} accessibilityHint={requests ? undefined : 'Long press for friend actions'} onPress={requests ? undefined : () => router.push({ pathname: "/chat", params: { peer: item.accountId, pin: item.pin } })} style={{ minHeight: 72, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><PrivateProfileAvatar name={profile?.name ?? item.pin} size={44} runtime={runtime} peerId={requests ? undefined : item.accountId} requestId={requests ? undefined : item.requestId} avatar={profile?.version === 2 ? profile.avatar : null} /><View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{profile?.name ?? item.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{profile?.status || (requests ? 'Wants to connect' : 'Accepted friend')}</Text>{requests && <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>{button('Accept', () => work(() => runtime.friends.respond(item.requestId!, true), 'Friend request accepted.'), true, state.busy)}{button('Decline', () => work(() => runtime.friends.respond(item.requestId!, false), 'Friend request declined.'), false, state.busy)}</View>}</View></Pressable>;
      if (requests) return row;
      return <MenuView shouldOpenOnLongPress actions={[{ id: 'block', title: 'Block friend', image: 'nosign', attributes: { destructive: true } }]} onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event !== 'block') return;
        Alert.alert(`Block ${item.pin}?`, 'This removes the friendship and stops private messages and new Circle invitations. Shared Circle membership stays unchanged.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Block', style: 'destructive', onPress: () => work(() => runtime.friends.block(item.accountId, true), `${item.pin} was blocked.`) },
        ]);
      }}>{row}</MenuView>;
    }}
    ListEmptyComponent={<View style={{ paddingVertical: 20, gap: 12 }}>{!requests && search.trim() && (list.refreshing || loadedProfiles?.key !== profileKey) ? <><ActivityIndicator accessibilityLabel="Searching friends" color={c.accent} /><Text style={{ color: c.muted, fontSize: 15 }}>Searching your accepted friends…</Text></> : selected.state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading friends" color={c.accent} /> : <Text style={{ color: c.muted, fontSize: 15 }}>{selected.state === 'no-results' ? 'No friends match your search.' : selected.state === 'error' ? 'Could not load this list. Please retry.' : requests ? 'No pending requests. Share your PIN to connect.' : 'No friends yet. Add someone by PIN.'}</Text>}</View>}
    ListFooterComponent={selected.canLoadMore ? button('Load more', () => work(() => runtime.friends.loadMore(kind))) : null}
  />;
}
export function NativeFriendRequests() {
  const c = usePalette();
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}><View style={{ height: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable><Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Friend requests</Text></View><NativeFriends requests /></SafeAreaView>;
}

export function NativeBlockedContacts() {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); }); return () => { active = false; }; }, [attempt]);
  const state = useSyncExternalStore(runtime?.friends.subscribe ?? noop, runtime?.friends.getSnapshot ?? (() => idle), () => idle);
  const auth = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => login), () => login);
  const list = state.lists.blocked;
  const work = (job: () => Promise<unknown>, success?: string) => { void job().then(() => { if (success) showFeedback(success); }, error => { const code = error && typeof error.code === 'string' ? error.code : 'UNAVAILABLE'; if (code !== 'BUSY') showFeedback(messages[code] ?? messages.UNAVAILABLE); if (code === 'SESSION_REVOKED') void runtime?.flow.restore().catch(() => {}); }); };
  useEffect(() => { if (runtime && auth.phase === 'ready') void runtime.friends.refresh('blocked').catch(() => {}); }, [runtime, auth.phase]);
  function button(label: string, action: () => void, disabled = false) { return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 8, backgroundColor: c.bg, opacity: disabled ? .55 : 1 }}><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text></Pressable>; }
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ height: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable><Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Blocked contacts</Text></View>
    {!runtime ? <View style={{ padding: 18, gap: 12 }}>{failed ? <><Text style={{ color: c.muted }}>Could not load blocked contacts.</Text>{button('Retry', () => { setFailed(false); setAttempt(value => value + 1); })}</> : <ActivityIndicator accessibilityLabel="Loading your account" color={c.accent} />}</View>
      : auth.phase !== 'ready' ? <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to manage blocked contacts.</Text>{auth.phase === 'offline' ? button('Retry connection', () => work(() => runtime.flow.restore())) : button('Sign in', () => router.push('/auth'))}</View>
        : <FlatList style={{ flex: 1 }} data={list.items} keyExtractor={item => item.accountId} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 12, gap: 12 }} refreshing={list.refreshing} onRefresh={() => work(() => runtime.friends.refresh('blocked'))}
          ListHeaderComponent={<View style={{ gap: 8, paddingBottom: 8 }}><Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>Unblocking does not restore the friendship. A new friend request is needed to reconnect.</Text>{list.error && button('Retry', () => work(() => runtime.friends.refresh('blocked')))}</View>}
          renderItem={({ item }) => <View style={{ minHeight: 72, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><View style={{ width: 44, height: 44, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-outline" size={26} color={c.muted} /></View><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{item.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>Blocked contact</Text></View>{button(`Unblock ${item.pin}`, () => work(() => runtime.friends.block(item.accountId, false), `${item.pin} was unblocked. Send a new friend request to reconnect.`), state.busy)}</View>}
          ListEmptyComponent={<View style={{ paddingVertical: 20 }}>{list.phase === 'loading' ? <ActivityIndicator accessibilityLabel="Loading blocked contacts" color={c.accent} /> : list.phase === 'error' ? <Text style={{ color: c.muted }}>Could not load blocked contacts. Retry to try again.</Text> : <Text style={{ color: c.muted, fontSize: 15 }}>You haven’t blocked anyone.</Text>}</View>}
          ListFooterComponent={list.nextCursor ? button('Load more', () => work(() => runtime.friends.loadMore('blocked')), state.busy || list.refreshing) : null} />}
  </SafeAreaView>;
}
