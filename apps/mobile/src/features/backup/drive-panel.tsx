import { useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { DriveBackup } from './drive-api';
import { Copy, usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
type Job = Awaited<ReturnType<AuthenticationRuntime['drive']['prepare']>>;
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  showFeedback(code === 'NOT_CONFIGURED' ? 'Google Drive is not configured for this build.' :
    code === 'DRIVE_AUTH_REQUIRED' ? 'Reconnect Google Drive to grant access.' :
    code === 'SESSION_REVOKED' ? 'Your account changed. Reconnect before continuing.' :
    code === 'ARCHIVE_REJECTED' || code === 'INVALID_BACKUP' ? 'The backup or recovery key could not be verified.' :
    code === 'BACKUP_CONFLICT' ? 'The Drive file differs from your saved backup. Your pending backup and key are kept.' :
    'Could not finish the Drive operation. Your saved backup remains available for retry.');
}
function ConnectedDrive({ runtime, blocked }: { runtime: AuthenticationRuntime; blocked: boolean }) {
  const c = usePalette();
  const [busy, setBusy] = useState(false), [job, setJob] = useState<Job>(), [key, setKey] = useState('');
  const [files, setFiles] = useState<DriveBackup[]>([]), [cursor, setCursor] = useState<string>();
  const [listed, setListed] = useState(false), [keySaved, setKeySaved] = useState(false);
  async function work(task: () => Promise<void>) { if (busy || blocked) return; setBusy(true); try { await task(); } catch (error) { failure(error); } finally { setBusy(false); } }
  function button(label: string, task: () => Promise<void>, extraDisabled = false) {
    const disabled = busy || blocked || extraDisabled;
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void work(task); }} style={{ minHeight: 48, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{label}</Text></Pressable>;
  }
  async function list(next?: string) { const page = await runtime.drive.list(next); setFiles(old => next ? [...old, ...page.items] : page.items); setCursor(page.cursor); setListed(true); }
  return <View style={{ gap: 12 }}>
    {busy && <ActivityIndicator accessibilityLabel="Working with Google Drive" color={c.accent} />}
    {button('Prepare or resume Drive backup', async () => { const pending = await runtime.drive.prepare(); setJob(pending); setKeySaved(false); })}
    {job && <View style={{ backgroundColor: c.bg, padding: 14, borderRadius: 8, gap: 10 }}>
      <Text style={{ color: c.text, fontWeight: '600' }}>{job.phase === 'uploaded' ? 'Drive backup uploaded' : 'Backup ready to upload'} · {job.records} messages</Text>
      <Text style={{ color: c.muted, lineHeight: 22 }}>Save this recovery key separately before uploading. SMS verification cannot recover a lost key.</Text>
      <Text selectable style={{ color: c.text, lineHeight: 24 }}>{job.recoveryKey}</Text>
      {job.phase === 'prepared' ? <>
        <Pressable accessibilityRole="checkbox" accessibilityLabel="I saved the Drive recovery key" accessibilityState={{ checked: keySaved, disabled: busy || blocked }} disabled={busy || blocked} onPress={() => setKeySaved(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.text }}>{keySaved ? '☑' : '☐'} I saved the recovery key</Text></Pressable>
        {button('Upload or retry backup', async () => { setJob(await runtime.drive.upload()); showFeedback('Encrypted backup uploaded to Google Drive.'); }, !keySaved)}
      </> : button('I saved my key — finish', async () => { await runtime.drive.acknowledge(); setJob(undefined); setKeySaved(false); showFeedback('Backup finished. Keep your recovery key safe.'); })}
    </View>}
    {button('Show Drive backups', () => list())}
    {listed && files.length === 0 && <Copy muted>No AwsemChat backups found in this Google account.</Copy>}
    {files.length > 0 && <>
      <TextInput accessibilityLabel="Drive backup recovery key" secureTextEntry value={key} onChangeText={setKey} editable={!busy && !blocked} maxLength={64} autoCapitalize="none" autoCorrect={false} placeholder="Recovery key for the selected backup" placeholderTextColor={c.muted} style={{ minHeight: 48, color: c.text, backgroundColor: c.bg, paddingHorizontal: 12, borderRadius: 8 }} />
      {files.map(file => <View key={file.id} style={{ borderBottomWidth: 0.5, borderColor: c.line, paddingVertical: 6 }}><Text style={{ color: c.text }}>Backup · {new Date(file.modifiedAt).toLocaleString()}</Text><Text style={{ color: c.muted }}>{Math.ceil(file.size / 1024)} KB · Encrypted history</Text>{button('Restore this backup', async () => {
        if (!/^[a-fA-F0-9]{64}$/.test(key.trim())) { showFeedback('Enter the recovery key for this backup.'); return; }
        const restored = await runtime.drive.restore(file.id, key.trim().toLowerCase()); setKey(''); showFeedback(`${restored.records} archival messages restored.`);
      })}</View>)}
      {cursor && button('Load more backups', () => list(cursor))}
    </>}
    {button('Disconnect Google Drive', async () => { runtime.drive.connection.disconnect(); })}
    <Copy muted>Disconnecting removes local access. You can revoke the Google grant in your Google account settings. Automatic backups are not enabled.</Copy>
  </View>;
}
export function DrivePanel({ runtime, blocked }: { runtime: AuthenticationRuntime; blocked: boolean }) {
  const state = useSyncExternalStore(runtime.drive.connection.subscribe, runtime.drive.connection.getSnapshot, runtime.drive.connection.getSnapshot);
  const c = usePalette();
  if (process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED !== 'true') return <Copy muted>Google Drive requires configuration for this build. Local backup is available.</Copy>;
  if (state.status === 'connected') return <ConnectedDrive key={state.subject} runtime={runtime} blocked={blocked} />;
  const disabled = blocked || state.status === 'connecting';
  return <Pressable accessibilityRole="button" accessibilityLabel="Connect Google Drive" accessibilityState={{ disabled }} disabled={disabled} onPress={() => { void runtime.drive.connection.connect().catch(failure); }} style={{ minHeight: 48, justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}><Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>{state.status === 'connecting' ? 'Connecting Google Drive…' : 'Connect Google Drive'}</Text></Pressable>;
}
