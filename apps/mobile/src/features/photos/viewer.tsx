import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { SnackbarHost, dismissFeedback, showFeedback } from '../feedback/snackbar';
import { downloadPhoto } from './download';
export type ViewedPhoto = { uri: string; caption?: string; title?: string };
export function PhotoViewer({ photo, onClose }: { photo: ViewedPhoto; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); const id = showFeedback('Saving image…', 0); try { await downloadPhoto(photo.uri); showFeedback('Image saved.'); } catch (error) { showFeedback(error instanceof Error ? error.message : 'Could not save the image. Try again.'); } finally { dismissFeedback(id); setBusy(false); } };
  return <Modal visible animationType="fade" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, backgroundColor: '#10171C' }}><View style={{ flexDirection: 'row', alignItems: 'center', height: 60, paddingHorizontal: 8 }}><Pressable accessibilityRole="button" accessibilityLabel="Close image preview" onPress={onClose} style={{ padding: 14 }}><Icon name="arrow-left" size={24} color="#fff" /></Pressable><Text style={{ color: '#fff', fontSize: 17, fontWeight: '600', flex: 1 }}>{photo.title ?? 'Photo'}</Text><Pressable accessibilityRole="button" accessibilityLabel="Download image" disabled={busy} onPress={save} style={{ padding: 14 }}><Icon name="download" size={24} color="#fff" /></Pressable></View><Image accessibilityLabel={photo.caption || 'Full size photo'} source={{ uri: photo.uri }} contentFit="contain" style={{ flex: 1, width: '100%' }} />{photo.caption ? <ScrollView style={{ maxHeight: 140 }} contentContainerStyle={{ padding: 20 }}><Text style={{ color: '#fff', fontSize: 16, lineHeight: 24 }}>{photo.caption}</Text></ScrollView> : null}<SnackbarHost sheet /></SafeAreaView></Modal>;
}
