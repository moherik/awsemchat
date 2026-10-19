import { usePathname } from 'expo-router';
import { FeedbackOverlay } from './overlay';
import { useEffect, useId, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { dismissFeedback, feedbackStore, registerFeedbackSurface } from './store';
export { showFeedback, dismissFeedback } from './store';

export function SnackbarHost({ sheet = false, active = true }: { sheet?: boolean; active?: boolean }) {
  const pathname = usePathname();
  const bottomBarHeight = pathname === '/' || pathname === '/chat' ? 72 : 0;
  const id = useId(); const insets = useSafeAreaInsets();
  const { feedback, surface } = useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot, feedbackStore.getServerSnapshot);
  useEffect(() => { if (sheet && active) return registerFeedbackSurface(id); }, [sheet, active, id]);
  if (!active || !feedback || surface !== (sheet ? id : 'root')) return null;
  return <FeedbackOverlay sheet={sheet}>
    <View pointerEvents="box-none" style={{ paddingHorizontal: 16, paddingBottom: sheet ? 12 : Math.max(insets.bottom, 12) + bottomBarHeight, alignItems: 'center' }}>
      <View accessibilityLiveRegion="polite" role="status" style={{ width: '100%', maxWidth: 568, flexDirection: 'row', alignItems: 'center', backgroundColor: '#26343D', borderRadius: 8, paddingLeft: 16, paddingVertical: 8, minHeight: 56, shadowColor: '#000', shadowOpacity: .18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }}>
        <Text style={{ flex: 1, color: '#FFFFFF', fontSize: 14, lineHeight: 21, paddingVertical: 4 }}>{feedback.message}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => dismissFeedback(feedback.id)} style={{ width: 48, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={20} color="#FFFFFF" /></Pressable>
      </View>
    </View>
  </FeedbackOverlay>;
}
