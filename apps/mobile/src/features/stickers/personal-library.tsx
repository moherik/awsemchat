import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Text, View } from 'react-native';
import { router } from 'expo-router';
import { authenticationRuntime } from '../auth/runtime';
import type { PersonalSticker } from './personal-stickers';
import { usePalette } from '../ui';
import { IconButton, Primary } from './controls';
import { showFeedback } from '../feedback/snackbar';
export function PersonalStickerLibrary() {
  const c = usePalette(); const [items, setItems] = useState<readonly PersonalSticker[]>([]); const [busy, setBusy] = useState(true); const [error, setError] = useState(false);
  const load = async () => { setBusy(true); setError(false); try { const runtime = await authenticationRuntime(); setItems(await (await runtime.personalStickers()).list()); } catch { setError(true); } finally { setBusy(false); } };
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(runtime => runtime.personalStickers()).then(store => store.list()).then(value => {
      if (active) setItems(value);
    }).catch(() => {
      if (active) setError(true);
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, []);
  return <View style={{ flex: 1, backgroundColor: c.surface }}><View style={{ minHeight: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: .5, borderColor: c.line }}><IconButton name="arrow-left" label="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} /><Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '600' }}>My stickers</Text><IconButton name="plus" label="Create a sticker" onPress={() => router.push({ pathname: '/stickers', params: { mode: 'maker' } })} /></View>{busy ? <ActivityIndicator style={{ marginTop: 28 }} color={c.accent} /> : error ? <View style={{ padding: 20, gap: 12 }}><Text style={{ color: c.text }}>Could not open your encrypted sticker library.</Text><Primary label="Try again" onPress={() => void load()} /></View> : <FlatList data={items} keyExtractor={item => item.id} numColumns={3} contentContainerStyle={{ padding: 10, paddingBottom: 28 }} renderItem={({ item }) => <View style={{ width: '33.333%', padding: 8, gap: 8 }}><View style={{ aspectRatio: 1, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Image source={{ uri: item.artwork.image }} resizeMode="contain" style={{ width: '90%', height: '90%' }} /></View><Text numberOfLines={1} style={{ color: c.text, fontSize: 13 }}>{item.artwork.title}</Text><Primary label="Remove" onPress={() => { void authenticationRuntime().then(async runtime => { await (await runtime.personalStickers()).remove(item.id); setItems(old => old.filter(value => value.id !== item.id)); showFeedback('Sticker removed from your library.'); }).catch(() => showFeedback('Could not remove this sticker.')); }} /></View>} ListEmptyComponent={<Text style={{ color: c.muted, padding: 22 }}>Your personal collection is ready for a little more you.</Text>} />}</View>;
}
