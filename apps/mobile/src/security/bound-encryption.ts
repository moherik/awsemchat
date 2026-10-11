import { AuthError } from '../features/auth/api';
import type { createSessionOwner } from '../features/auth/session-owner';
import type { durableEncryption } from './durable-encryption';

export async function bindAccountEncryption(owner: ReturnType<typeof createSessionOwner>, origin: string): Promise<ReturnType<typeof durableEncryption>> {
  throw new AuthError('NATIVE_REQUIRED');
}
