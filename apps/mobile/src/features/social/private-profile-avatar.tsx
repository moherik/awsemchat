import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { fromByteArray } from 'base64-js';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { MediaDescriptor } from '../media/encrypted-media';
import type { PrivateProfilePhoto } from './private-profile-photo-store';
import { usePalette } from '../ui';

const noop = () => () => undefined;
const signedOut = Object.freeze({ status: 'signed-out' as const });

export function PrivateProfileAvatar({ name, size = 48, runtime, peerId, requestId, avatar, localPhoto }: {
  name: string;
  size?: number;
  runtime?: AuthenticationRuntime;
  peerId?: string;
  requestId?: string;
  avatar?: MediaDescriptor | null;
  localPhoto?: PrivateProfilePhoto | null;
}) {
  const c = usePalette();
  const account = useSyncExternalStore(runtime?.owner?.subscribe ?? noop, runtime?.owner?.getSnapshot ?? (() => signedOut), () => signedOut);
  const selection = JSON.stringify([peerId, requestId, avatar]);
  const [remote, setRemote] = useState<{ selection: string; account: typeof account; uri: string }>();
  const [failed, setFailed] = useState<{ selection: string; account: typeof account; attempt: number }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!runtime || !peerId || !requestId || !avatar || account.status !== 'ready') return;
    let active = true;
    void runtime.privateProfilePhotoBytes(peerId, requestId, avatar).then(bytes => {
      const current = runtime.owner.getSnapshot();
      if (active && current === account) { setRemote({ selection, account, uri: `data:${avatar.mimeType};base64,${fromByteArray(bytes)}` }); setFailed(undefined); }
    }).catch(() => {
      if (active && runtime.owner.getSnapshot() === account) { setRemote(undefined); setFailed({ selection, account, attempt }); }
    });
    return () => { active = false; };
  }, [runtime, peerId, requestId, avatar, selection, account, attempt]);
  const localURI = localPhoto ? `data:${localPhoto.mimeType};base64,${fromByteArray(localPhoto.bytes)}` : undefined;
  const uri = localURI ?? (remote?.selection === selection && remote.account === account ? remote.uri : undefined);
  const unavailable = !!avatar && failed?.selection === selection && failed.account === account && failed.attempt === attempt;
  return <View style={{ width: size, height: size, borderRadius: size * .18, overflow: 'hidden', backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
    {uri ? <Image accessibilityLabel={localPhoto ? 'Your profile photo' : `Profile photo of ${name}`} source={{ uri }} cachePolicy="none" contentFit="cover" style={{ width: size, height: size }} onError={() => { if (runtime) setFailed({ selection, account, attempt }); }} />
      : avatar ? unavailable ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry profile photo of ${name}`} onPress={() => setAttempt(value => value + 1)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="refresh" size={22} color={c.muted} /></Pressable> : <ActivityIndicator accessibilityLabel={`Loading profile photo of ${name}`} color={c.accent} />
        : <Text accessibilityLabel={`${name || 'Your'} initials avatar`} style={{ color: c.accent, fontSize: size * .44, fontWeight: '400' }}>{name.trim().charAt(0).toLocaleUpperCase() || 'Y'}</Text>}
  </View>;
}
