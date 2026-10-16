import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { selectFriends } from './friends-view';
import { decodeCircleProfile } from './circle-profile';
import type { PendingCircleCreation } from './circle-creation';
import { creationFailure } from './circle-creation-feedback';

type Controller = Awaited<ReturnType<AuthenticationRuntime['circleCreation']>>;
export function NativeCircleCreation() {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Create a Circle</Text>
    </View>
    {runtime ? <AccountForm runtime={runtime} /> : <View style={{ padding: 18 }}>{failed ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} style={{ minHeight: 48 }}><Text style={{ color: c.accent }}>Retry opening Circle creation</Text></Pressable> : <ActivityIndicator accessibilityLabel="Opening Circle creation" color={c.accent} />}</View>}
  </SafeAreaView>;
}
function AccountForm({ runtime }: { runtime: AuthenticationRuntime }) {
  const c = usePalette();
  const auth = useSyncExternalStore(runtime.flow.subscribe, runtime.flow.getSnapshot, runtime.flow.getSnapshot);
  const account = useSyncExternalStore(runtime.owner.subscribe, runtime.owner.getSnapshot, runtime.owner.getSnapshot);
  if (auth.phase !== 'ready') return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to create a Circle.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 48 }}><Text style={{ color: c.accent }}>Sign in</Text></Pressable></View>;
  return <CreationForm key={`${account.account?.id}/${account.generation}`} runtime={runtime} />;
}
function CreationForm({ runtime }: { runtime: AuthenticationRuntime }) {
  const c = usePalette();
  const [controller, setController] = useState<Controller>();
  const [pending, setPending] = useState<PendingCircleCreation>();
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [name, setName] = useState(''), [description, setDescription] = useState(''), [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const active = useRef(true), working = useRef(false);
  const contacts = useSyncExternalStore(runtime.friends.subscribe, runtime.friends.getSnapshot, runtime.friends.getSnapshot);
  const list = contacts.lists.accepted, rows = selectFriends(list, search).items;
  useEffect(() => {
    active.current = true;
    let current = true;
    void runtime.circleCreation().then(async value => {
      const saved = await value.pending();
      if (!current) return;
      setPending(saved); setController(value); setFailed(false);
    }).catch(() => { if (current) setFailed(true); });
    void runtime.friends.refresh('accepted').catch(() => {});
    return () => { current = false; active.current = false; };
  }, [runtime, attempt]);
  async function create(withoutInvitations = false) {
    if (!controller || working.current) return;
    working.current = true; setBusy(true);
    try {
      if (withoutInvitations && pending?.circleId) await controller.finishWithoutInvitations(pending.circleId);
      else if (pending) await controller.resume();
      else await controller.start({ name, description, avatar: null, invitees: selected });
      const saved = await controller.pending();
      if (active.current) { setPending(saved); setConfirmFinish(false); showFeedback(withoutInvitations ? 'Circle ready. Remaining invitations skipped.' : 'Circle created. Invitations sent.'); }
      await Promise.allSettled([runtime.history.refresh(), runtime.circles.refresh()]);
    } catch (error) {
      if (active.current) {
        let saved: PendingCircleCreation | undefined;
        let readable = true;
        try { saved = await controller.pending(); } catch { readable = false; }
        if (active.current) {
          setPending(saved);
          if (!readable) setFailed(true);
          showFeedback(creationFailure(error, saved !== undefined, readable).message);
        }
      }
    } finally { working.current = false; if (active.current) setBusy(false); }
  }
  async function open() {
    if (!controller || !pending?.completed || !pending.circleId || working.current) return;
    working.current = true; setBusy(true);
    try {
      const saved = await controller.pending();
      if (!active.current || !saved?.completed || saved.circleId !== pending.circleId) return;
      router.replace({ pathname: '/chat', params: { circle: saved.circleId } });
      await controller.acknowledge(saved.circleId);
    } catch { if (active.current) showFeedback('Could not open your Circle. Please retry.'); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  if (failed) return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Could not open your saved Circle creation.</Text><CreationButton label="Retry" action={() => { setFailed(false); setController(undefined); setAttempt(value => value + 1); }} /></View>;
  if (!controller) return <ActivityIndicator accessibilityLabel="Loading saved Circle creation" color={c.accent} style={{ margin: 18 }} />;
  if (pending) {
    const profile = decodeCircleProfile(pending.payload);
    return <View style={{ padding: 18, gap: 16 }}>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600' }}>{profile?.name ?? 'Your Circle'}</Text>
      <Text style={{ color: c.muted }}>{pending.completed ? 'Your Circle is ready. Open it to start chatting.' : 'Finish creating this Circle using your saved choices. Already completed steps won’t be repeated.'}</Text>
      <Text style={{ color: c.muted }}>{pending.invitees.length} friends selected</Text>
      {confirmFinish && !pending.completed ? <>
        <Text style={{ color: c.text }}>Keep this Circle and stop retrying invitations? Invitations already sent will stay active. You can invite other friends later.</Text>
        <CreationButton label={busy ? 'Finishing…' : 'Keep Circle and finish'} action={() => { void create(true); }} primary disabled={busy} />
        <CreationButton label="Go back" action={() => setConfirmFinish(false)} disabled={busy} />
      </> : <>
        <CreationButton label={pending.completed ? 'Open Circle' : busy ? 'Resuming…' : 'Resume creation'} action={() => { void (pending.completed ? open() : create()); }} primary disabled={busy} />
        {pending.profileSent && !pending.completed && <CreationButton label="Finish without remaining invitations" action={() => setConfirmFinish(true)} disabled={busy} />}
      </>}
    </View>;
  }
  return <FlatList data={rows} keyExtractor={item => item.accountId} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18 }}
    ListHeaderComponent={<View style={{ gap: 12, paddingBottom: 12 }}>
      <Text style={{ color: c.text }}>Circle name</Text><TextInput accessibilityLabel="Circle name" editable={!busy} value={name} onChangeText={setName} placeholder="Name your Circle" placeholderTextColor={c.muted} style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 48 }} />
      <Text style={{ color: c.text }}>Description</Text><TextInput accessibilityLabel="Circle description" editable={!busy} value={description} onChangeText={setDescription} multiline placeholder="What brings you together?" placeholderTextColor={c.muted} style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top' }} />
      <CreationButton label={busy ? 'Creating…' : 'Create Circle'} action={() => { void create(); }} primary disabled={busy || !name.trim()} />
      <Text style={{ color: c.muted }}>Invite accepted friends · {selected.length + 1}/20 people</Text>
      <TextInput accessibilityLabel="Search accepted friends by PIN" editable={!busy} value={search} onChangeText={setSearch} placeholder="Search friends by PIN" placeholderTextColor={c.muted} autoCapitalize="characters" style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 48 }} />
    </View>}
    renderItem={({ item }) => { const checked = selected.includes(item.accountId); return <Pressable accessibilityRole="checkbox" accessibilityLabel={`Invite ${item.pin}`} accessibilityState={{ checked, disabled: busy }} disabled={busy} onPress={() => { if (!checked && selected.length === 19) { showFeedback('A Circle can have up to 20 people, including you.'); return; } setSelected(values => checked ? values.filter(value => value !== item.accountId) : [...values, item.accountId]); }} style={{ minHeight: 72, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-outline" size={26} color={c.muted} /></View><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>{item.pin}</Text><Icon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={checked ? c.accent : c.muted} /></Pressable>; }}
    ListEmptyComponent={list.phase === 'loading' || list.phase === 'idle' ? <ActivityIndicator accessibilityLabel="Loading accepted friends" color={c.accent} /> : <Text style={{ color: c.muted }}>{list.error ? 'Could not load your friends.' : search ? 'No matching friends.' : 'No accepted friends yet. You can invite friends later.'}</Text>}
    ListFooterComponent={<View style={{ paddingVertical: 12, gap: 12 }}>{list.error && <CreationButton label="Retry loading friends" action={() => { void runtime.friends.refresh('accepted').catch(() => showFeedback('Could not load friends. Please retry.')); }} disabled={list.refreshing || busy} />}{list.nextCursor && <CreationButton label="Load more friends" action={() => { void runtime.friends.loadMore('accepted').catch(() => showFeedback('Could not load more friends. Please retry.')); }} disabled={list.refreshing || busy} />}<Text style={{ color: c.muted }}>Friends choose whether to join. New members see messages and Moments shared after they join.</Text></View>} />;
}

export function CreationButton({ label, action, primary = false, disabled = false }: { label: string; action(): void; primary?: boolean; disabled?: boolean }) {
  const c = usePalette();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: primary ? c.accent : c.bg, opacity: disabled ? 0.55 : 1 }}><Text style={{ color: primary ? c.accent === '#066DB8' ? '#FFFFFF' : '#172027' : c.text, fontSize: 15, fontWeight: '600' }}>{label}</Text></Pressable>;
}
