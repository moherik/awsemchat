import { CircleStickerLibrary } from './circle-library';
import { FeedbackSheet } from "../feedback/sheet";
import { dismissFeedback, showFeedback as setNote } from "../feedback/snackbar";
import { canRemoveBackground, removePhotoBackground } from './background-removal';
import { useEffect, useState } from 'react';
import { fromByteArray } from 'base64-js';
import { PersonalStickerLibrary } from './personal-library';
import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { authenticationRuntime } from '../auth/runtime';
import { CropCanvas, DraggableText, type CropRect } from './editor-canvas';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Host, Slider } from '@expo/ui';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { usePalette } from '../ui';
import { Artwork } from './artwork';
import { copySticker, starterStickers, uniqueStickerKey, type StickerArtwork } from './model';
import { IconButton, PanelHeader, Primary } from './controls';
import { resolveNativeStickerRoute } from '../native-sticker-route';
import { availableStickerPacks } from './personal-sticker-packs';

export default function StickerScreen() {
  const { mode = 'library', circle } = useLocalSearchParams<{ mode?: string; circle?: string }>();
  return <NativeStickerScreen mode={mode} circle={circle} />;
}

function NativeStickerScreen({ mode, circle }: { mode: string; circle?: string }) {
  const c = usePalette();
  const nativeRoute = resolveNativeStickerRoute(mode, circle);
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  if (nativeRoute === 'circle-library' && circle) return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><CircleStickerLibrary circleId={circle} /></SafeAreaView>;
  if (nativeRoute === 'personal-library') return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><PersonalStickerLibrary /></SafeAreaView>;
  if (nativeRoute === 'unavailable') return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface, padding: 20, gap: 16, justifyContent: 'center' }}><Text style={{ color: c.text }}>This Circle’s sticker collection needs a Circle link.</Text><Primary label="Back" onPress={back} /></SafeAreaView>;
  return <StickerEditor mode={mode} circle={circle} />;
}

