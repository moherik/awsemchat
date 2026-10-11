import { AuthError } from './api.ts';
import type { SessionVault } from './session-owner.ts';

export async function createSessionVault(origin: string): Promise<SessionVault> {
  throw new AuthError('NATIVE_REQUIRED');
}
export async function installationDeviceId(): Promise<string> {
  throw new AuthError('NATIVE_REQUIRED');
}
