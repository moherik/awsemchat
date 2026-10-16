import type { DriveSession } from './drive-api';
export const driveScope = 'https://www.googleapis.com/auth/drive.appdata';
export type GoogleGrant = { accessToken: string; grantedScopes: string[] };
type Ports = {
  authorize(): Promise<GoogleGrant | null>; identity(token: string): Promise<{ subject: string }>;
  binding(): string; fingerprint(subject: string): Promise<string>;
};
type Snapshot = { status: 'disconnected' | 'connecting' | 'connected'; subject?: string };
export function createGoogleConnection(ports: Ports) {
  let snapshot: Snapshot = Object.freeze({ status: 'disconnected' });
  let connected: (DriveSession & { owner: string; subject: string }) | null = null;
  let revision = 0;
  let pending = false;
  const listeners = new Set<() => void>();
  function publish(status: Snapshot['status']) {
    snapshot = Object.freeze({ status, ...(status === 'connected' && connected ? { subject: connected.subject } : {}) });
    for (const listener of listeners) { try { listener(); } catch { /* UI listeners cannot alter Google authorization. */ } }
  }
  function disconnect() { revision++; connected = null; publish('disconnected'); }
  function guard(owner: string, expectedRevision: number) {
    if (ports.binding() !== owner || revision !== expectedRevision) throw new Error('SESSION_REVOKED');
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    disconnect,
    session(): DriveSession {
      if (!connected) throw new Error('DRIVE_AUTH_REQUIRED');
      let owner: string;
      try { owner = ports.binding(); } catch { disconnect(); throw new Error('SESSION_REVOKED'); }
      if (owner !== connected.owner) { disconnect(); throw new Error('SESSION_REVOKED'); }
      return { accessToken: connected.accessToken, binding: connected.binding };
    },
    async connect() {
      if (pending) throw new Error('BUSY');
      const owner = ports.binding();
      const expectedRevision = revision;
      pending = true;
      publish('connecting');
      try {
        const grant = await ports.authorize();
        guard(owner, expectedRevision);
        if (!grant) { publish(connected ? 'connected' : 'disconnected'); return; }
        if (typeof grant.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,4096}$/.test(grant.accessToken) ||
          !Array.isArray(grant.grantedScopes) || !grant.grantedScopes.includes(driveScope) || !grant.grantedScopes.includes('openid')) throw new Error('DRIVE_AUTH_REQUIRED');
        const identity = await ports.identity(grant.accessToken);
        guard(owner, expectedRevision);
        if (typeof identity.subject !== 'string' || !/^[!-~]{1,255}$/.test(identity.subject)) throw new Error('INVALID_RESPONSE');
        const fingerprint = await ports.fingerprint(identity.subject);
        guard(owner, expectedRevision);
        connected = { accessToken: grant.accessToken, binding: fingerprint, subject: identity.subject, owner };
        publish('connected');
      } catch (error) {
        connected = null;
        publish('disconnected');
        const code = error instanceof Error ? error.message : '';
        throw new Error(['DRIVE_AUTH_REQUIRED', 'SESSION_REVOKED', 'INVALID_RESPONSE', 'NOT_CONFIGURED', 'NATIVE_REQUIRED'].includes(code) ? code : 'UNAVAILABLE');
      } finally { pending = false; }
    },
  };
}
