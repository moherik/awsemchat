import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { Page, Copy, Action, usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { DrivePanel } from './drive-panel';
const noop = () => () => {};
const signedOut = Object.freeze({ status: 'signed-out' });
const unavailable = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
function feedback(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  showFeedback(code === 'ARCHIVE_REJECTED' || code === 'INVALID_BACKUP' ? 'The backup or recovery key could not be verified. Your history was not changed.' :
    code === 'NETWORK' ? 'Connect to the internet to check deleted messages before restoring this backup.' :
    code === 'INVALID_REDACTION_LEDGER' || code === 'AMBIGUOUS_REDACTION' ? 'The deletion history could not be verified. Nothing was restored.' :
    code === 'CAPACITY' ? 'This backup exceeds the current storage limit.' :
    code === 'PARTIAL_FILE_REMAINS' ? 'Backup failed. An incomplete encrypted file may remain in the selected folder.' :
    code === 'SESSION_REVOKED' ? 'Your account changed. Sign in again before continuing.' : 'Backup could not be completed. Please try again.');
}
function ReadyBackup({ runtime }: { runtime: AuthenticationRuntime }) {
  const c = usePalette();
  const [busy, setBusy] = useState<'backup' | 'restore' | null>(null);
  const [savedKey, setSavedKey] = useState('');
  const [key, setKey] = useState('');
  const [lastBackup, setLastBackup] = useState<{ phase: 'loading' | 'ready' | 'failed'; timestamp?: string }>({ phase: 'loading' });
  useEffect(() => {
    let active = true;
    void runtime.lastLocalBackup().then(status => status.read()).then(value => {
      if (active) setLastBackup({ phase: 'ready', timestamp: value ?? undefined });
    }, () => { if (active) setLastBackup({ phase: 'failed' }); });
    return () => { active = false; };
  }, [runtime]);
  async function create() {
    if (busy || savedKey) return;
    setBusy('backup');
    try {
      const result = await runtime.backup.create();
      if (!result.cancelled) {
        setSavedKey(result.recoveryKey);
        const timestamp = new Date().toISOString();
        try {
          await (await runtime.lastLocalBackup()).record(timestamp);
          setLastBackup({ phase: 'ready', timestamp });
          showFeedback(`${result.records} messages and ${result.stickers} personal stickers backed up.`);
        } catch {
          setLastBackup({ phase: 'failed' });
          showFeedback('Backup saved, but its last-saved time could not be updated. Keep your recovery key safe.');
        }
      }
    } catch (error) { feedback(error); }
    finally { setBusy(null); }
  }
  async function restore() {
    if (busy || savedKey) return;
    if (!/^[a-fA-F0-9]{64}$/.test(key.trim())) { showFeedback('Enter the 64-character recovery key saved with this backup.'); return; }
    setBusy('restore');
    try {
      const result = await runtime.backup.restore(key.trim().toLowerCase());
      if (!result.cancelled) { setKey(''); await runtime.history.refresh(); showFeedback(`${result.records} archival messages and ${result.stickers} personal stickers restored.`); }
    } catch (error) { feedback(error); }
    finally { setBusy(null); }
  }
  const disabled = !!busy || !!savedKey;
  return <Page title="Backup & restore">
    <Copy>Save an encrypted copy of your message history. Keep its recovery key somewhere safe and separate from the backup file.</Copy>
    <Copy muted>Personal stickers are included. Photos and Moments are not included yet. Restore needs an internet connection to check for messages deleted since this backup was made. Restored messages are history only; they do not restore old sessions or access to a Circle.</Copy>
    {busy && <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={c.accent} /><Text style={{ color: c.text }}>{busy === 'backup' ? 'Saving encrypted backup…' : 'Verifying and restoring…'}</Text></View>}
    {savedKey ? <View style={{ gap: 14, padding: 16, borderRadius: 8, backgroundColor: c.bg }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>Save your recovery key</Text>
      <Text style={{ color: c.muted, lineHeight: 22 }}>SMS verification cannot recover this key. Without it, this backup cannot be opened.</Text>
      <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 25 }}>{savedKey}</Text>
      <Action label="Copy recovery key" onPress={() => { void Clipboard.setStringAsync(savedKey).then(() => showFeedback('Recovery key copied. Store it securely.'), () => showFeedback('Select the key above to copy it.')); }} />
      <Action label="I saved my recovery key" primary onPress={() => setSavedKey('')} />
    </View> : <Pressable accessibilityRole="button" accessibilityLabel="Save local backup" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void create(); }} style={{ minHeight: 52, borderRadius: 8, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: c.surface === '#FFFFFF' ? '#FFFFFF' : '#172027', fontWeight: '600', fontSize: 16 }}>Save local backup</Text></Pressable>}
    <Copy muted>{lastBackup.timestamp ? `Last local backup: ${new Date(lastBackup.timestamp).toLocaleString()}` : lastBackup.phase === 'loading' ? 'Checking the last local backup…' : lastBackup.phase === 'failed' ? 'Could not check the last local backup.' : 'No local backup has been saved yet.'}</Copy>
    <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>Restore a local backup</Text>
    <TextInput accessibilityLabel="Backup recovery key" placeholder="Recovery key" placeholderTextColor={c.muted} value={key} onChangeText={setKey} editable={!disabled} secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={64} style={{ minHeight: 48, borderRadius: 8, backgroundColor: c.bg, color: c.text, paddingHorizontal: 14, fontSize: 16 }} />
    <Pressable accessibilityRole="button" accessibilityLabel="Choose backup file" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void restore(); }} style={{ minHeight: 48, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>Choose backup file</Text></Pressable>
    <Text style={{ color: c.text, fontSize: 18, fontWeight: '600' }}>Google Drive</Text>
    <DrivePanel runtime={runtime} blocked={disabled} />
  </Page>;
}
export default function BackupScreen() {
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, error => { if (active) { setFailed(true); feedback(error); } }); return () => { active = false; }; }, [attempt]);
  const account = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => signedOut), runtime?.owner.getSnapshot ?? (() => signedOut));
  const flow = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => unavailable), runtime?.flow.getSnapshot ?? (() => unavailable));
  if (!runtime) return <Page title="Backup & restore">{failed ? <Action label="Retry preparing backup" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} /> : <ActivityIndicator accessibilityLabel="Preparing backup" />}</Page>;
  if (account.status !== 'ready' || flow.phase !== 'ready') return <Page title="Backup & restore"><Copy>Sign in to back up or restore your encrypted history.</Copy><Action label="Sign in" primary onPress={() => router.push({ pathname: '/flow', params: { view: 'phone' } })} /></Page>;
  return <ReadyBackup key={`${'account' in account ? account.account?.id : ''}:${'generation' in account ? account.generation : ''}`} runtime={runtime} />;
}
