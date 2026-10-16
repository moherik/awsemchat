import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import type { FriendsSnapshot } from '../social/friends-flow';
import { showFeedback } from '../feedback/snackbar';
import { IdentityPanel } from './identity-panel';
import { selectPrivateProfile } from '../social/private-profile';
import { usePalette } from '../ui';
import { PrivateProfileAvatar } from '../social/private-profile-avatar';

const noop = () => () => undefined;
const signedOut = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
const signedOutOwner = Object.freeze({ status: 'signed-out' as const });
const emptyHistory = Object.freeze({ phase: 'idle' as const, incoming: Object.freeze([]), outgoing: Object.freeze([]) });
const emptyFriendList = Object.freeze({ phase: 'idle' as const, items: Object.freeze([]), refreshing: false });
const emptyFriends: FriendsSnapshot = Object.freeze({ lists: Object.freeze({ accepted: emptyFriendList, incoming: emptyFriendList, outgoing: emptyFriendList, blocked: emptyFriendList }), pinDraft: '', busy: false });

export function NativeConversationDetails({ peer }: { peer: string }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loadedContext, setLoadedContext] = useState<{ peer: string; accountId: string; generation: number; context: Awaited<ReturnType<AuthenticationRuntime['messages']['context']>> }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  const login = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => signedOut), () => signedOut);
  const owner = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => signedOutOwner), () => signedOutOwner);
  const history = useSyncExternalStore(runtime?.history.subscribe ?? noop, runtime?.history.getSnapshot ?? (() => emptyHistory), () => emptyHistory);
  const friends = useSyncExternalStore(runtime?.friends.subscribe ?? noop, runtime?.friends.getSnapshot ?? (() => emptyFriends), () => emptyFriends);
  useEffect(() => {
    if (!runtime || login.phase !== 'ready' || owner.status !== 'ready' || !owner.account?.id || !Number.isSafeInteger(owner.generation) || !peer) return;
    let active = true;
    const accountId = owner.account.id, generation = owner.generation as number;
    void runtime.messages.context({ targetId: peer }).then(value => {
      const current = runtime.owner.getSnapshot();
      if (active && current.status === 'ready' && current.account?.id === accountId && current.generation === generation) setLoadedContext({ peer, accountId, generation, context: value });
    });
    void runtime.friends.refresh('accepted').catch(() => {});
    return () => { active = false; };
  }, [runtime, login.phase, owner.status, owner.account?.id, owner.generation, peer]);

  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  const context = loadedContext?.peer === peer && loadedContext.accountId === owner.account?.id && loadedContext.generation === owner.generation ? loadedContext.context : undefined;
  const friend = friends.lists.accepted.items.find(item => item.accountId === peer);
  const profile = context ? selectPrivateProfile(history, context.conversation, context.audience) : undefined;
  const title = profile?.state === 'ready' ? profile.profile.name : friend?.pin ?? 'Private chat';
  const block = () => {
    if (!runtime || !friend || busy) return;
    Alert.alert(`Block ${friend.pin}?`, 'This removes the friendship and stops private messages and new Circle invitations. Shared Circle membership stays unchanged.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => {
        setBusy(true);
        void runtime.friends.block(peer, true).then(() => {
          showFeedback(`${friend.pin} was blocked.`);
          router.replace('/');
        }, () => showFeedback('Could not block this contact. Please retry.')).finally(() => setBusy(false));
      } },
    ]);
  };

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Conversation details</Text>
    </View>
    {!peer ? <Text style={{ padding: 20, color: c.muted }}>This conversation link is invalid.</Text>
      : !runtime ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>{failed ? <><Text style={{ color: c.muted }}>Could not open conversation details.</Text><Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Loading conversation details" color={c.accent} />}</View>
        : login.phase !== 'ready' ? <View style={{ padding: 22, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to view conversation details.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Sign in</Text></Pressable></View>
          : <ScrollView contentContainerStyle={{ padding: 18, gap: 18 }}>
            <View style={{ alignItems: 'center', paddingVertical: 14, gap: 8 }}>
              <PrivateProfileAvatar name={title} size={88} runtime={runtime} peerId={peer} requestId={friend?.requestId} avatar={profile?.state === 'ready' && profile.profile.version === 2 ? profile.profile.avatar : null} />
              <Text style={{ color: c.text, fontSize: 22, fontWeight: '600' }}>{title}</Text>
              <Text style={{ color: c.muted }}>PIN · {friend?.pin ?? 'Loading contact'}</Text>
              {profile?.state === 'ready' && profile.profile.status ? <Text style={{ color: c.muted, textAlign: 'center' }}>{profile.profile.status}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open shared media" onPress={() => router.push({ pathname: '/flow', params: { view: 'media', peer } })} style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: c.line }}>
              <Icon name="image-multiple-outline" size={22} color={c.accent} /><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>Shared media</Text><Icon name="chevron-right" size={21} color={c.muted} />
            </Pressable>
            {context ? <IdentityPanel runtime={runtime} peer={peer} /> : <Text style={{ color: c.muted }}>Loading conversation security…</Text>}
            <View style={{ gap: 8, paddingTop: 8 }}>
              <Text style={{ color: c.text, fontWeight: '600' }}>Safety</Text>
              <Text style={{ color: c.muted, lineHeight: 20 }}>Blocking removes this private friendship and prevents new Circle invitations. It does not change Circles you already share.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Report conversation" onPress={() => router.push({ pathname: '/flow', params: { view: 'report', peer } })} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Report conversation</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Block ${friend?.pin ?? 'contact'}`} accessibilityState={{ disabled: busy || !friend }} disabled={busy || !friend} onPress={block} style={{ minHeight: 48, justifyContent: 'center', opacity: busy || !friend ? 0.5 : 1 }}><Text style={{ color: '#C43D46', fontWeight: '600' }}>{busy ? 'Blocking…' : 'Block contact'}</Text></Pressable>
            </View>
          </ScrollView>}
  </SafeAreaView>;
}
