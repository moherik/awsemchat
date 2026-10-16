import * as Crypto from 'expo-crypto';
import { accountNamespace, guardAccountOperation, signAccountPublication } from './account-encryption';
import { durableEncryption, DurableEncryptionError } from './durable-encryption';
import type { createSessionOwner } from '../features/auth/session-owner';

export async function bindAccountEncryption(owner: ReturnType<typeof createSessionOwner>, origin: string) {
  const session = owner.requireSession();
  const bound = Object.freeze({ account: Object.freeze({ ...session.account }), deviceId: session.deviceId, generation: session.generation });
  const namespace = await accountNamespace(origin, bound, value => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value));
  const adapter = durableEncryption(namespace);
  await guardAccountOperation(owner.requireSession, bound, async () => {
    try { return await adapter.initialize(); } catch (error) {
      if (!(error instanceof DurableEncryptionError) || error.code !== 'ALREADY_EXISTS') throw error;
      return adapter.bundle();
    }
  });
  const boundAdapter = { ...adapter, signPublication: (operation: string) =>
    signAccountPublication(owner.requireSession, bound, operation, adapter.signPublication) };
  return new Proxy(boundAdapter, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => guardAccountOperation(owner.requireSession, bound, async () => Reflect.apply(value, target, args));
    },
  });
}
