import { AuthError } from '../features/auth/api';
import type { createSessionOwner } from '../features/auth/session-owner';
import type { durableEncryption, SignedRegistration } from './durable-encryption';

export type AccountEncryption = Omit<ReturnType<typeof durableEncryption>, 'signPublication'> & {
  signPublication(operation: string): Promise<SignedRegistration>;
};

export async function bindAccountEncryption(owner: ReturnType<typeof createSessionOwner>, origin: string): Promise<AccountEncryption> {
  throw new AuthError('NATIVE_REQUIRED');
}
