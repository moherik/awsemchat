import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { NativeChatList } from './messages/native-chat-list';
import { NativeFriends } from './social/friends-screen';
import { NativePrivateProfile } from './social/private-profile-screen';
import { usePalette } from './ui';

const tabs = [
  { key: 'Chats', icon: 'message-text-outline' },
  { key: 'Friends', icon: 'account-multiple-outline' },
  { key: 'You', icon: 'account-circle-outline' },
] as const;

export function NativeHome() {
  const c = usePalette();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [localTab, setLocalTab] = useState('Chats');
  const tab = tabs.some(item => item.key === params.tab) ? params.tab! : localTab;
  const selectTab = (value: string) => {
    setLocalTab(value);
    router.setParams({ tab: value });
  };

  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: c.surface }}>
      <View style={{ minHeight: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
        <Text style={{ flex: 1, color: c.text, fontSize: 20, fontWeight: '600' }}>{tab}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push({ pathname: '/flow', params: { view: 'settings' } })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cog-outline" size={23} color={c.muted} />
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'Chats' ? <NativeChatList /> : tab === 'Friends' ? <NativeFriends /> : <NativePrivateProfile mode="home" />}
      </View>
      <View accessibilityRole="tablist" style={{ minHeight: 58, flexDirection: 'row', borderTopWidth: 0.5, borderColor: c.line, backgroundColor: c.surface }}>
        {tabs.map(item => <Pressable key={item.key} accessibilityRole="tab" accessibilityLabel={item.key} accessibilityState={{ selected: tab === item.key }} onPress={() => selectTab(item.key)} style={{ flex: 1, minHeight: 54, alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <Icon name={item.icon} size={23} color={tab === item.key ? c.accent : c.muted} />
          <Text style={{ color: tab === item.key ? c.accent : c.muted, fontSize: 11, fontWeight: tab === item.key ? '600' : '400' }}>{item.key}</Text>
        </Pressable>)}
      </View>
    </View>
  </SafeAreaView>;
}
