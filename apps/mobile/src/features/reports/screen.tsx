import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import type { ReportReason, SelectedReportMessage } from './api';

const noop = () => () => undefined;
const signedOut = Object.freeze({ status: 'signed-out' as const });
const noLogin = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
const reasons: readonly { id: ReportReason; label: string }[] = [
  { id: 'spam', label: 'Spam' }, { id: 'harassment', label: 'Harassment' },
  { id: 'scam', label: 'Scam' }, { id: 'something-else', label: 'Something else' },
];
type Choice = SelectedReportMessage & Readonly<{ own: boolean }>;
type LoadState = { key: string; items?: readonly Choice[]; failed?: true };

export function NativeConversationReport({ peer }: { peer: string }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const [load, setLoad] = useState<LoadState>();
  const [attempt, setAttempt] = useState(0);
  const [reason, setReason] = useState<ReportReason>();
  const [details, setDetails] = useState('');
  const [selectedIDs, setSelectedIDs] = useState<ReadonlySet<string>>(() => new Set());
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const requestKey = `${peer}:${attempt}`;
  const current = load?.key === requestKey ? load : undefined;

  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setRuntimeFailed(true); });
    return () => { active = false; };
  }, []);
  const login = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noLogin), () => noLogin);
  const account = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => signedOut), () => signedOut);
  const accountId = account.status === 'ready' && account.account ? account.account.id : '';

  useEffect(() => {
    if (!runtime || login.phase !== 'ready' || !accountId || !/^[A-Za-z0-9._:-]{1,128}$/.test(peer) || peer === accountId) return;
    let active = true;
    void runtime.messages.context({ targetId: peer }).then(async context => {
      await runtime.history.refresh();
      if (!active) return;
      const history = runtime.history.getSnapshot();
      if (history.phase !== 'ready') throw new Error('HISTORY_UNAVAILABLE');
      const incoming = history.incoming.filter(item => item.conversation === context.conversation && item.serverEventId && (item.contentType === undefined || item.contentType === 'text') && item.plaintext.trim());
      const outgoing = history.outgoing.filter(item => item.conversation === context.conversation && item.serverEventId && item.status !== 'queued' && (item.contentType === undefined || item.contentType === 'text') && item.plaintext.trim());
      const items = [...incoming.map(item => ({ eventId: item.serverEventId!, text: item.plaintext, own: false })), ...outgoing.map(item => ({ eventId: item.serverEventId!, text: item.plaintext, own: true }))]
        .filter(item => [...item.text].length <= 2000)
        .sort((a, b) => a.eventId.localeCompare(b.eventId));
      setLoad({ key: requestKey, items });
    }).catch(() => { if (active) setLoad({ key: requestKey, failed: true }); });
    return () => { active = false; };
  }, [runtime, login.phase, accountId, peer, requestKey]);

  const choices = useMemo(() => current?.items ?? [], [current]);
  const selected = useMemo(() => choices.filter(item => selectedIDs.has(item.eventId)), [choices, selectedIDs]);
  const canReview = !!reason && !!current?.items && !current.failed;
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  function toggle(eventId: string) {
    setSelectedIDs(previous => { const next = new Set(previous); if (next.has(eventId)) next.delete(eventId); else if (next.size < 20) next.add(eventId); return next; });
  }
  async function submit() {
    if (!runtime || !reason || !current?.items || busy) return;
    setBusy(true); setSubmitError(false);
    try {
      await runtime.reports.submit({ operationId: Crypto.randomUUID(), conversation: `private:${(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(['awsemchat.private.v1', ...[accountId, peer].sort()]))).toLowerCase()}`, subjectId: peer, reason, details, selected: selected.map(({ eventId, text }) => ({ eventId, text })) });
      showFeedback('Report sent. Selected content will be kept for 90 days.');
      back();
    } catch { setSubmitError(true); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Report conversation</Text>
    </View>
    {!runtime || login.phase !== 'ready' || account.status !== 'ready' ? <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 10 }}>{runtimeFailed ? <><Text style={{ color: c.muted }}>Could not open your account.</Text><Pressable accessibilityRole="button" onPress={() => { setRuntimeFailed(false); void authenticationRuntime().then(setRuntime, () => setRuntimeFailed(true)); }}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <><ActivityIndicator accessibilityLabel="Opening account" color={c.accent} /><Text style={{ color: c.muted }}>Sign in to report a conversation.</Text></>}</View>
      : !current ? <View style={{ padding: 24, alignItems: 'center', gap: 12 }}><ActivityIndicator accessibilityLabel="Loading messages" color={c.accent} /><Text style={{ color: c.muted }}>Loading your conversation…</Text></View>
        : current.failed ? <View style={{ padding: 24, gap: 12 }}><Text style={{ color: c.muted }}>Could not load this conversation’s messages.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}><Text style={{ color: c.accent }}>Retry</Text></Pressable></View>
          : <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 14 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>Choose a reason and select any messages you want the review team to see. Only selected messages and details below will be sent.</Text>
              {reviewing ? <>
                <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>Review before sending</Text>
                <Text style={{ color: c.text }}>Reason: {reasons.find(item => item.id === reason)?.label}</Text>
                {!!details.trim() && <Text style={{ color: c.text }}>Details: {details.trim()}</Text>}
                <Text style={{ color: c.muted }}>{selected.length} selected {selected.length === 1 ? 'message' : 'messages'}</Text>
                {selected.map(item => <View key={item.eventId} style={{ padding: 12, borderRadius: 10, backgroundColor: c.bg }}><Text style={{ color: c.muted, fontSize: 12 }}>{item.own ? 'You' : 'Friend'}</Text><Text style={{ color: c.text, marginTop: 4 }}>{item.text}</Text></View>)}
                <View style={{ padding: 13, borderRadius: 10, backgroundColor: c.bg, gap: 4 }}><Text style={{ color: c.text, fontWeight: '600' }}>Privacy and retention</Text><Text style={{ color: c.muted, lineHeight: 20 }}>The selected content is shared with AwsemChat for review and deleted after 90 days. Unselected messages and media are not included.</Text></View>
                {submitError && <Text accessibilityRole="alert" style={{ color: c.accent }}>The report wasn’t sent. Your selections are saved here; retry when you’re connected.</Text>}
                <Pressable accessibilityRole="button" accessibilityLabel="Send report" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={{ minHeight: 50, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{busy ? 'Sending…' : 'Send report'}</Text></Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => setReviewing(false)} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Edit report</Text></Pressable>
              </> : <>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Why are you reporting this conversation?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{reasons.map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: reason === item.id }} onPress={() => setReason(item.id)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: reason === item.id ? c.accent : c.bg }}><Text style={{ color: reason === item.id ? '#FFFFFF' : c.text, fontWeight: '600' }}>{item.label}</Text></Pressable>)}</View>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '600', marginTop: 4 }}>Select messages to include</Text>
                <Text style={{ color: c.muted, fontSize: 13 }}>No messages are selected automatically. Select up to 20.</Text>
                {choices.length === 0 ? <Text style={{ color: c.muted, paddingVertical: 12 }}>No text messages are available to select. You can still report the conversation with a reason.</Text> : choices.map(item => {
                  const checked = selectedIDs.has(item.eventId);
                  return <Pressable key={item.eventId} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={`${checked ? 'Remove' : 'Select'} message from ${item.own ? 'you' : 'your friend'}: ${item.text}`} onPress={() => toggle(item.eventId)} style={{ minHeight: 54, padding: 12, borderRadius: 10, flexDirection: 'row', gap: 10, backgroundColor: c.bg, alignItems: 'center' }}><Icon name={checked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={checked ? c.accent : c.muted} /><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.muted, fontSize: 12 }}>{item.own ? 'You' : 'Friend'}</Text><Text numberOfLines={4} style={{ color: c.text }}>{item.text}</Text></View></Pressable>;
                })}
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '600', marginTop: 4 }}>Additional details</Text>
                <TextInput accessibilityLabel="Additional details" value={details} onChangeText={setDetails} maxLength={1000} multiline placeholder="Add context (optional)" placeholderTextColor={c.muted} style={{ minHeight: 94, padding: 13, borderRadius: 10, backgroundColor: c.bg, color: c.text, textAlignVertical: 'top' }} />
                <Pressable accessibilityRole="button" accessibilityLabel="Review report" accessibilityState={{ disabled: !canReview }} disabled={!canReview} onPress={() => setReviewing(true)} style={{ minHeight: 50, borderRadius: 9, backgroundColor: canReview ? c.accent : c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: canReview ? '#FFFFFF' : c.muted, fontWeight: '700' }}>Review report</Text></Pressable>
              </>}
            </ScrollView>
          </View>}
  </SafeAreaView>;
}
