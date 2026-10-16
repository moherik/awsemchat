type Session = Readonly<{ accessToken: string; account: Readonly<{ id: string }>; deviceId: string; generation: number }>;
type Fetcher = (url: string, options: RequestInit) => Promise<Response>;
const conversationId = /^(?:private:[a-f0-9]{64}|circle:[A-Za-z0-9._:-]{1,128})$/;

export class NotificationAPIError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'NotificationAPIError'; this.code = code; }
}

export function createNotificationAPI(origin: string, session: () => Session, fetcher: Fetcher = fetch) {
  let url: URL;
  try { url = new URL(origin); } catch { throw new NotificationAPIError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new NotificationAPIError('CONFIGURATION');
  }
  async function request(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', payload?: object) {
    const before = session();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`${url.origin}${path}`, {
        method,
        headers: { Authorization: `Bearer ${before.accessToken}`, Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        redirect: 'error', signal: controller.signal,
      });
      const raw = await response.text();
      const after = session();
      if (before.account.id !== after.account.id || before.deviceId !== after.deviceId || before.generation !== after.generation || before.accessToken !== after.accessToken) {
        throw new NotificationAPIError('SESSION_CHANGED');
      }
      if (raw.length > 2048) throw new NotificationAPIError('INVALID_RESPONSE');
      if (method === 'GET' && response.status === 200) {
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new NotificationAPIError('INVALID_RESPONSE'); }
        if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || typeof (value as { registered?: unknown }).registered !== 'boolean') {
          throw new NotificationAPIError('INVALID_RESPONSE');
        }
        return (value as { registered: boolean }).registered;
      }
      if (response.status === 204 && response.ok && raw === '') return;
      let value: unknown;
      try { value = JSON.parse(raw); } catch { throw new NotificationAPIError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE'); }
      const code = value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined;
      if (!response.ok) throw new NotificationAPIError(typeof code === 'string' && ['INVALID_INPUT', 'SESSION_REVOKED'].includes(code) ? code : 'UNAVAILABLE');
      throw new NotificationAPIError('INVALID_RESPONSE');
    } catch (error) {
      if (error instanceof NotificationAPIError) throw error;
      throw new NotificationAPIError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({
    status() { return request('/v1/notifications/device', 'GET') as Promise<boolean>; },
    async register(token: string, mutedConversations: readonly string[] = []) {
      if (!/^ExpoPushToken\[[A-Za-z0-9._:-]{1,240}\]$/.test(token)) throw new NotificationAPIError('INVALID_INPUT');
      const muted = normalizeMuted(mutedConversations);
      await request('/v1/notifications/device', 'POST', { expoPushToken: token, mutedConversations: muted });
    },
    async updateMutedConversations(mutedConversations: readonly string[]) {
      await request('/v1/notifications/preferences', 'PUT', { mutedConversations: normalizeMuted(mutedConversations) });
    },
    unregister() { return request('/v1/notifications/device', 'DELETE') as Promise<void>; },
  });
}

function normalizeMuted(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 1000 || values.some(value => !conversationId.test(value))) throw new NotificationAPIError('INVALID_INPUT');
  return [...new Set(values)].sort();
}
