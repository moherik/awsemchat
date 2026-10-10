import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { useDemo, updateDemo } from './demo-store';
import { usePalette } from './ui';
type Gif = { id: string; name: string; uri: string };
export function GifPicker({ onSelect }: { onSelect: (gif: Gif) => void }) {
  const c = usePalette(); const demo = useDemo();
  const favorites = demo.favoriteGifs ?? [];
  const [category, setCategory] = useState("Trending");
  const [gridWidth, setGridWidth] = useState(0);
  const key = Platform.OS === 'android' ? process.env.EXPO_PUBLIC_GIPHY_ANDROID_KEY : Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_GIPHY_IOS_KEY : process.env.EXPO_PUBLIC_GIPHY_WEB_KEY;
  const [query, setQuery] = useState(''); const [offset, setOffset] = useState(0); const [items, setItems] = useState<Gif[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [more, setMore] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!key || category === "Favorites") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError('');
      try {
        const params = new URLSearchParams({ api_key: key, limit: '24', offset: String(offset), rating: 'g', ...(query.trim() ? { q: query.trim() } : {}) });
        const response = await fetch(`https://api.giphy.com/v1/gifs/${query.trim() ? 'search' : 'trending'}?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error('GIF service unavailable');
        const result = await response.json();
        const gifs: Gif[] = result.data.map((gif: { id: string; title: string; images: { original: { url: string } } }) => ({ id: gif.id, name: gif.title || 'GIF', uri: gif.images.original.url }));
        if (controller.signal.aborted) return;
        setItems(old => offset ? [...old, ...gifs.filter(gif => !old.some(item => item.id === gif.id))] : gifs); setMore(gifs.length === 24);
      } catch { if (!controller.signal.aborted) setError('Could not load GIFs. Try again.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, query, offset, retry, category]);
  const visibleItems = category === "Favorites" ? favorites.filter(gif => gif.name.toLowerCase().includes(query.trim().toLowerCase())) : items;
  return <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 12 }}><TextInput accessibilityLabel="Search GIFs" placeholder="Search GIFs" placeholderTextColor={c.muted} value={query} onChangeText={value => { setQuery(value); setOffset(0); setItems([]); setMore(false); }} style={{ minHeight: 48, padding: 12, backgroundColor: c.bg, color: c.text, borderRadius: 6 }} />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{['Trending', 'Favorites', 'Happy', 'Love', 'Laugh', 'Wow', 'Sad'].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: category === value }} onPress={() => { setBusy(false); setCategory(value); setQuery(value === 'Trending' || value === 'Favorites' ? '' : value.toLowerCase()); setOffset(0); setItems([]); setMore(false); setError(''); }} style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 20, backgroundColor: category === value ? c.accent : c.bg }}><Text style={{ color: category === value ? c.surface : c.text }}>{value}</Text></Pressable>)}</ScrollView>
    {!key && category !== 'Favorites' && <Text style={{ color: c.muted }}>GIF search needs a GIPHY API key. Configure the app to browse trending GIFs and search.</Text>}
    <Text style={{ color: c.muted, fontSize: 12 }}>Powered by GIPHY · {query.trim() ? 'Search results' : 'Trending'}</Text>
    <ScrollView onLayout={event => setGridWidth(event.nativeEvent.layout.width)} style={{ maxHeight: 340 }} contentContainerStyle={{ paddingBottom: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{visibleItems.map(gif => { const saved = favorites.some(item => item.id === gif.id); return <View key={gif.id} style={{ width: gridWidth > 0 ? (gridWidth - 8) / 2 : '48%' }}><Pressable accessibilityRole="button" accessibilityLabel={`Preview ${gif.name}`} onPress={() => onSelect(gif)}><Image source={{ uri: gif.uri }} contentFit="cover" style={{ height: 130, borderRadius: 6 }} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={saved ? 'Remove GIF from favorites' : 'Save GIF to favorites'} accessibilityState={{ selected: saved }} onPress={() => updateDemo({ favoriteGifs: saved ? favorites.filter(item => item.id !== gif.id) : [...favorites, gif] })} style={{ position: 'absolute', right: 4, bottom: 4, width: 44, height: 44, borderRadius: 6, backgroundColor: '#26343DEE', alignItems: 'center', justifyContent: 'center' }}><Icon name={saved ? 'star' : 'star-outline'} size={22} color="#FFFFFF" /></Pressable></View>; })}</View>
      {busy && <Text style={{ color: c.muted, paddingVertical: 12 }}>Loading GIFs…</Text>}
      {error && category !== 'Favorites' && <Pressable accessibilityRole="button" onPress={() => setRetry(x => x + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent }}>{error}</Text></Pressable>}
      {!busy && !error && !visibleItems.length && (key || category === 'Favorites') && <Text style={{ color: c.muted, paddingVertical: 12 }}>{category === 'Favorites' ? 'No favorite GIFs yet. Tap the star on a GIF to save it.' : 'No GIFs found.'}</Text>}
      {category !== 'Favorites' && more && !busy && !error && <Pressable accessibilityRole="button" onPress={() => setOffset(x => x + 24)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Load more</Text></Pressable>}
    </ScrollView>
  </View>;
}
