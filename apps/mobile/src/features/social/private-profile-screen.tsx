import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { toByteArray } from 'base64-js';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import type { createPrivateProfileFlow, PrivateProfileSnapshot } from './private-profile-flow';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { PrivateProfileAvatar } from './private-profile-avatar';

const noop = () => () => undefined;
const noLogin = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
const noAccount = Object.freeze({ status: 'signed-out' as const });
const noProfile: PrivateProfileSnapshot = Object.freeze({ phase: 'idle', profile: Object.freeze({ version: 1, revision: 0, name: '', status: '' }), avatar: null, busy: false, sharePending: false });
type ProfileController = ReturnType<typeof createPrivateProfileFlow>;

export function NativePrivateProfile({ mode = 'edit' }: { mode?: 'edit' | 'home' }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  const login = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noLogin), () => noLogin);
  const account = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => noAccount), () => noAccount);
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    {mode === 'edit' && <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Your profile</Text>
    </View>}
    {!runtime ? <View style={{ padding: 20, alignItems: 'center', gap: 12 }}>{failed ? <><Text style={{ color: c.muted }}>Could not open your profile.</Text><Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Opening your profile" color={c.accent} />}</View>
      : login.phase !== 'ready' || account.status !== 'ready' ? <View style={{ padding: 22, alignItems: 'center', gap: 12 }}><Text style={{ color: c.muted, textAlign: 'center' }}>Sign in to edit your profile.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 8, backgroundColor: c.accent }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign in</Text></Pressable></View>
        : mode === 'home' ? <AccountHome runtime={runtime} pin={account.account?.pin ?? ''} /> : <ProfileEditor key={`${account.account?.id}:${account.generation}`} runtime={runtime} />}
  </SafeAreaView>;
}

