import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { fromByteArray } from 'base64-js';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { CircleAvatar } from './circle-profile';
import { usePalette } from '../ui';

export function CircleAvatarView({ runtime, circleId, avatar, size = 44 }: { runtime: AuthenticationRuntime; circleId: string; avatar: CircleAvatar | null; size?: number }) {
  const c = usePalette(), account = useSyncExternalStore(runtime.owner.subscribe, runtime.owner.getSnapshot, runtime.owner.getSnapshot);
  const selection = JSON.stringify(avatar);
  const [image, setImage] = useState<{ selection: string; account: typeof account; uri: string }>();
  const [failure, setFailure] = useState<{ selection: string; account: typeof account; attempt: number }>(), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const selected: CircleAvatar | null = JSON.parse(selection);
    if (selected && account.status === 'ready') void runtime.circleAvatarBytes(circleId, selected).then(bytes => {
      if (active && runtime.owner.getSnapshot() === account) setImage({ selection, account, uri: `data:${selected.media.mimeType};base64,${fromByteArray(bytes)}` });
    }, () => { if (active) { setImage(undefined); setFailure({ selection, account, attempt }); } });
    return () => { active = false; };
  }, [runtime, circleId, selection, account, attempt]);
  const visible = image?.selection === selection && image.account === account ? image.uri : undefined;
  const failed = failure?.selection === selection && failure.account === account && failure.attempt === attempt;
  return <View style={{ width: size, height: size, borderRadius: size * .18, overflow: 'hidden', backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
    {visible ? <Image accessibilityLabel="Circle picture" source={{ uri: visible }} onError={() => { setImage(undefined); setFailure({ selection, account, attempt }); }} cachePolicy="none" style={{ width: size, height: size }} contentFit="cover" /> : avatar ? failed ? <Pressable accessibilityRole="button" accessibilityLabel="Retry Circle picture" onPress={() => setAttempt(value => value + 1)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="refresh" size={24} color={c.muted} /></Pressable> : <ActivityIndicator accessibilityLabel="Loading Circle picture" color={c.accent} /> : <Icon name="account-group-outline" size={size * .55} color={c.muted} />}
  </View>;
}
