import { AuthError, parseSession } from './api.ts';
import type { Session, SessionIdentity, Challenge } from './api.ts';
export type SessionVault = { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> };
export type AuthTransport = { start(phone: string, deviceId: string, operationId: string): Promise<Challenge>; verify(challengeId: string, code: string, deviceId: string): Promise<Session>; session(token: string): Promise<SessionIdentity>; logout(token: string): Promise<void> };
export type AuthSnapshot = { status: 'signed-out' | 'checking' | 'ready' | 'offline' | 'locked'; account?: { id: string; pin: string }; generation?: number };
export function createSessionOwner(api: AuthTransport, vault: SessionVault, deviceId: string) {
  let current: Session | null = null;
  let challenge: Challenge | null = null;
  let snapshot: AuthSnapshot = Object.freeze({ status: 'signed-out' });
  const listeners = new Set<() => void>();
  let tail: Promise<void> = Promise.resolve();
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job);
    tail = result.then(() => {}, () => {});
    return result;
  }
  function publish(status: AuthSnapshot['status'], session?: Session) {
    snapshot = Object.freeze({ status, ...(session ? { account: Object.freeze({ ...session.account }), generation: session.generation } : {}) });
    for (const listener of listeners) { try { listener(); } catch { /* Subscriber failure must not alter authentication. */ } }
  }
  async function clear() {
    current = null;
    challenge = null;
    publish('signed-out');
    try { await vault.clear(); } catch { publish('locked'); throw new AuthError('STORAGE'); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore: () => serial(async () => {
      current = null;
      publish('checking');
      let raw: string | null;
      try { raw = await vault.read(); } catch { publish('locked'); throw new AuthError('STORAGE'); }
      if (raw === null) { publish('signed-out'); return; }
      let saved: Session;
      try { saved = parseSession(JSON.parse(raw), deviceId); } catch { await clear(); return; }
      let validated: SessionIdentity;
      try { validated = await api.session(saved.accessToken); } catch (error) {
        if (error instanceof AuthError && error.code === 'SESSION_REVOKED') { await clear(); return; }
        if (error instanceof AuthError && ['NETWORK', 'UNAVAILABLE'].includes(error.code)) { current = saved; publish('offline', saved); return; }
        publish('locked'); throw error;
      }
      if (validated.accountId !== saved.account.id || validated.deviceId !== deviceId || validated.generation !== saved.generation) { await clear(); return; }
      current = saved;
      publish('ready', saved);
    }),
    start: (phone: string, operationId: string) => serial(async () => {
      challenge = null;
      const next = await api.start(phone, deviceId, operationId);
      challenge = { ...next };
      return { ...next };
    }),
    verify: (code: string) => serial(async () => {
      if (!challenge || Date.parse(challenge.expiresAt) <= Date.now()) throw new AuthError('EXPIRED');
      if (challenge.status === 'pending') throw new AuthError('UNAVAILABLE');
      const session = await api.verify(challenge.challengeId, code, deviceId);
      challenge = null;
      current = null;
      try { await vault.write(JSON.stringify(session)); } catch {
        publish('locked');
        try { await api.logout(session.accessToken); } catch { /* Next successful phone verification revokes an unreachable token. */ }
        throw new AuthError('STORAGE');
      }
      current = session;
      publish('ready', session);
    }),
    logout: () => serial(async () => {
      let revocationError: unknown;
      if (current) {
        try { await api.logout(current.accessToken); }
        catch (error) { revocationError = error; }
      }
      await clear();
      if (revocationError) throw revocationError;
    }),
    requireSession(): Session {
      if (snapshot.status === 'offline') throw new AuthError('NETWORK');
      if (snapshot.status !== 'ready' || !current) throw new AuthError('SESSION_REVOKED');
      if (Date.parse(current.expiresAt) <= Date.now()) throw new AuthError('EXPIRED');
      return { ...current, account: { ...current.account } };
    },
  };
}
