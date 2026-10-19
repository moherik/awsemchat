import { GifPicker } from "./gif-picker";
import type { EditablePhoto } from './photos/editor';
import { showFeedback as setError, showFeedback, dismissFeedback } from "./feedback/snackbar";
import { FeedbackSheet } from "./feedback/sheet";
import { useState } from 'react';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, Text, TextInput, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { usePalette } from './ui';
import { PanelHeader, Primary } from './stickers/controls';
export function MediaSheet({ open, privateChat, onClose, onPhoto, onEditPhoto, onStickers, onPing, onBrowse }: { open: boolean; privateChat: boolean; onClose: () => void; onPhoto: (uri: string, caption: string) => void; onEditPhoto: (photo: EditablePhoto) => void; onStickers: () => void; onPing: () => void; onBrowse: () => void }) {
  const c = usePalette(); const [mode, setMode] = useState('menu'); const [photo, setPhoto] = useState<string | null>(null); const [caption, setCaption] = useState('');  const [busy, setBusy] = useState(false);
  const close = () => { onClose(); setMode('menu'); setPhoto(null); setCaption(''); };
  const pick = async (camera: boolean) => { const feedback = showFeedback(camera ? 'Opening your camera…' : 'Opening your photos…', 0); try { if (camera) { const permission = await ImagePicker.requestCameraPermissionsAsync(); if (!permission.granted) { setError('Camera access is off. You can still choose a photo from your gallery.'); return; } } setBusy(true); const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: .8 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: .8 }); if (!result.canceled) { const asset = result.assets[0]; close(); onEditPhoto({ uri: asset.uri, width: asset.width, height: asset.height }); } } catch { setError('Could not open that photo. Please try again.'); } finally { setBusy(false); dismissFeedback(feedback); } };
  const options: { title: string; subtitle: string; icon: keyof typeof Icon.glyphMap; action: () => void }[] = [
    { title: 'Photos', subtitle: 'Choose from your gallery', icon: 'image-outline', action: () => pick(false) },
    { title: 'Camera', subtitle: 'Capture something now', icon: 'camera-outline', action: () => pick(true) },
    { title: 'Stickers', subtitle: 'Say it your way', icon: 'sticker-emoji', action: () => { close(); onStickers(); } },
    { title: 'GIFs', subtitle: 'Find the right reaction', icon: 'file-gif-box', action: () => setMode('gifs') },
    { title: 'Shared media', subtitle: 'Photos from this conversation', icon: 'image-multiple-outline', action: () => { close(); onBrowse(); } },
    ...(privateChat ? [{ title: 'PING!', subtitle: 'A little nudge', icon: 'bell-ring-outline' as const, action: () => { close(); onPing(); } }] : []),
  ];
  return <FeedbackSheet isPresented={open} onDismiss={close} containerColor={c.surface} contentPadding={0}><View style={{ maxWidth: 600, width: '100%', alignSelf: 'center', paddingBottom: 24 }}>
    <PanelHeader title={mode === 'menu' ? 'Share something' : mode === 'gifs' ? 'GIFs' : 'Photo preview'} subtitle={mode === 'menu' ? 'Just between you and your people' : undefined} onClose={close} onBack={mode !== 'menu' ? () => setMode('menu') : undefined} />
    {mode === 'menu' && <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12 }}>{options.map(option => <Pressable accessibilityRole="button" accessibilityLabel={option.title} disabled={busy} key={option.title} onPress={option.action} style={{ width: '33.333%', paddingHorizontal: 4, paddingVertical: 14, alignItems: 'center', gap: 8 }}><View style={{ width: 58, height: 58, borderRadius: 18, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name={option.icon} size={28} color={c.accent} /></View><Text style={{ color: c.text, fontWeight: '500', fontSize: 14 }}>{option.title}</Text></Pressable>)}</View>}
    {mode === 'gifs' && <GifPicker onSelect={gif => { setPhoto(gif.uri); setCaption(''); setMode('preview'); }} />}
    {mode === 'preview' && photo && <View style={{ padding: 16, gap: 14 }}><Image source={{ uri: photo }} contentFit="contain" style={{ height: 230, backgroundColor: c.bg, borderRadius: 10 }} /><TextInput accessibilityLabel="Photo caption" placeholder="Add a caption…" placeholderTextColor={c.muted} value={caption} onChangeText={setCaption} style={{ minHeight: 48, backgroundColor: c.bg, color: c.text, borderRadius: 8, padding: 12 }} /><Primary label="Send to chat" onPress={() => { onPhoto(photo, caption); close(); }} /></View>}

  </View></FeedbackSheet>;
}
