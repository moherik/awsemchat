import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { usePalette } from '../ui';
import { createGiphyClient, type Gif } from './client';
import type { GifFavorite } from './favorites-store';
type Client = { list(input: { query: string; offset: number; signal?: AbortSignal }): Promise<{ items: readonly Gif[]; hasMore: boolean }>; favorites(ids: readonly string[], signal?: AbortSignal): Promise<{ items: readonly Gif[]; hasMore: boolean }> };
type FavoriteStore = { list(): Promise<GifFavorite[]>; toggle(gif: Gif): Promise<readonly GifFavorite[]> };
const categories = ['Trending', 'Favorites', 'Happy', 'Love', 'Laugh', 'Wow', 'Sad'];
export function GiphyPicker({ open, onClose, onSend, client, favoriteStore }: { open: boolean; onClose: () => void; onSend: (gif: Gif, caption: string) => void; client?: Client; favoriteStore: FavoriteStore }) {
  const c = usePalette();
  const [category, setCategory] = useState('Trending'), [query, setQuery] = useState(''), [favorites, setFavorites] = useState<GifFavorite[]>([]);
  const [items, setItems] = useState<readonly Gif[]>([]), [selected, setSelected] = useState<Gif>(), [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false), [favoriteBusy, setFavoriteBusy] = useState<string>(), [error, setError] = useState(''), [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false), [gridWidth, setGridWidth] = useState(0), [retry, setRetry] = useState(0);
  const key = Platform.OS === 'android' ? process.env.EXPO_PUBLIC_GIPHY_ANDROID_KEY : process.env.EXPO_PUBLIC_GIPHY_IOS_KEY;
  const activeClient = useMemo(() => client ?? (key ? createGiphyClient({ apiKey: key }) : undefined), [client, key]);
  useEffect(() => { if (!open) return; let active = true; void favoriteStore.list().then(value => { if (active) setFavorites(value); }).catch(() => { if (active) setError('Could not load saved GIFs.'); }); return () => { active = false; }; }, [open, favoriteStore]);
  useEffect(() => {
    if (!open || selected) return;
    if (!activeClient) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError('');
      const request = category === 'Favorites' ? activeClient?.favorites(favorites.map(item => item.id), controller.signal) : activeClient?.list({ query: query.trim(), offset, signal: controller.signal });
      void request?.then(result => {
        if (controller.signal.aborted) return;
        setItems(old => category === 'Favorites' || offset === 0 ? result.items : [...old, ...result.items.filter(item => !old.some(existing => existing.id === item.id))]);
        setHasMore(category !== 'Favorites' && result.hasMore);
      }).catch(() => { if (!controller.signal.aborted) setError('Could not load GIFs. Check your connection and try again.'); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [activeClient, category, favorites, offset, open, query, retry, selected]);
  const shownItems = category === 'Favorites' ? items.filter(item => item.title.toLowerCase().includes(query.trim().toLowerCase())) : items;
  const changeCategory = (value: string) => { setSelected(undefined); setCaption(''); setCategory(value); setQuery(value === 'Trending' || value === 'Favorites' ? '' : value.toLowerCase()); setItems([]); setOffset(0); setHasMore(false); setError(''); };
  const toggleFavorite = async (gif: Gif) => { setFavoriteBusy(gif.id); try { setFavorites([...(await favoriteStore.toggle(gif))]); } catch { setError('Could not save this GIF to favorites.'); } finally { setFavoriteBusy(undefined); } };
  const close = () => { setSelected(undefined); setCaption(''); onClose(); };
  return <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={{ minHeight: 58, paddingHorizontal: 16, borderBottomWidth: 0.5, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {selected && <Pressable accessibilityRole="button" accessibilityLabel="Back to GIFs" onPress={() => setSelected(undefined)} style={{ width: 44, height: 48, justifyContent: 'center' }}><Icon name="arrow-left" size={25} color={c.text} /></Pressable>}
        <Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '700' }}>{selected ? 'GIF preview' : 'GIFs'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close GIF picker" onPress={close} style={{ width: 44, height: 48, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={26} color={c.text} /></Pressable>
      </View>
      {selected ? <View style={{ flex: 1, padding: 16, gap: 14 }}>
        <Image accessibilityLabel={selected.title} source={{ uri: selected.previewURL }} cachePolicy="none" contentFit="contain" style={{ flex: 1, minHeight: 180, maxHeight: 440, borderRadius: 12, backgroundColor: c.bg }} />
        <TextInput accessibilityLabel="GIF caption" placeholder="Add a caption…" placeholderTextColor={c.muted} value={caption} onChangeText={setCaption} maxLength={280} style={{ minHeight: 48, borderRadius: 10, paddingHorizontal: 14, color: c.text, backgroundColor: c.bg }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Send GIF" onPress={() => onSend(selected, caption)} style={{ minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: c.accent }}><Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>Send GIF</Text></Pressable>
        <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>Powered by GIPHY</Text>
      </View> : <>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
          <TextInput accessibilityLabel="Search GIFs" placeholder="Search GIFs" placeholderTextColor={c.muted} value={query} onChangeText={value => { setQuery(value); setItems([]); setOffset(0); setHasMore(false); }} style={{ minHeight: 48, paddingHorizontal: 14, borderRadius: 8, backgroundColor: c.bg, color: c.text }} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{categories.map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={value} accessibilityState={{ selected: category === value }} onPress={() => changeCategory(value)} style={{ minHeight: 40, paddingHorizontal: 15, borderRadius: 22, justifyContent: 'center', backgroundColor: category === value ? c.accent : c.bg }}><Text style={{ color: category === value ? '#FFFFFF' : c.text, fontWeight: '600' }}>{value}</Text></Pressable>)}</ScrollView>
          <Text style={{ color: c.muted, fontSize: 12 }}>Powered by GIPHY · {category === 'Favorites' ? 'Your saved GIFs' : query.trim() ? 'Search results' : 'Trending'}</Text>
        </View>
        {!activeClient ? <Text style={{ padding: 18, color: c.muted }}>GIF browsing is unavailable because this app has no GIPHY key configured.</Text> : <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 30 }}>
          <View onLayout={event => setGridWidth(event.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {shownItems.map(gif => { const saved = favorites.some(item => item.id === gif.id); return <View key={gif.id} style={{ width: gridWidth ? (gridWidth - 8) / 2 : '48%' }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Preview ${gif.title}`} onPress={() => setSelected(gif)}><Image source={{ uri: gif.previewURL }} cachePolicy="none" contentFit="cover" style={{ height: 136, borderRadius: 9, backgroundColor: c.bg }} /></Pressable>
              <Text numberOfLines={1} style={{ color: c.muted, paddingTop: 4, paddingBottom: 8 }}>{gif.title}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Remove GIF from favorites' : 'Save GIF to favorites'} accessibilityState={{ selected: saved, disabled: favoriteBusy === gif.id }} disabled={favoriteBusy === gif.id} onPress={() => void toggleFavorite(gif)} style={{ position: 'absolute', top: 6, right: 6, width: 42, height: 42, borderRadius: 21, backgroundColor: '#17232BCE', alignItems: 'center', justifyContent: 'center' }}><Icon name={saved ? 'star' : 'star-outline'} size={21} color="#FFFFFF" /></Pressable>
            </View>; })}
          </View>
          {busy && <View style={{ minHeight: 56, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator accessibilityLabel="Loading GIFs" color={c.accent} /></View>}
          {!!error && <Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={{ minHeight: 52, justifyContent: 'center' }}><Text style={{ color: c.accent }}>{error} Tap to retry.</Text></Pressable>}
          {!busy && !error && shownItems.length === 0 && <Text style={{ color: c.muted, paddingVertical: 18 }}>{category === 'Favorites' ? 'No favorite GIFs yet. Tap the star on a GIF to save it.' : 'No GIFs found.'}</Text>}
          {hasMore && !busy && <Pressable accessibilityRole="button" onPress={() => setOffset(value => value + 24)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>Load more</Text></Pressable>}
        </ScrollView>}
      </>}
    </SafeAreaView>
  </Modal>;
}
