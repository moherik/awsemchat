import { requireNativeModule } from 'expo';
import { authorizeGoogle } from './google-authorizer';
export async function nativeGoogleAuthorize() {
  if (process.env.EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED !== 'true') throw new Error('NOT_CONFIGURED');
  return authorizeGoogle(() => requireNativeModule<{ authorize(): Promise<unknown> }>('AwsemchatGoogleDrive').authorize());
}