export function NativeSettings() {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime | null>(null);
  const [runtimeLoad, setRuntimeLoad] = useState<'loading' | 'ready' | 'error'>('loading');
  const [runtimeAttempt, setRuntimeAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) { setRuntime(value); setRuntimeLoad('ready'); } }, () => { if (active) setRuntimeLoad('error'); }); return () => { active = false; }; }, [runtimeAttempt]);
  const open = (view: string) => view === 'stickers'
    ? router.push({ pathname: '/stickers', params: { mode: 'library' } })
    : router.push({ pathname: '/flow', params: { view } });
  const rows = [
    ['Appearance', 'theme-light-dark', 'appearance'],
    ['Edit profile', 'account-edit-outline', 'profile'],
    ['Friend requests', 'account-clock-outline', 'requests'],
    ['Privacy & safety', 'shield-lock-outline', 'privacy'],
    ['Notifications', 'bell-outline', 'notifications'],
    ['Now Playing', 'music-note', 'music'],
    ['Your Circles', 'account-group-outline', 'circles'],
    ['Saved Circle updates', 'content-save-outline', 'saved-circle-updates'],
    ['Archived chats', 'archive-outline', 'archived'],
    ['Personal stickers', 'sticker-emoji', 'stickers'],
    ['Backup & restore', 'backup-restore', 'backup'],
  ] as const;
  const signOut = async () => {
    if (!runtime || signingOut) return;
    setSigningOut(true);
    try { await runtime.flow.logout(); showFeedback('Signed out on this phone.'); }
    catch {
      if (runtime.owner.getSnapshot().status === 'signed-out') showFeedback('Signed out on this phone. Server revocation could not be confirmed.');
      else showFeedback('Could not sign out. Please retry.');
    } finally { setSigningOut(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Settings</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
      {rows.map(([label, icon, view]) => <Pressable key={view} accessibilityRole="button" accessibilityLabel={label} onPress={() => open(view)} style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
        <Icon name={icon} size={22} color={c.muted} /><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>{label}</Text><Icon name="chevron-right" size={21} color={c.muted} />
      </Pressable>)}
      {runtimeLoad === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="Retry account controls" onPress={() => { setRuntimeLoad('loading'); setRuntimeAttempt(value => value + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Could not load account controls. Tap to retry.</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={runtimeLoad === 'ready' ? signingOut ? 'Signing out' : 'Sign out' : 'Sign out unavailable'} accessibilityState={{ disabled: runtimeLoad !== 'ready' || signingOut }} disabled={runtimeLoad !== 'ready' || signingOut} onPress={() => Alert.alert('Sign out of AwsemChat?', 'Your old messages need an encrypted backup and its recovery key to restore after signing in again.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => { void signOut(); } },
      ])} style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line, opacity: runtimeLoad !== 'ready' || signingOut ? 0.55 : 1 }}>
        <Icon name="logout" size={22} color="#C43D46" /><Text style={{ flex: 1, color: '#C43D46', fontSize: 16, fontWeight: '600' }}>{runtimeLoad === 'ready' ? signingOut ? 'Signing out…' : 'Sign out' : runtimeLoad === 'loading' ? 'Loading account controls…' : 'Sign out unavailable'}</Text>
      </Pressable>
    </ScrollView>
  </SafeAreaView>;
}

function AccountHome({ runtime, pin }: { runtime: AuthenticationRuntime; pin: string }) {
  const c = usePalette();
  const [loaded, setLoaded] = useState<{ attempt: number; controller: ProfileController } | null>(null);
  const [failedAttempt, setFailedAttempt] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void runtime.privateProfile().then(value => { if (active) setLoaded({ attempt, controller: value }); }, () => { if (active) setFailedAttempt(attempt); }); return () => { active = false; }; }, [runtime, attempt]);
  const controller = loaded?.attempt === attempt ? loaded.controller : undefined;
  const loadFailed = failedAttempt === attempt;
  const snapshot = useSyncExternalStore(controller?.subscribe ?? noop, controller?.getSnapshot ?? (() => noProfile), () => noProfile);
  const profile = snapshot.phase === 'ready' ? snapshot.profile : undefined;
  const open = (view: string) => view === 'stickers'
    ? router.push({ pathname: '/stickers', params: { mode: 'library' } })
    : router.push({ pathname: '/flow', params: { view } });
  return <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 20, gap: 14 }}>
    <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
      <PrivateProfileAvatar name={profile?.name || 'Your AwsemChat account'} size={88} localPhoto={snapshot.avatar} />
      <Text style={{ color: c.text, fontSize: 22, fontWeight: '600' }}>{profile?.name || 'Your AwsemChat account'}</Text>
      {profile?.status ? <Text style={{ color: c.muted, fontSize: 14, textAlign: 'center' }}>{profile.status}</Text> : <Text style={{ color: c.muted, fontSize: 14 }}>Add a name and status for accepted friends.</Text>}
    </View>
    <View style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
      <View style={{ flex: 1 }}><Text style={{ color: c.muted, fontSize: 12 }}>Your PIN</Text><Text selectable style={{ color: c.text, fontSize: 18, fontWeight: '600', letterSpacing: 1.5 }}>{pin || 'PIN unavailable'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => open('profile')} style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Edit profile</Text></Pressable>
    </View>
    {(loadFailed || snapshot.phase === 'error') ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Retry loading profile</Text></Pressable> : !profile && <View style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 10 }}><ActivityIndicator accessibilityLabel="Loading profile" color={c.accent} /><Text style={{ color: c.muted }}>Loading your profile…</Text></View>}
    {[
      ['Settings', 'cog-outline', 'settings'],
      ['Your Circles', 'account-group-outline', 'circles'],
      ['Personal stickers', 'sticker-emoji', 'stickers'],
      ['Backup & restore', 'backup-restore', 'backup'],
    ].map(([label, icon, view]) => <Pressable key={view} accessibilityRole="button" accessibilityLabel={label} onPress={() => open(view)} style={{ minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
      <Icon name={icon as keyof typeof Icon.glyphMap} size={22} color={c.muted} /><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>{label}</Text><Icon name="chevron-right" size={21} color={c.muted} />
    </Pressable>)}
  </ScrollView>;
}

function ProfileEditor({ runtime }: { runtime: AuthenticationRuntime }) {
  const c = usePalette();
  const [controller, setController] = useState<ProfileController>();
  const [loadFailed, setLoadFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void runtime.privateProfile().then(value => { if (active) { setController(value); setLoadFailed(false); } }, () => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [runtime, attempt]);
  const snapshot = useSyncExternalStore(controller?.subscribe ?? noop, controller?.getSnapshot ?? (() => noProfile), () => noProfile);
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 16 }}>
      {loadFailed ? <View style={{ gap: 12 }}><Text style={{ color: c.muted }}>Could not load your saved profile.</Text><ProfileButton label="Retry" action={() => setAttempt(value => value + 1)} /></View>
        : !controller || snapshot.phase === 'loading' || snapshot.phase === 'idle' ? <ActivityIndicator accessibilityLabel="Loading your profile" color={c.accent} />
          : snapshot.phase === 'error' ? <View style={{ gap: 12 }}><Text style={{ color: c.muted }}>Could not load your saved profile.</Text><ProfileButton label="Retry" action={() => setAttempt(value => value + 1)} /></View>
            : <ProfileForm key={`${snapshot.profile.revision}:${snapshot.profile.name}:${snapshot.profile.status}`} controller={controller} profile={snapshot.profile} avatar={snapshot.avatar} photoError={snapshot.photoError} busy={snapshot.busy} sharePending={snapshot.sharePending} />}
    </ScrollView>
  </KeyboardAvoidingView>;
}

