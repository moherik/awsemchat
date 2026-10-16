import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { toByteArray } from 'base64-js';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { createCircleDetails } from './circle-details';
import { createCircleAvatarEditor } from './circle-avatar-editor';
import { CreationButton } from './circle-creation-screen';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';

export function CircleAvatarControls({ runtime, circleId, controller }: { runtime: AuthenticationRuntime; circleId: string; controller: ReturnType<typeof createCircleDetails> }) {
  const c = usePalette(), [busy, setBusy] = useState(false), [pending, setPending] = useState<boolean>(), [confirmRemove, setConfirmRemove] = useState(false);
  const mounted = useRef(true), state = controller.getSnapshot();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(async () => {
    const account = runtime.owner.getSnapshot(), upload = await runtime.circleMediaUpload(circleId);
    const saved = await upload.pending();
    if (mounted.current && runtime.owner.getSnapshot() === account) setPending(!!saved);
  }, [runtime, circleId]);
  useEffect(() => { void reload().catch(() => { if (mounted.current) setPending(undefined); }); }, [reload, state.profile]);
  async function run(work: () => Promise<void | boolean>) {
    if (busy) return; setBusy(true); const account = runtime.owner.getSnapshot();
    try { const result = await work(); if (result !== false && mounted.current && runtime.owner.getSnapshot() === account) { showFeedback('Circle picture saved.'); await runtime.history.refresh(); } }
    catch {
      if (mounted.current && runtime.owner.getSnapshot() === account) {
        let saved = false;
        try { const upload = await runtime.circleMediaUpload(circleId); saved = !!await upload.pending(); } catch { /* Unreadable protected storage cannot prove a saved photo. */ }
        if (mounted.current && runtime.owner.getSnapshot() === account) showFeedback(saved ? 'Could not save the Circle picture. Your prepared photo is kept for retry.' : 'Could not save the Circle picture. Please retry.');
      }
    } finally { if (mounted.current && runtime.owner.getSnapshot() === account) { await reload().catch(() => setPending(undefined)); setBusy(false); } }
  }
  async function choose() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled) return false;
    const photo = result.assets[0], side = Math.min(photo.width, photo.height);
    const context = ImageManipulator.manipulate(photo.uri);
    context.crop({ originX: Math.floor((photo.width - side) / 2), originY: Math.floor((photo.height - side) / 2), width: side, height: side });
    context.resize({ width: 512, height: 512 });
    const rendered = await context.renderAsync(), image = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    try {
      if (!image.base64) throw new Error('INVALID_MEDIA');
      const upload = await runtime.circleMediaUpload(circleId);
      await createCircleAvatarEditor({ profile: controller, upload }).choose({ bytes: toByteArray(image.base64), mimeType: 'image/png' });
    } finally { const file = new File(image.uri); if (file.exists) file.delete(); }
  }
  const accepted = state.profile?.state === 'ready' ? state.profile.profile : undefined;
  if (confirmRemove) return <View style={{ gap: 8 }}><Text style={{ color: c.text }}>Remove the Circle picture?</Text><CreationButton label="Remove picture" disabled={busy || !state.canEdit} action={() => { void run(async () => { if (!accepted || state.profile?.state !== 'ready') return; await controller.update(state.profile.revision, { ...accepted, avatar: null }); setConfirmRemove(false); }); }} /><CreationButton label="Cancel" disabled={busy} action={() => setConfirmRemove(false)} /></View>;
  return <View style={{ gap: 8 }}>
    {pending ? <CreationButton label={busy ? 'Saving picture…' : 'Retry saved picture'} disabled={busy || state.busy} action={() => { void run(async () => { const upload = await runtime.circleMediaUpload(circleId); await createCircleAvatarEditor({ profile: controller, upload }).resume(); }); }} /> : <CreationButton label={busy ? 'Saving picture…' : 'Change Circle picture'} disabled={busy || state.busy || !state.canEdit || pending !== false} action={() => { void run(choose); }} />}
    {pending === undefined && <CreationButton label="Check saved picture" disabled={busy} action={() => { void reload().catch(() => showFeedback('Could not open your saved picture. Please retry.')); }} />}
    {accepted?.avatar && !pending && <CreationButton label="Remove picture" disabled={busy || state.busy || !state.canEdit} action={() => setConfirmRemove(true)} />}
  </View>;
}
