import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authenticationRuntime } from '../auth/runtime';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { LoginSnapshot } from '../auth/login-flow';
import type { FriendsSnapshot } from './friends-flow';
import { selectFriends } from './friends-view';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';
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
  const work = (job: () => Promise<unknown>, success?: string) => { void job().then(() => { if (success) showFeedback(success); }, error => { const code = error && typeof error.code === 'string' ? error.code : 'UNAVAILABLE'; if (code !== 'BUSY') showFeedback(messages[code] ?? messages.UNAVAILABLE); if (code === 'SESSION_REVOKED') void runtime?.flow.restore().catch(() => {}); }); };
  useEffect(() => { if (runtime && auth.phase === 'ready') { void runtime.friends.refresh(kind).catch(() => {}); if (!requests) void runtime.friends.refresh('outgoing').catch(() => {}); } }, [runtime, auth.phase, kind, requests]);
  function button(label: string, action: () => void, primary = false, disabled = false) { return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: primary ? c.accent : c.bg, opacity: disabled ? 0.55 : 1 }}><Text style={{ color: primary ? c.accent === '#066DB8' ? '#FFFFFF' : '#172027' : c.text, fontSize: 15, fontWeight: primary ? '600' : '400' }}>{label}</Text></Pressable>; }
  if (!runtime) return <View style={{ flex: 1, padding: 18, gap: 12 }}>{failed ? <>{<Text style={{ color: c.text }}>Could not open your friends.</Text>}{button('Retry', () => { setFailed(false); setAttempt(value => value + 1); })}</> : <ActivityIndicator accessibilityLabel="Loading your account" color={c.accent} />}</View>;
  if (auth.phase !== 'ready') return <View style={{ flex: 1, padding: 18, gap: 12 }}><Text style={{ color: c.text }}>{auth.phase === 'offline' ? 'Reconnect to load your friends.' : 'Sign in to connect with friends.'}</Text>{auth.phase === 'offline' ? button('Retry connection', () => work(() => runtime.flow.restore())) : button('Sign in', () => router.push('/auth'), true)}</View>;
  const list = state.lists[kind], selected = selectFriends(list, search);
  return <FlatList style={{ flex: 1 }} data={selected.items} keyExtractor={item => item.accountId} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 18 }} refreshing={list.refreshing && list.phase === 'ready'} onRefresh={() => work(() => runtime.friends.refresh(kind))}
    ListHeaderComponent={<View style={{ gap: 10, paddingBottom: 8 }}>{requests ? <Text style={{ color: c.muted, fontSize: 15 }}>Accept a request to open private chat.</Text> : <>
      <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/flow', params: { view: 'requests' } })} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Icon name="account-clock-outline" size={23} color={c.muted} /><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>Friend requests</Text><Icon name="chevron-right" size={23} color={c.muted} /></Pressable>
      <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Add someone by PIN</Text><TextInput accessibilityLabel="Friend PIN" value={state.pinDraft} onChangeText={runtime.friends.setPIN} maxLength={8} autoCapitalize="characters" autoCorrect={false} placeholder="Enter their PIN" placeholderTextColor={c.muted} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16 }} />
      {button(state.busy ? 'Sending…' : 'Send friend request', () => work(() => runtime.friends.request(), 'Friend request sent.'), true, state.busy || state.pinDraft.length !== 8)}
      {state.lists.outgoing.items.map(item => <Text key={item.accountId} style={{ color: c.muted, fontSize: 13 }}>PIN · {item.pin} · Request pending</Text>)}
      <TextInput accessibilityLabel="Search friends by PIN" value={search} onChangeText={setSearch} placeholder="Search friends by PIN" placeholderTextColor={c.muted} autoCorrect={false} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16 }} />
    </>}{list.error && button('Retry', () => work(() => runtime.friends.refresh(kind)))}</View>}
    renderItem={({ item }) => <View style={{ minHeight: 72, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><View style={{ width: 44, height: 44, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-outline" size={26} color={c.muted} /></View><View style={{ flex: 1, gap: 4 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{item.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{requests ? 'Wants to connect' : 'Accepted friend'}</Text>{requests && <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>{button('Accept', () => work(() => runtime.friends.respond(item.requestId!, true), 'Friend request accepted.'), true, state.busy)}{button('Decline', () => work(() => runtime.friends.respond(item.requestId!, false), 'Friend request declined.'), false, state.busy)}</View>}</View></View>}
    ListEmptyComponent={<View style={{ paddingVertical: 20, gap: 12 }}>{selected.state === 'loading' ? <ActivityIndicator accessibilityLabel="Loading friends" color={c.accent} /> : <Text style={{ color: c.muted, fontSize: 15 }}>{selected.state === 'no-results' ? 'No friends match this PIN.' : selected.state === 'error' ? 'Could not load this list. Please retry.' : requests ? 'No pending requests. Share your PIN to connect.' : 'No friends yet. Add someone by PIN.'}</Text>}</View>}
    ListFooterComponent={selected.canLoadMore ? button('Load more', () => work(() => runtime.friends.loadMore(kind))) : null}
  />;
}
export function NativeFriendRequests() {
  const c = usePalette();
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}><View style={{ height: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable><Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Friend requests</Text></View><NativeFriends requests /></SafeAreaView>;
}
