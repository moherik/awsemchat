import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

export function nativeCrypto(): { execute(input: string): Promise<string>; executeArchive(input: string): Promise<string>; executeDurable(namespace: string, input: string): Promise<string>; durableProbe(namespace: string, action: string, input: string): Promise<string> } {
  if (Platform.OS !== 'android') throw new Error('UNSUPPORTED_PLATFORM');
  return requireNativeModule('AwsemchatCrypto');
}
