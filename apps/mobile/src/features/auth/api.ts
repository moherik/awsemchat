export type Challenge = { challengeId: string; expiresAt: string; status?: 'pending' };
export type Session = { accessToken: string; account: { id: string; pin: string }; deviceId: string; generation: number; expiresAt: string };
export type SessionIdentity = { accountId: string; deviceId: string; generation: number; expiresAt: string };
export class AuthError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = 'AuthError'; this.code = code; }
}
const knownErrors = new Set(['INVALID_INPUT', 'RATE_LIMITED', 'INVALID_CODE', 'EXPIRED', 'CONSUMED', 'SESSION_REVOKED', 'UNAVAILABLE']);
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const tokenValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value);
const expiryValid = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now();
const generationValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function identity(value: unknown): SessionIdentity {
  const data = object(value);
  if (!identifier(data.accountId) || !identifier(data.deviceId) || !generationValid(data.generation) || !expiryValid(data.expiresAt)) throw new AuthError('INVALID_RESPONSE');
  return { accountId: data.accountId, deviceId: data.deviceId, generation: data.generation, expiresAt: data.expiresAt };
}
export function createAuthAPI(baseURL: string, development = false) {
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new AuthError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new AuthError('CONFIGURATION');
  const origin = url.origin;
  async function request(path: string, method: string, body?: unknown, token?: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${origin}${path}`, { method, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, redirect: 'error' });
      if (response.status === 204 && response.ok) return undefined;
      const text = await response.text();
      if (text.length > 8192) throw new AuthError('INVALID_RESPONSE');
      let data: unknown;
      try { data = JSON.parse(text); } catch { throw new AuthError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE'); }
      if (!response.ok) {
        const error = object(data);
        throw new AuthError(typeof error.code === 'string' && knownErrors.has(error.code) ? error.code : 'UNAVAILABLE');
      }
      return data;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  return {
    async start(phone: string, deviceId: string, operationId: string): Promise<Challenge> {
      const data = object(await request('/v1/auth/challenges', 'POST', { phone, deviceId, operationId }));
      if (!identifier(data.challengeId) || !expiryValid(data.expiresAt) || (data.status !== undefined && data.status !== 'pending')) throw new AuthError('INVALID_RESPONSE');
      return { challengeId: data.challengeId, expiresAt: data.expiresAt, ...(data.status === 'pending' ? { status: 'pending' } : {}) };
    },
    async verify(challengeId: string, code: string, deviceId: string): Promise<Session> {
      const data = object(await request('/v1/auth/verify', 'POST', { challengeId, code, deviceId }));
      const account = object(data.account);
      if (!tokenValid(data.accessToken) || !identifier(account.id) || typeof account.pin !== 'string' || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(account.pin)) throw new AuthError('INVALID_RESPONSE');
      const validated = identity({ accountId: account.id, deviceId: data.deviceId, generation: data.generation, expiresAt: data.expiresAt });
      if (validated.deviceId !== deviceId) throw new AuthError('INVALID_RESPONSE');
      return { accessToken: data.accessToken, account: { id: account.id, pin: account.pin }, deviceId: validated.deviceId, generation: validated.generation, expiresAt: validated.expiresAt };
    },
    async session(token: string): Promise<SessionIdentity> {
      if (!tokenValid(token)) throw new AuthError('SESSION_REVOKED');
      return identity(await request('/v1/session', 'GET', undefined, token));
    },
    async logout(token: string): Promise<void> {
      if (!tokenValid(token)) throw new AuthError('SESSION_REVOKED');
      await request('/v1/auth/logout', 'POST', undefined, token);
    },
  };
}
