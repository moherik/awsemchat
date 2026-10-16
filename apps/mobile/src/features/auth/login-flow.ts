import { AuthError } from './api.ts';
import type { createSessionOwner } from './session-owner.ts';
export type LoginSnapshot = { phase: 'phone' | 'code' | 'preparing' | 'ready' | 'offline' | 'locked'; busy: boolean; phone: string; error?: string };
export function createLoginFlow(owner: ReturnType<typeof createSessionOwner>, prepareEncryption: () => Promise<unknown>, newOperation: () => string) {
  let snapshot: LoginSnapshot = Object.freeze({ phase: 'phone', busy: false, phone: '' });
  let attempt: { phone: string; operation: string } | undefined;
  const listeners = new Set<() => void>();
  function publish(change: Partial<LoginSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...change });
    for (const listener of listeners) { try { listener(); } catch { /* A rendering failure cannot change the login result. */ } }
  }
  async function execute(job: () => Promise<void>) {
    if (snapshot.busy) throw new AuthError('BUSY');
    publish({ busy: true, error: undefined });
    try { await job(); } catch (error) {
      const safe = error instanceof AuthError ? error : new AuthError('UNAVAILABLE');
      if (['EXPIRED', 'CONSUMED'].includes(safe.code)) { attempt = undefined; publish({ phase: 'phone' }); }
      if (safe.code === 'STORAGE') publish({ phase: 'locked' });
      publish({ error: safe.code });
      throw safe;
    } finally { publish({ busy: false }); }
  }
  async function prepare() {
    publish({ phase: 'preparing' });
    await prepareEncryption();
    publish({ phase: 'ready' });
  }
  async function send(phone: string) {
    if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new AuthError('INVALID_INPUT');
    if (!attempt || attempt.phone !== phone) attempt = { phone, operation: newOperation() };
    const challenge = await owner.start(phone, attempt.operation);
    publish({ phone });
    if (challenge.status === 'pending') throw new AuthError('UNAVAILABLE');
    publish({ phase: 'code' });
  }
  return {
    getSnapshot: () => snapshot,
    logout: () => execute(async () => {
      try { await owner.logout(); }
      catch (error) {
        if (owner.getSnapshot().status === 'signed-out') {
          attempt = undefined;
          publish({ phase: 'phone', phone: '' });
        }
        throw error;
      }
      attempt = undefined;
      publish({ phase: 'phone', phone: '' });
    }),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: () => execute(async () => {
      await owner.restore();
      const status = owner.getSnapshot().status;
      if (status === 'ready') await prepare();
      else publish({ phase: status === 'offline' ? 'offline' : status === 'locked' ? 'locked' : 'phone' });
    }),
    submitPhone: (raw: string) => execute(() => send(raw.replace(/\s/g, ''))),
    verify: (code: string) => execute(async () => {
      if (snapshot.phase !== 'code' || !/^[0-9]{6}$/.test(code)) throw new AuthError('INVALID_INPUT');
      await owner.verify(code);
      await prepare();
    }),
    retryPreparation: () => execute(async () => {
      if (owner.getSnapshot().status !== 'ready') throw new AuthError('SESSION_REVOKED');
      await prepare();
    }),
    resend: () => {
      const retry = snapshot.error && ['NETWORK', 'UNAVAILABLE'].includes(snapshot.error);
      return execute(async () => {
        if (snapshot.phase !== 'code') throw new AuthError('INVALID_INPUT');
        if (!retry) attempt = undefined;
        await send(snapshot.phone);
      });
    },
    changeNumber() {
      if (snapshot.busy) return;
      attempt = undefined;
      publish({ phase: 'phone', phone: '', error: undefined });
    },
  };
}
