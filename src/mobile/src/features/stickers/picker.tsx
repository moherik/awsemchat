import { showFeedback } from "../feedback/snackbar";
import { FeedbackSheet } from "../feedback/sheet";
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { updateDemo, useDemo, type DemoMessage } from '../demo-store';
import { usePalette } from '../ui';
import { Artwork } from './artwork';
import { copySticker, makeStickerMessage, uniqueStickerKey } from './model';
import { IconButton, PanelHeader, Primary } from './controls';

export function StickerPicker({ open, circle, onClose, onSend }: { open: boolean; circle?: string; onClose: () => void; onSend: (message: DemoMessage) => void }) {
  const c = usePalette(); const demo = useDemo();
  const [tab, setTab] = useState('personal'); const [pack, setPack] = useState('All'); const [query, setQuery] = useState(''); const [selected, setSelected] = useState<string | null>(null); const [saved, setSaved] = useState(false);
  const keys = tab === 'group' && circle ? demo.groupStickers[circle] ?? [] : demo.stickers;
  const packs = ['All', 'Recent', ...new Set(keys.map(key => demo.stickerArt[key]?.pack ?? 'Saved stickers'))];
  const filtered = keys.filter(key => demo.stickerArt[key] && (pack === 'All' || (pack === 'Recent' ? demo.recentStickers.includes(key) : demo.stickerArt[key].pack === pack)) && demo.stickerArt[key].title.toLowerCase().includes(query.toLowerCase()));
  const navigate = (mode: string) => { onClose(); router.push({ pathname: '/stickers', params: { mode, circle } }); };
  const art = selected ? demo.stickerArt[selected] : null;
  return <FeedbackSheet isPresented={open} onDismiss={onClose} containerColor={c.surface} contentPadding={0}>
    <View style={{ width: '100%', maxWidth: 600, alignSelf: 'center', paddingBottom: 20 }}>
      <PanelHeader title={art ? art.title : 'Stickers'} subtitle={art ? art.pack : 'A little more you, in every message'} onClose={onClose} onBack={art ? () => { setSelected(null); setSaved(false); } : undefined} />
      {art && selected ? <View style={{ padding: 22, gap: 16, alignItems: 'center' }}><Artwork artwork={art} size={230} /><View style={{ width: '100%', gap: 10 }}><Primary label="Send sticker" onPress={() => { onSend(makeStickerMessage(art)); updateDemo({ recentStickers: [selected, ...demo.recentStickers.filter(key => key !== selected)].slice(0, 16) }); onClose(); setSelected(null); }} />{tab === 'group' && <Primary label={saved ? 'Saved to personal stickers' : 'Save to personal stickers'} disabled={saved} onPress={() => { const id = uniqueStickerKey(); const copy = copySticker(art, 'Saved stickers'); updateDemo({ stickers: [...demo.stickers, id], stickerArt: { ...demo.stickerArt, [id]: copy }, stickerImages: { ...demo.stickerImages, [id]: copy.image } }); setSaved(true); showFeedback("Saved to personal stickers."); }} />}</View></View> : <>
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>{(circle ? [['personal', 'Personal stickers'], ['group', 'Group stickers']] : [['personal', 'Personal stickers']]).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: tab === value }} onPress={() => { setTab(value); setPack('All'); }} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderColor: tab === value ? c.accent : 'transparent' }}><Text style={{ color: tab === value ? c.accent : c.muted, fontWeight: '600', fontSize: 14 }}>{label}</Text></Pressable>)}</View>
        <View style={{ flexDirection: 'row', alignItems: 'center', margin: 16, borderRadius: 8, backgroundColor: c.bg, paddingHorizontal: 12 }}><Icon name="magnify" size={21} color={c.muted} /><TextInput accessibilityLabel="Search stickers" placeholder="Find a sticker" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} style={{ flex: 1, height: 44, paddingLeft: 8, color: c.text }} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>{packs.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: pack === value }} onPress={() => setPack(value)} style={{ paddingHorizontal: 16, minHeight: 36, justifyContent: 'center', backgroundColor: pack === value ? c.bg : c.surface, borderRadius: 18 }}><Text style={{ color: pack === value ? c.accent : c.muted, fontWeight: '500' }}>{value}</Text></Pressable>)}</ScrollView>
        <ScrollView style={{ maxHeight: 250 }} contentContainerStyle={{ padding: 12, flexDirection: 'row', flexWrap: 'wrap' }}>{filtered.map(key => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`Preview ${demo.stickerArt[key].title}`} onPress={() => { setSelected(key); setSaved(false); }} style={{ width: '25%', alignItems: 'center', paddingVertical: 8 }}><Artwork artwork={demo.stickerArt[key]} size={76} /></Pressable>)}{filtered.length === 0 && <Text style={{ color: c.muted, padding: 18 }}>No stickers here yet. Create one or try another pack.</Text>}</ScrollView>
        {circle && (demo.customEmoji[circle] ?? []).length > 0 && <ScrollView horizontal contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>{demo.customEmoji[circle].map(emoji => <Pressable key={emoji} accessibilityRole="button" onPress={() => { onSend({ text: emoji, own: true }); onClose(); }} style={{ minHeight: 44, padding: 12 }}><Text style={{ color: c.accent }}>{emoji}</Text></Pressable>)}</ScrollView>}
        <View style={{ borderTopWidth: .5, borderColor: c.line, paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}><IconButton name="plus-circle-outline" label="Create a sticker" onPress={() => navigate('maker')} /><Text style={{ flex: 1, color: c.text, fontSize: 14 }}>Create your own</Text><IconButton name="folder-cog-outline" label="Manage stickers" onPress={() => navigate(tab === 'group' ? 'circle' : 'library')} /></View>
      </>}
    </View>
  </FeedbackSheet>;
}
