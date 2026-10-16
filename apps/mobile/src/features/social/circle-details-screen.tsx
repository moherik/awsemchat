import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { CreationButton } from './circle-creation-screen';
import type { CircleProfile } from './circle-profile';
import type { createCircleDetails } from './circle-details';
import { CircleMembershipActions } from './circle-membership-screen';
import { CircleAvatarView } from './circle-avatar-view';
import { CircleAvatarControls } from './circle-avatar-controls';

const noop = () => () => undefined;
const emptyPreferences = Object.freeze({ phase: 'ready' as const, values: Object.freeze({}) });

export function NativeCircleDetails({ circleId }: { circleId: string }) {
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
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Circle details</Text>
    </View>
    {runtime ? <AccountDetails runtime={runtime} circleId={circleId} /> : <View style={{ padding: 18 }}>{failed ? <CreationButton label="Retry opening Circle details" action={() => { setFailed(false); setAttempt(value => value + 1); }} /> : <ActivityIndicator accessibilityLabel="Opening Circle details" color={c.accent} />}</View>}
  </SafeAreaView>;
}
function AccountDetails({ runtime, circleId }: { runtime: AuthenticationRuntime; circleId: string }) {
  const c = usePalette();
  const auth = useSyncExternalStore(runtime.flow.subscribe, runtime.flow.getSnapshot, runtime.flow.getSnapshot);
  const account = useSyncExternalStore(runtime.owner.subscribe, runtime.owner.getSnapshot, runtime.owner.getSnapshot);
  if (auth.phase !== 'ready' || account.status !== 'ready') return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Sign in to open Circle details.</Text><CreationButton label="Sign in" action={() => router.push('/auth')} /></View>;
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(circleId) || circleId === '.' || circleId === '..') return <Text style={{ color: c.muted, padding: 18 }}>This Circle link is invalid.</Text>;
  let controller: ReturnType<typeof createCircleDetails>;
  try { controller = runtime.circleDetails(circleId); }
  catch { return <View style={{ padding: 18, gap: 12 }}><Text style={{ color: c.muted }}>Your account is not ready to open these details.</Text><CreationButton label="Open sign in" action={() => router.push('/auth')} /></View>; }
  return <Details key={`${account.account?.id}/${account.generation}/${circleId}`} runtime={runtime} controller={controller} circleId={circleId} />;
}
function Details({ runtime, controller, circleId }: { runtime: AuthenticationRuntime; controller: ReturnType<typeof createCircleDetails>; circleId: string }) {
  const c = usePalette();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [preferenceStore, setPreferenceStore] = useState<Awaited<ReturnType<AuthenticationRuntime['conversationPreferences']>> | null>(null);
  const [preferenceError, setPreferenceError] = useState(false), [preferenceBusy, setPreferenceBusy] = useState(false);
  const preferences = useSyncExternalStore(preferenceStore?.subscribe ?? noop, preferenceStore?.getSnapshot ?? (() => emptyPreferences), () => emptyPreferences);
  useEffect(() => { void controller.refresh().catch(() => {}); }, [controller]);
  useEffect(() => { let active = true; void runtime.conversationPreferences().then(value => { if (active) { setPreferenceStore(value); setPreferenceError(false); } }, () => { if (active) setPreferenceError(true); }); return () => { active = false; }; }, [runtime, circleId]);
  const [syncing, setSyncing] = useState(false);
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  async function recover() {
    const account = runtime.owner.getSnapshot();
    try {
      const outcome = await controller.recover();
      if (runtime.owner.getSnapshot() !== account) return;
      setConfirmRecovery(false); showFeedback(outcome === 'committed' ? 'This update was already sent and has been kept.' : 'The pending update was cancelled. Refresh to edit Circle details.');
      await runtime.history.refresh();
    } catch { if (runtime.owner.getSnapshot() === account) showFeedback('Could not resolve this update. It is kept for retry.'); }
  }
  async function refresh() {
    if (syncing || state.busy) return;
    setSyncing(true);
    try { await action(async () => { await runtime.inbox.sync(); await controller.refresh(); }); }
    finally { setSyncing(false); }
  }
  async function loadPreferences() {
    setPreferenceError(false);
    try { const value = await runtime.conversationPreferences(); setPreferenceStore(value); }
    catch { setPreferenceError(true); }
  }
  async function toggleCircleMute() {
    if (!preferenceStore || preferenceBusy || preferences.phase !== 'ready') return;
    const account = runtime.owner.getSnapshot();
    const muted = preferences.values[`circle:${circleId}`]?.muted === true;
    setPreferenceBusy(true);
    try {
      await preferenceStore.set(`circle:${circleId}`, 'muted', !muted);
      if (runtime.owner.getSnapshot() === account) showFeedback(!muted ? 'Circle notifications muted.' : 'Circle notifications unmuted.');
    } catch {
      if (runtime.owner.getSnapshot() === account) showFeedback('Could not update Circle notifications. Please retry.');
    } finally {
      if (runtime.owner.getSnapshot() === account) setPreferenceBusy(false);
    }
  }
  async function action(job: () => Promise<void>, saved = false) {
    const account = runtime.owner.getSnapshot();
    const currentAccount = () => runtime.owner.getSnapshot() === account && runtime.flow.getSnapshot().phase === 'ready';
    try {
      await job();
      if (saved && currentAccount()) showFeedback('Circle details saved.');
    } catch {
      if (!currentAccount()) return;
      const current = controller.getSnapshot();
      if (current.error === 'SESSION_CHANGED') return;
      showFeedback(current.pending ? 'Your saved update is kept. Retry that update.' : current.error === 'PROFILE_STALE' ? 'Circle details changed. Refresh before editing.' : current.error === 'INVALID_PROFILE' ? 'Check the Circle name and description.' : current.error === 'DENIED' ? 'Only Circle admins can edit these details.' : 'Could not finish. Refresh Circle details and retry.');
    } finally {
      if (saved && currentAccount()) await runtime.history.refresh().catch(() => {});
    }
  }
  const accepted = state.profile?.state === 'ready' ? state.profile : undefined;
  const savedUpdate = state.pending ? <View style={{ gap: 12 }}><Text style={{ color: c.text, fontWeight: '600' }}>Saved update</Text><Text style={{ color: c.text }}>{state.pending.profile.name}</Text><Text style={{ color: c.muted }}>{state.pending.profile.description}</Text><Text style={{ color: c.muted }}>Retry this update before making another change.</Text><CreationButton label={state.busy ? 'Retrying…' : 'Retry saved update'} disabled={state.busy || syncing} primary action={() => { void action(controller.retry, true); }} />{confirmRecovery ? <><Text style={{ color: c.text }}>Cancel this pending change? If it was already sent, it will be kept.</Text><CreationButton label={state.busy ? 'Resolving update…' : 'Confirm cancellation'} disabled={state.busy || syncing} action={() => { void recover(); }} /><CreationButton label="Keep pending update" disabled={state.busy || syncing} action={() => setConfirmRecovery(false)} /></> : <CreationButton label="Cancel saved update" disabled={state.busy || syncing} action={() => setConfirmRecovery(true)} />}</View> : null;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 16 }}>
      {savedUpdate}
      {!state.details ? state.busy ? <ActivityIndicator accessibilityLabel="Loading Circle details" color={c.accent} /> : <><Text style={{ color: c.muted }}>Could not load this Circle.</Text><CreationButton label="Retry" action={() => { void action(controller.refresh); }} /></> : <>
        <View style={{ alignItems: 'center', gap: 12 }}><CircleAvatarView runtime={runtime} circleId={circleId} avatar={accepted?.profile.avatar ?? null} size={80} /><Text style={{ color: c.text, fontSize: 22, fontWeight: '600' }}>{accepted?.profile.name ?? 'Circle'}</Text><Text style={{ color: c.muted }}>{state.details.memberCount}/20 members</Text></View>
        {state.details.members.some(member => member.accountId === runtime.owner.getSnapshot().account?.id && member.role === 'admin') && <CircleAvatarControls runtime={runtime} circleId={circleId} controller={controller} />}
        {!state.pending && (accepted ? <ProfileForm key={accepted.revision} profile={accepted.profile} disabled={state.busy || syncing || !state.canEdit} save={input => { void action(() => controller.update(accepted.revision, input), true); }} /> : <Text style={{ color: c.muted }}>The encrypted Circle profile is not available on this phone yet.</Text>)}
        {!state.canEdit && !state.pending && <Text style={{ color: c.muted }}>{state.details.members.some(member => member.accountId === runtime.owner.getSnapshot().account?.id && member.role === 'admin') ? 'Refresh to get the latest details before editing.' : 'Only admins can edit the Circle name and description.'}</Text>}
        <CreationButton label={state.busy || syncing ? 'Refreshing…' : 'Refresh details'} disabled={state.busy || syncing} action={() => { void refresh(); }} />
        <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 0.5, borderColor: c.line }}>
          <Text style={{ color: c.text, fontWeight: '600' }}>Notifications</Text>
          <Text style={{ color: c.muted, lineHeight: 20 }}>Mute message alerts from this Circle on this device.</Text>
          {preferenceError ? <CreationButton label="Retry loading notification settings" action={() => { void loadPreferences(); }} /> : <CreationButton label={preferences.values[`circle:${circleId}`]?.muted ? 'Unmute Circle' : 'Mute Circle'} disabled={!preferenceStore || preferences.phase !== 'ready' || preferenceBusy} action={() => { void toggleCircleMute(); }} />}
        </View>
      </>}
      <CircleMembershipActions runtime={runtime} circleId={circleId} details={state.details} refresh={controller.refresh} />
    </ScrollView>
  </KeyboardAvoidingView>;
}
function ProfileForm({ profile, disabled, save }: { profile: CircleProfile; disabled: boolean; save(input: { name: string; description: string; avatar: CircleProfile['avatar'] }): void }) {
  const c = usePalette();
  const [name, setName] = useState(profile.name), [description, setDescription] = useState(profile.description);
  return <View style={{ gap: 12 }}>
    <Text style={{ color: c.text }}>Circle name</Text><TextInput accessibilityLabel="Circle name" editable={!disabled} value={name} onChangeText={setName} style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 48 }} />
    <Text style={{ color: c.text }}>Description</Text><TextInput accessibilityLabel="Circle description" editable={!disabled} value={description} onChangeText={setDescription} multiline style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, padding: 12, minHeight: 80, textAlignVertical: 'top' }} />
    <CreationButton label="Save changes" primary disabled={disabled || !name.trim() || (name.trim() === profile.name && description === profile.description)} action={() => save({ name, description, avatar: profile.avatar })} />
  </View>;
}
