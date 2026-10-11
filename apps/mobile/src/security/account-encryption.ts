import { AuthError } from '../features/auth/api.ts';
import type { Session } from '../features/auth/api.ts';
export type AccountBinding = Pick<Session, 'account' | 'deviceId' | 'generation'>;
export async function accountNamespace(origin: string, binding: AccountBinding, digest: (value: string) => Promise<string>): Promise<string> {
  const value = JSON.stringify(['awsemchat.device.v1', origin, binding.account.id, binding.deviceId, binding.generation]);
  const hash = await digest(value);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new AuthError('UNAVAILABLE');
  return `acct-${hash.slice(0, 32)}`;
}
export async function guardAccountOperation<T>(current: () => Session, bound: AccountBinding, operation: () => Promise<T>): Promise<T> {
  const check = () => {
    const active = current();
    if (active.account.id !== bound.account.id || active.deviceId !== bound.deviceId || active.generation !== bound.generation) throw new AuthError('SESSION_REVOKED');
  };
  check();
  const result = await operation();
  check();
  return result;
}