function StickerEditor({ mode, circle }: { mode: string; circle?: string }) {
  const canvasSize = Math.min(290, useWindowDimensions().width - 44);
  const c = usePalette(); const maker = mode === 'maker';
  const [nativePacks, setNativePacks] = useState<string[]>([]);
  const editorColorScheme = c.surface === '#202C34' ? 'dark' : 'light';
  const [title, setTitle] = useState('');
  const [art, setArt] = useState<StickerArtwork>({ ...starterStickers['Big hug'], title: 'My sticker', pack: 'Made by you', background: null, textBoxes: [] });
  const [beforeCutout, setBeforeCutout] = useState<{ art: StickerArtwork; dimensions: { width: number; height: number } } | null>(null); const [sample, setSample] = useState(true); const [dimensions, setDimensions] = useState({ width: 72, height: 72 }); const [tool, setTool] = useState('text'); const [cropRect, setCropRect] = useState<CropRect>({ x: .1, y: .1, width: .8, height: .8 }); const [activeText, setActiveText] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [saveDialog, setSaveDialog] = useState(false); const [original, setOriginal] = useState<StickerArtwork | null>(null); const [originalDimensions, setOriginalDimensions] = useState(dimensions);
  useEffect(() => {
    if (!maker || typeof circle === 'string') return;
    let active = true;
    void authenticationRuntime().then(runtime => runtime.personalStickers()).then(store => store.list()).then(items => {
      if (active) setNativePacks(availableStickerPacks(items));
    }).catch(() => {
      if (active) setNote('Could not load saved sticker packs. You can still save this sticker.');
    });
    return () => { active = false; };
  }, [maker, circle]);
  const back = () => router.canGoBack() ? router.back() : router.replace('/');
  const choosePhoto = async () => { const feedback = setNote('Opening your photos…', 0); try { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }); if (!result.canceled) { const photo = result.assets[0]; setArt({ ...art, image: photo.uri, background: null }); setDimensions({ width: photo.width, height: photo.height }); setSample(false); setBeforeCutout(null); setOriginal(null); resetCrop(photo.width, photo.height); setTool('crop'); } } catch { setNote('Could not open your photos. Please try again.'); } finally { dismissFeedback(feedback); } };
  const scale = Math.min((canvasSize - 10) / dimensions.width, (canvasSize - 10) / dimensions.height);
  const imageWidth = dimensions.width * scale; const imageHeight = dimensions.height * scale;
  const resetCrop = (_width?: number, _height?: number) => setCropRect({ x: 0, y: 0, width: 1, height: 1 });
  const textBox = art.textBoxes?.find(box => box.id === activeText);
  const editText = (patch: Partial<NonNullable<StickerArtwork['textBoxes']>[number]>) => setArt({ ...art, textBoxes: art.textBoxes?.map(box => box.id === activeText ? { ...box, ...patch, y: Math.min(patch.y ?? box.y, Math.max(0, 1 - ((patch.size ?? box.size) * 2.3 + 10) / 280)) } : box) });
  const swatch = (value: string) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Text color ${value}`} accessibilityState={{ selected: textBox?.color === value }} onPress={() => editText({ color: value })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: value, borderWidth: textBox?.color === value ? 3 : 1, borderColor: textBox?.color === value ? c.accent : c.line }} />;
  const crop = async () => { const feedback = setNote('Applying crop…', 0); setBusy(true); try {
    const originX = Math.round(cropRect.x * dimensions.width); const originY = Math.round(cropRect.y * dimensions.height);
    const width = Math.min(dimensions.width - originX, Math.max(1, Math.round(cropRect.width * dimensions.width))); const height = Math.min(dimensions.height - originY, Math.max(1, Math.round(cropRect.height * dimensions.height)));
    const context = ImageManipulator.manipulate(art.image); context.crop({ originX, originY, width, height }); const rendered = await context.renderAsync(); const result = await rendered.saveAsync({ format: SaveFormat.PNG }); setBeforeCutout(null); setOriginal(copySticker(art, art.pack)); setOriginalDimensions(dimensions); setArt({ ...art, image: result.uri }); setDimensions({ width, height }); resetCrop(width, height); setTool('text'); setNote('Crop applied.');
  } catch { setNote('This image could not be cropped. Try choosing another photo.'); } finally { setBusy(false); dismissFeedback(feedback); } };
  const removeBackground = async () => { const feedback = setNote('Removing background…', 0); setBusy(true); try { const result = await removePhotoBackground(art.image); setOriginal(null); setBeforeCutout({ art: copySticker(art, art.pack), dimensions }); setArt({ ...art, image: result.uri, background: null }); setDimensions({ width: result.width, height: result.height }); resetCrop(result.width, result.height); setNote('Background removed. Your photo stayed on this phone.'); } catch (error) { const code = error && typeof error === 'object' && 'code' in error ? error.code : ''; setNote(code === 'NO_SUBJECT_FOUND' ? 'No subject found. Try a photo with a clearer subject.' : code === 'UNSUPPORTED_OS' ? 'Background removal requires Android or iOS 17 or later.' : 'Could not remove the background. On Android, let Google Play services download the model, then try again.'); } finally { setBusy(false); dismissFeedback(feedback); } };
  const save = async () => {
    if (!title.trim()) { setNote('Give your sticker a name before saving.'); return; }
    if (sample || !art.image.startsWith('file://')) { setNote('Choose a photo and finish editing it before saving.'); return; }
    setBusy(true);
    try {
      const rendered = await ImageManipulator.manipulate(art.image).renderAsync();
      const png = await rendered.saveAsync({ format: SaveFormat.PNG });
      const bytes = new Uint8Array(await new File(png.uri).arrayBuffer());
      const runtime = await authenticationRuntime();
      if (typeof circle === 'string') {
        const editor = await runtime.circleCollectionMedia(circle);
        await editor.choose({ id: Crypto.randomUUID(), kind: 'sticker', label: title.trim(), bytes, mimeType: 'image/png' });
        setSaveDialog(false); setNote('Sticker shared with this Circle.');
        router.replace({ pathname: '/stickers', params: { mode: 'circle', circle } });
      } else {
        const store = await runtime.personalStickers();
        await store.save({ ...art, title: title.trim(), image: `data:image/png;base64,${fromByteArray(bytes)}` });
        setSaveDialog(false); setNote('Sticker saved to your encrypted library.');
        router.replace({ pathname: '/stickers', params: { mode: 'library' } });
      }
    } catch {
      setNote('Could not save this sticker. Your edits are still here; try again.');
    } finally { setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}><View style={{ flex: 1, maxWidth: 600, width: '100%', alignSelf: 'center', backgroundColor: c.surface }}>
    <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: .5, borderColor: c.line }}><IconButton name="arrow-left" label="Back" onPress={back} /><Text style={{ flex: 1, fontSize: 20, fontWeight: '600', color: c.text }}>Sticker maker</Text><Pressable accessibilityRole="button" accessibilityLabel="Save sticker" disabled={busy} onPress={() => { setTitle(art.textBoxes?.find(box => box.text.trim())?.text || art.title); setSaveDialog(true); }} style={{ padding: 14 }}><Text style={{ color: c.accent, fontSize: 16, fontWeight: '600' }}>Save</Text></Pressable></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>

      <View style={{ padding: 22, alignItems: 'center', backgroundColor: c.bg, gap: 14 }}><View style={{ width: canvasSize, height: canvasSize, backgroundColor: c.surface, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: tool === 'crop' ? 2 : 1, borderColor: tool === 'crop' ? c.accent : c.line }}>{tool === 'crop' ? <CropCanvas uri={art.image} width={imageWidth} height={imageHeight} rect={{ x: cropRect.x * imageWidth, y: cropRect.y * imageHeight, width: cropRect.width * imageWidth, height: cropRect.height * imageHeight }} onChange={rect => { if (!busy) setCropRect({ x: rect.x / imageWidth, y: rect.y / imageHeight, width: rect.width / imageWidth, height: rect.height / imageHeight }); }} /> : <View style={{ width: canvasSize - 10, height: canvasSize - 10 }}><Artwork artwork={{ ...art, textBoxes: tool === 'text' ? [] : art.textBoxes }} size={canvasSize - 10} />{tool === 'text' && art.textBoxes?.map(box => <DraggableText key={box.id} box={box} size={canvasSize - 10} selected={activeText === box.id} onSelect={() => setActiveText(box.id)} onChange={changed => setArt({ ...art, textBoxes: art.textBoxes?.map(value => value.id === box.id ? changed : value) })} />)}</View>}{busy && <View style={{ position: 'absolute', inset: 0, backgroundColor: '#00000040', justifyContent: 'center' }}><ActivityIndicator color={c.accent} size="large" /></View>}</View><Pressable accessibilityRole="button" onPress={choosePhoto} disabled={busy} style={{ minHeight: 44, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="image-outline" size={20} color={c.accent} /><Text style={{ color: c.accent, fontWeight: '600' }}>Choose a photo</Text></Pressable><Text style={{ fontSize: 12, color: c.muted }}>{sample ? 'Transparent sample · Choose a photo for background removal' : 'Your photo stays on this device.'}</Text></View>
      <View style={{ flexDirection: 'row', borderBottomWidth: .5, borderColor: c.line }}>{[['crop','crop','Crop'], ['cutout','content-cut','Background'], ['text','format-text','Text']].map(([value, icon, label]) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} disabled={busy} accessibilityState={{ selected: tool === value }} onPress={() => { setTool(value); if (value === "crop") resetCrop(); }} style={{ flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 5, borderBottomWidth: 2, borderColor: tool === value ? c.accent : 'transparent' }}><Icon name={icon as keyof typeof Icon.glyphMap} size={23} color={tool === value ? c.accent : c.muted} /><Text style={{ color: tool === value ? c.accent : c.muted, fontSize: 12 }}>{label}</Text></Pressable>)}</View>
      <View style={{ padding: 20, gap: 14 }}>{tool === 'crop' && <><Text style={{ color: c.text, fontWeight: '600' }}>Free crop</Text><Text style={{ color: c.muted, fontSize: 13 }}>Drag the corners to resize. Drag inside the frame to move it.</Text><Primary label="Apply crop" disabled={busy} onPress={crop} /><Primary label="Reset crop" disabled={busy} onPress={() => resetCrop()} />{original && <Primary label="Undo crop" disabled={busy} onPress={() => { setArt({ ...art, image: original.image, background: original.background }); setDimensions(originalDimensions); resetCrop(originalDimensions.width, originalDimensions.height); setOriginal(null); }} />}</>}
      {tool === 'cutout' && <><Text style={{ color: c.text, fontWeight: '600' }}>Keep just the subject</Text><Text style={{ color: c.muted, lineHeight: 20, fontSize: 14 }}>{sample ? 'This sample sticker already has a transparent background. Choose a photo to remove its background.' : canRemoveBackground ? 'Find the subject on this phone and erase the background. Your photo is never uploaded.' : 'On-device background removal is available in the mobile app (Android or iOS 17+). Your photo stays on this device.'}</Text><Primary label={busy ? 'Removing background…' : 'Remove background'} disabled={busy || sample || !canRemoveBackground || !!beforeCutout} onPress={removeBackground} />{beforeCutout && <Primary label="Undo background removal" disabled={busy} onPress={() => { setArt({ ...art, image: beforeCutout.art.image, background: beforeCutout.art.background }); setDimensions(beforeCutout.dimensions); resetCrop(beforeCutout.dimensions.width, beforeCutout.dimensions.height); setBeforeCutout(null); }} />}</>}
      {tool === 'text' && <><Primary label="Add text box" onPress={() => { const id = uniqueStickerKey(); setArt({ ...art, textBoxes: [...(art.textBoxes ?? []), { id, text: 'Your text', x: .15, y: .2 + ((art.textBoxes?.length ?? 0) % 3) * .15, color: '#FFFFFF', size: 26 }] }); setActiveText(id); }} /><Text style={{ color: c.muted, fontSize: 13 }}>Tap a text box to edit it. Drag it anywhere on the sticker.</Text><ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{art.textBoxes?.map((box, i) => <Pressable key={box.id} accessibilityRole="button" onPress={() => setActiveText(box.id)} style={{ padding: 12, backgroundColor: c.bg }}><Text style={{ color: box.id === activeText ? c.accent : c.muted }}>Text {i + 1}</Text></Pressable>)}</ScrollView>{textBox && <><TextInput accessibilityLabel="Selected sticker text" placeholder="Your text" placeholderTextColor={c.muted} maxLength={60} value={textBox.text} onChangeText={text => editText({ text })} style={{ color: c.text, backgroundColor: c.bg, borderRadius: 8, minHeight: 48, padding: 12, fontSize: 16 }} /><Text style={{ color: c.muted, fontSize: 12 }}>Text size · {Math.round(textBox.size)}</Text><Host matchContents seedColor={c.accent} colorScheme={editorColorScheme}><Slider value={textBox.size} onValueChange={size => editText({ size })} min={16} max={44} step={1} /></Host><View style={{ flexDirection: 'row', gap: 10 }}>{['#FFFFFF','#172027','#066DB8','#E9B44C','#C43D46'].map(swatch)}</View><Primary label="Delete selected text" onPress={() => { setArt({ ...art, textBoxes: art.textBoxes?.filter(box => box.id !== activeText) }); setActiveText(null); }} /></>}</>}
      </View>
    </ScrollView>
    <FeedbackSheet isPresented={saveDialog} onDismiss={() => setSaveDialog(false)} containerColor={c.surface}><View style={{ gap: 14, paddingBottom: 20 }}><PanelHeader title="Save your sticker" subtitle="Ready for your next conversation" onClose={() => setSaveDialog(false)} /><TextInput accessibilityLabel="New sticker name" value={title} onChangeText={setTitle} style={{ minHeight: 48, padding: 12, backgroundColor: c.bg, color: c.text, borderRadius: 8 }} /><Text style={{ color: c.muted, fontSize: 13 }}>Save to pack</Text><ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{[...new Set([...nativePacks, art.pack])].map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: art.pack === value }} onPress={() => setArt({ ...art, pack: value })} style={{ padding: 12, backgroundColor: c.bg, borderRadius: 8 }}><Text style={{ color: art.pack === value ? c.accent : c.muted }}>{value}</Text></Pressable>)}</ScrollView><Primary label={typeof circle === 'string' ? 'Share with Circle' : 'Save to personal stickers'} disabled={busy} onPress={() => { void save(); }} /></View></FeedbackSheet>
  </View></SafeAreaView>;
}
