import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useDeviceAppearance } from './appearance-runtime';
import { showFeedback } from './feedback/snackbar';
import { usePalette } from './ui';

const choices = [
  { key: 'system', label: 'Use device theme', detail: 'Follow your Android display setting.' },
  { key: 'light', label: 'Light', detail: 'Use a light appearance on this device.' },
  { key: 'dark', label: 'Dark', detail: 'Use a dark appearance on this device.' },
] as const;

export function NativeAppearanceScreen() {
  const c = usePalette();
  const appearance = useDeviceAppearance();
  const [saving, setSaving] = useState(false);
  const choose = async (theme: typeof choices[number]['key']) => {
    if (saving || appearance.theme === theme) return;
    setSaving(true);
    try { await appearance.setTheme(theme); showFeedback('Appearance saved on this device.'); }
    catch { showFeedback('Could not save your appearance. Try again.'); }
    finally { setSaving(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Appearance</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14 }}>
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20, paddingVertical: 10 }}>Choose how AwsemChat looks on this phone.</Text>
      {appearance.phase === 'error' ? <Pressable accessibilityRole="button" onPress={() => { void appearance.load().catch(() => undefined); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Could not load this setting. Tap to retry.</Text></Pressable> : null}
      {appearance.phase === 'loading' ? <ActivityIndicator accessibilityLabel="Loading appearance" color={c.accent} /> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="Appearance options">
        {choices.map(choice => <Pressable key={choice.key} accessibilityRole="radio" accessibilityLabel={choice.label} accessibilityState={{ checked: appearance.theme === choice.key, disabled: saving || appearance.phase !== 'ready' }} disabled={saving || appearance.phase !== 'ready'} onPress={() => { void choose(choice.key); }} style={{ minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}>
          <Icon name={appearance.theme === choice.key ? 'radiobox-marked' : 'radiobox-blank'} size={23} color={appearance.theme === choice.key ? c.accent : c.muted} />
          <View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{choice.label}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{choice.detail}</Text></View>
        </Pressable>)}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
