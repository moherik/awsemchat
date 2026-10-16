import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { authenticationRuntime } from '../auth/runtime';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';
import { createPushRegistration } from './registration';

const configuredProjectId = Constants.expoConfig?.extra?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

if (typeof Notifications.setNotificationHandler === 'function') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

function errorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'PHYSICAL_DEVICE_REQUIRED') return 'Push notifications need a supported device.';
  if (code === 'EXPO_PROJECT_NOT_CONFIGURED') return 'Push setup is incomplete. Add the EAS project ID before enabling notifications.';
  if (code === 'NOTIFICATIONS_UNAVAILABLE') return 'Notifications are unavailable in this app build.';
  return 'Could not update notifications. Check your connection and try again.';
}

export function NativeNotificationsScreen(props: { notifications?: typeof Notifications; physicalDevice?: boolean; projectId?: string; platform?: string } = {}) {
  const notificationPort = props.notifications ?? Notifications;
  const physicalDevice = props.physicalDevice ?? Device.isDevice;
  const easProjectId = props.projectId ?? configuredProjectId;
  const c = usePalette();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setupReady = Boolean(easProjectId?.trim());
  const androidAvailable = (props.platform ?? Platform.OS) === 'android';
  const unavailableReason = !physicalDevice && !androidAvailable ? 'Use a supported device to turn on push notifications.' : !setupReady ? 'Push setup is incomplete. An EAS project ID is needed before this phone can register.' : '';
  const runtimeTask = useMemo(() => authenticationRuntime(), []);

  useEffect(() => {
    let active = true;
    void runtimeTask.then(async runtime => {
      const registered = await runtime.notifications.status();
      const permission = typeof notificationPort.getPermissionsAsync === 'function'
        ? await notificationPort.getPermissionsAsync()
        : { granted: true };
      if (registered && !permission.granted) await runtime.notifications.unregister();
      if (active) setEnabled(registered && permission.granted);
    }).catch(() => {
      if (active) setError('Could not load this setting. Check your connection and retry.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [notificationPort, runtimeTask]);

  const toggle = async () => {
    if (saving || loading || (unavailableReason && !enabled)) return;
    setSaving(true);
    setError('');
    try {
      const runtime = await runtimeTask;
      if (enabled) {
        await runtime.notifications.unregister();
        setEnabled(false);
        showFeedback('Notifications are off for this phone.');
      } else {
        const registration = createPushRegistration({
          platform: props.platform ?? Platform.OS,
          projectId: easProjectId,
          physicalDevice,
          notifications: notificationPort,
          mutedConversations: async () => {
            const preferences = await runtime.conversationPreferences();
            return Object.entries(preferences.getSnapshot().values).filter(([, value]) => value.muted).map(([id]) => id);
          },
          api: runtime.notifications,
        });
        const granted = await registration.enable();
        setEnabled(granted);
        if (granted) showFeedback('Notifications are on for this phone.');
        else setError('AwsemChat needs notification permission to send alerts. You can allow it in Android settings.');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally { setSaving(false); }
  };

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Notifications</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 14, gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="bell-outline" size={24} color={c.accent} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{enabled ? 'On for this phone' : 'Stay in touch'}</Text>
          <Text style={{ color: c.muted, fontSize: 14 }}>{enabled ? 'You can turn alerts off at any time.' : 'Choose whether AwsemChat can alert you to new messages.'}</Text>
        </View>
      </View>

      <View style={{ borderRadius: 12, backgroundColor: c.bg, padding: 16, gap: 8 }}>
        <Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>Your privacy comes first</Text>
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>Notifications never include message text, names, or photos. The alert only says “You have a new message.” Muted chats and Circles stay quiet.</Text>
      </View>

      {loading ? <ActivityIndicator accessibilityLabel="Loading notification settings" color={c.accent} /> : null}
      {unavailableReason ? <Text accessibilityRole="alert" style={{ color: c.muted, fontSize: 14, lineHeight: 21 }}>{unavailableReason}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: c.text, fontSize: 14, lineHeight: 21 }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={enabled ? 'Turn off notifications' : 'Turn on notifications'} accessibilityState={{ disabled: saving || loading || Boolean(unavailableReason && !enabled), busy: saving }} disabled={saving || loading || Boolean(unavailableReason && !enabled)} onPress={() => { void toggle(); }} style={{ minHeight: 50, borderRadius: 9, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', opacity: saving || loading || (unavailableReason && !enabled) ? 0.55 : 1 }}>
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600' }}>{enabled ? 'Turn off notifications' : 'Turn on notifications'}</Text>}
      </Pressable>
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>Push alerts are optional. AwsemChat does not read your notification tray or other apps to send message alerts.</Text>
    </ScrollView>
  </SafeAreaView>;
}
