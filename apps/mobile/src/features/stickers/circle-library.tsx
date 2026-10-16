import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { fromByteArray } from 'base64-js';
import { showFeedback } from '../feedback/snackbar';
import { authenticationRuntime } from '../auth/runtime';
import { createCircleStickerManagement } from '../social/circle-sticker-management.ts';
import type { CollectionItem } from '../social/circle-collection';
import { usePalette } from '../ui';
import { IconButton, Primary } from './controls';

type Manager = ReturnType<typeof createCircleStickerManagement>;
function StickerTile({ item, manager, canRemove, onRemoved, onSavePersonal }: { item: CollectionItem; manager: Manager; canRemove: boolean; onRemoved: () => void; onSavePersonal: (item: CollectionItem) => void }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [error, setError] = useState(false);
  useEffect(() => { let active = true; manager.download(item).then(bytes => { if (active) setURI(`data:${item.image.media.mimeType};base64,${fromByteArray(bytes)}`); }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [item, manager]);
  const remove = () => Alert.alert('Remove sticker?', `“${item.label}” will be removed from this Circle.`, [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void manager.remove(item).then(onRemoved).catch(() => Alert.alert('Could not remove sticker', 'Check your connection and try again.')); } }]);
  return <View style={{ width: '33.333%', padding: 8, gap: 6 }}><View style={{ aspectRatio: 1, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: '90%', height: '90%' }} /> : error ? <Text style={{ color: c.muted, fontSize: 12 }}>Preview unavailable</Text> : <ActivityIndicator color={c.accent} />}</View><Text numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{item.label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Save ${item.label} to personal stickers`} onPress={() => onSavePersonal(item)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: c.accent, fontSize: 12 }}>Save to personal</Text></Pressable>{canRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.label}`} onPress={remove} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: '#C43D46', fontSize: 12 }}>Remove</Text></Pressable>}</View>;
}
export function CircleStickerLibrary({ circleId }: { circleId: string }) {
  const c = usePalette(); const [manager, setManager] = useState<Manager>(); const [state, setState] = useState<Awaited<ReturnType<Manager['load']>>>(); const [busy, setBusy] = useState(false); const [error, setError] = useState(false); const [pendingRecovery, setPendingRecovery] = useState<{ operation: string; queued: boolean; uploaded: boolean }>();
  const load = useCallback(async (current: Manager) => {
    setBusy(true); setError(false);
    try {
      const result = await current.load();
      setState(result.state === 'ready' ? { ...result, items: result.items.filter(item => item.kind === 'sticker') } : result);
    } catch { setError(true); } finally { setBusy(false); }
  }, []);
  const refreshPending = useCallback(async (runtime?: Awaited<ReturnType<typeof authenticationRuntime>>) => {
    try {
      const value = runtime ?? await authenticationRuntime();
      const draft = await value.circleCollectionPublisher(circleId).pending();
      if (draft) { setPendingRecovery({ operation: draft.operation, queued: true, uploaded: false }); return; }
      const media = await value.circleCollectionMedia(circleId), job = await media.pending();
      setPendingRecovery(job?.collectionIntent ? { operation: job.collectionIntent.operation, queued: false, uploaded: job.phase === 'uploaded' } : undefined);
    } catch { setPendingRecovery(undefined); }
  }, [circleId]);
  useFocusEffect(useCallback(() => { void refreshPending(); }, [refreshPending]));
  useEffect(() => { let active = true; void authenticationRuntime().then(runtime => {
    const session = runtime.owner.requireSession(), binding = JSON.stringify([session.account.id, session.deviceId, session.generation, session.accessToken]);
    const current = createCircleStickerManagement({ account: () => { const value = runtime.owner.requireSession(); return JSON.stringify([value.account.id, value.deviceId, value.generation, value.accessToken]); }, memberId: () => runtime.owner.requireSession().account.id, details: () => runtime.social.circle(circleId), load: () => runtime.circleCollection(circleId), remove: item => runtime.circleCollectionPublisher(circleId).remove(item), download: item => runtime.circleAvatarBytes(circleId, item.image) }, circleId);
    if (!active || runtime.owner.requireSession().account.id !== session.account.id || binding.length === 0) return;
    setManager(current); void load(current); void refreshPending(runtime);
  }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, [circleId, load, refreshPending]);
  const resolvePending = () => {
    if (!pendingRecovery) return;
    const operation = pendingRecovery.operation;
    const explanation = pendingRecovery.queued
      ? 'AwsemChat will ask the server whether this exact update was already accepted. Accepted updates are kept; only a confirmed cancellation removes the queued encrypted draft.'
      : pendingRecovery.uploaded
        ? 'This update has not been queued. Its uploaded encrypted image may remain unused on the media server.'
        : 'This update has not been queued and can be removed from this phone.';
    Alert.alert('Resolve pending sticker update?', explanation, [
      { text: 'Keep it', style: 'cancel' },
      { text: pendingRecovery.queued ? 'Check and discard' : 'Discard', style: 'destructive', onPress: () => {
        if (!manager) return;
        setBusy(true);
        void authenticationRuntime().then(async runtime => {
          if (pendingRecovery.queued) {
            const result = await runtime.circleCollectionPublisher(circleId).recover();
            if (result === 'committed') await (await runtime.circleCollectionMedia(circleId)).resume();
            else await (await runtime.circleCollectionMedia(circleId)).discard(operation);
          } else await (await runtime.circleCollectionMedia(circleId)).discard(operation);
          await load(manager); await refreshPending(runtime);
          showFeedback('Pending sticker update checked.');
        }).catch(() => showFeedback('Could not safely resolve this sticker update. Try again.')).finally(() => setBusy(false));
      } },
    ]);
  };
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  return <View style={{ flex: 1, backgroundColor: c.surface }}><View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: .5, borderColor: c.line }}><IconButton name="arrow-left" label="Back" onPress={back} /><Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '600' }}>Circle stickers</Text></View><View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 }}><Text style={{ color: c.muted, lineHeight: 20 }}>Stickers shared in this private Circle. New members see the current collection after it is refreshed.</Text><Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/stickers', params: { mode: 'maker', circle: circleId } })} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Create a sticker for this Circle</Text></Pressable>{pendingRecovery && <View style={{ gap: 6, paddingVertical: 8 }}><Text style={{ color: c.muted, lineHeight: 19 }}>A sticker update is still saved on this phone.</Text><Primary label="Resolve pending update" disabled={busy} onPress={resolvePending} /></View>}</View>{busy && <ActivityIndicator style={{ marginTop: 30 }} color={c.accent} />}{error && !busy && <View style={{ padding: 22, gap: 12 }}><Text style={{ color: c.text }}>Could not load this Circle’s stickers.</Text><Primary label="Try again" onPress={() => manager && void load(manager)} /></View>}{state && !busy && (state.state === 'ready' ? <><View style={{ paddingHorizontal: 18, paddingVertical: 8 }}><Text style={{ color: c.muted, fontSize: 13 }}>{state.items.length} shared {state.items.length === 1 ? 'sticker' : 'stickers'}{state.canRemove ? ' · Admin' : ''}</Text>{state.needsRefresh && <Primary label="Refresh stickers" disabled={busy} onPress={() => { if (!manager) return; setBusy(true); void authenticationRuntime().then(runtime => runtime.refreshCircleCollection(circleId)).then(workflow => workflow.run()).then(() => load(manager)).catch(() => setError(true)).finally(() => setBusy(false)); }} />}</View><FlatList data={state.items} keyExtractor={item => item.id} numColumns={3} contentContainerStyle={{ padding: 8, paddingBottom: 28 }} renderItem={({ item }) => manager ? <StickerTile item={item} manager={manager} canRemove={state.canRemove} onRemoved={() => manager && void load(manager)} onSavePersonal={value => { void (async () => { const bytes = await manager.download(value); const runtime = await authenticationRuntime(), library = await runtime.personalStickers(); await library.save({ image: `data:${value.image.media.mimeType};base64,${fromByteArray(bytes)}`, title: value.label, text: '', textColor: '#FFFFFF', textSize: 26, textY: 72, background: null, pack: 'Saved stickers' }); showFeedback('Saved an independent copy to your encrypted personal library.'); })().catch(() => showFeedback('Could not save this sticker.')); }} /> : null} ListEmptyComponent={<Text style={{ color: c.muted, padding: 24 }}>No shared stickers yet.</Text>} /></> : <View style={{ padding: 22, gap: 12 }}><Text style={{ color: c.text, fontWeight: '600' }}>This Circle needs a fresh sticker snapshot.</Text><Text style={{ color: c.muted, lineHeight: 20 }}>Refresh shares the current collection using this Circle’s latest encryption keys.</Text><Primary label="Refresh stickers" disabled={busy} onPress={() => { if (!manager) return; setBusy(true); void authenticationRuntime().then(runtime => runtime.refreshCircleCollection(circleId)).then(workflow => workflow.run()).then(() => load(manager)).catch(() => setError(true)).finally(() => setBusy(false)); }} /></View>)}</View>;
}
