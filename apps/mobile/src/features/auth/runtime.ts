import * as Crypto from 'expo-crypto';
import { AuthError, createAuthAPI } from './api';
import { createSessionOwner } from './session-owner';
import { createSessionVault, installationDeviceId } from './session-vault';
import { createLoginFlow } from './login-flow';
import { bindAccountEncryption } from '../../security/bound-encryption';
import { createSocialAPI } from '../social/api';
import { createFriendsFlow } from '../social/friends-flow';

async function initialize() {
  const origin = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://127.0.0.1:8088' : '');
  const api = createAuthAPI(origin, __DEV__);
  const device = await installationDeviceId();
  const vault = await createSessionVault(new URL(origin).origin);
  const owner = createSessionOwner(api, vault, device);
  let encryption: Awaited<ReturnType<typeof bindAccountEncryption>> | undefined;
  const flow = createLoginFlow(owner, async () => {
    encryption = await bindAccountEncryption(owner, new URL(origin).origin);
  }, Crypto.randomUUID);
  await flow.restore();
  const social = createSocialAPI(origin, () => owner.requireSession(), __DEV__);
  const friends = createFriendsFlow(social, owner);
  return { owner, flow, social, friends, developmentCode: (phone: string) => api.developmentCode(phone), encryption() {
    owner.requireSession();
    if (!encryption || flow.getSnapshot().phase !== 'ready') throw new AuthError('UNAVAILABLE');
    return encryption;
  } };
}
export type AuthenticationRuntime = Awaited<ReturnType<typeof initialize>>;
let pending: Promise<AuthenticationRuntime> | undefined;
export function authenticationRuntime(): Promise<AuthenticationRuntime> {
  if (!pending) pending = initialize().catch(error => { pending = undefined; throw error; });
  return pending;
}
