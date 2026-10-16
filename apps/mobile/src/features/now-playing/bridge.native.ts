import { Platform } from 'react-native';
import { requireNativeModule } from 'expo';
import { createNowPlayingBridge, type NativeNowPlaying } from './bridge.ts';

const native = () => {
  if (Platform.OS !== 'android') throw new Error('UNSUPPORTED_PLATFORM');
  return requireNativeModule<NativeNowPlaying>('AwsemchatMediaSessions');
};
export const nowPlayingBridge = createNowPlayingBridge({
  hasNotificationAccess: async () => native().hasNotificationAccess(),
  openNotificationAccessSettings: async () => native().openNotificationAccessSettings(),
  getActiveTrack: async () => native().getActiveTrack(),
}, Platform.OS);