function ProfileForm({ controller, profile, avatar, photoError, busy, sharePending }: { controller: ProfileController; profile: PrivateProfileSnapshot['profile']; avatar: PrivateProfileSnapshot['avatar']; photoError?: string; busy: boolean; sharePending: boolean }) {
  const c = usePalette();
  const [saving, setSaving] = useState(false), [photoBusy, setPhotoBusy] = useState(false), [confirmRemove, setConfirmRemove] = useState(false);
  const [name, setName] = useState<string>(profile.name), [status, setStatus] = useState<string>(profile.status);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await controller.save({ name, status });
      if (controller.getSnapshot().sharePending) showFeedback('Saved here. Friends who are offline will get this update when they reconnect.');
      else showFeedback('Profile saved.');
    } catch (error) {
      const code = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      if (code === 'INVALID_PROFILE') showFeedback('Check your name and status, then try again.');
      else if (code !== 'SESSION_CHANGED') showFeedback('Could not save your profile. Your changes are still here.');
    } finally { setSaving(false); }
  };
  const choosePhoto = async () => {
    if (photoBusy || busy) return;
    setPhotoBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
      if (result.canceled) return;
      const selected = result.assets[0], side = Math.min(selected.width, selected.height), editor = ImageManipulator.manipulate(selected.uri);
      editor.crop({ originX: Math.floor((selected.width - side) / 2), originY: Math.floor((selected.height - side) / 2), width: side, height: side });
      editor.resize({ width: 512, height: 512 });
      const rendered = await editor.renderAsync(), prepared = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: .88, base64: true });
      try {
        if (!prepared.base64) throw new Error('INVALID_PROFILE_PHOTO');
        await controller.setPhoto({ mimeType: 'image/jpeg', bytes: toByteArray(prepared.base64) });
        showFeedback(controller.getSnapshot().sharePending ? 'Profile photo saved. Friends will receive it when they reconnect.' : 'Profile photo saved.');
      } finally { const file = new File(prepared.uri); if (file.exists) file.delete(); }
    } catch (error) {
      const code = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
      showFeedback(code === 'INVALID_PROFILE_PHOTO' ? 'Choose a smaller photo and try again.' : 'Could not save your profile photo. Please retry.');
    } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    if (photoBusy || busy) return;
    setPhotoBusy(true);
    try {
      await controller.setPhoto(null);
      setConfirmRemove(false);
      showFeedback(controller.getSnapshot().sharePending ? 'Photo removal saved. Friends will see it when they reconnect.' : 'Profile photo removed.');
    } catch { showFeedback('Could not remove your profile photo. Please retry.'); }
    finally { setPhotoBusy(false); }
  };
  const saveDisabled = saving || busy || photoBusy || !name.trim() || (name.trim() === profile.name && status === profile.status);
  return <>
    <View style={{ alignItems: 'center', paddingVertical: 8, gap: 10 }}><PrivateProfileAvatar name={name || 'Your profile'} size={88} localPhoto={avatar} /><ProfileButton label={photoBusy ? 'Preparing photo…' : avatar ? 'Change profile photo' : 'Add profile photo'} disabled={photoBusy || busy} action={() => { void choosePhoto(); }} />{(avatar || profile.avatarMode) && !confirmRemove && <Pressable accessibilityRole="button" disabled={photoBusy || busy} onPress={() => setConfirmRemove(true)} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.muted, fontSize: 14 }}>Remove profile photo</Text></Pressable>}</View>
    {photoError && <Text accessibilityRole="alert" style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>Your saved photo could not be opened. Choose a new photo to replace it or remove it explicitly.</Text>}
    {confirmRemove && <View style={{ gap: 8, padding: 14, borderRadius: 8, backgroundColor: c.bg }}><Text style={{ color: c.text }}>Remove your profile photo? Friends will see your initials instead.</Text><ProfileButton label={photoBusy ? 'Removing…' : 'Confirm remove profile photo'} disabled={photoBusy || busy} action={() => { void removePhoto(); }} /><ProfileButton label="Cancel photo removal" disabled={photoBusy || busy} action={() => setConfirmRemove(false)} /></View>}
    <Text style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>Only accepted friends receive your name and status. Updates are end-to-end encrypted.</Text>
    <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>Display name</Text>
    <TextInput accessibilityLabel="Display name" value={name} onChangeText={setName} maxLength={80} autoCorrect={false} returnKeyType="next" placeholder="Your name" placeholderTextColor={c.muted} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16 }} />
    <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>Text status</Text>
    <TextInput accessibilityLabel="Text status" value={status} onChangeText={setStatus} maxLength={280} multiline placeholder="A little about today" placeholderTextColor={c.muted} style={{ minHeight: 88, padding: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text, fontSize: 16, textAlignVertical: 'top' }} />
    {sharePending && <View style={{ gap: 4 }}><Text accessibilityRole="alert" style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>Saved on this phone. Some friends will receive the update when they reconnect.</Text><Pressable accessibilityRole="button" disabled={busy || photoBusy} onPress={() => { void controller.sync().then(() => showFeedback(controller.getSnapshot().sharePending ? 'Still waiting for friends to reconnect.' : 'Profile update sent.'), () => showFeedback('Could not retry the profile update. Please try again.')); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Retry profile update</Text></Pressable></View>}
    <ProfileButton label={saving || busy ? 'Saving…' : 'Save profile'} primary disabled={saveDisabled} action={() => { void save(); }} />
    <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>Your Circle status is managed separately in each Circle. Now Playing is not shared from this screen.</Text>
  </>;
}

function ProfileButton({ label, action, primary = false, disabled = false }: { label: string; action(): void; primary?: boolean; disabled?: boolean }) {
  const c = usePalette();
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={action} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 18, backgroundColor: primary ? c.accent : c.bg, opacity: disabled ? .55 : 1 }}><Text style={{ color: primary ? '#FFFFFF' : c.text, fontSize: 16, fontWeight: '600' }}>{label}</Text></Pressable>;
}
