type Options = { fetcher?: typeof fetch; developmentOrigin?: string };
export function createGoogleIdentity(options: Options = {}) {
  let local: URL | undefined;
  if (options.developmentOrigin) {
    local = new URL(options.developmentOrigin);
    if (local.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(local.hostname) || local.username || local.password || local.pathname !== '/' || local.search || local.hash) throw new Error('INVALID_ORIGIN');
  }
  const discovery = local ? `${local.origin}/.well-known/openid-configuration` : 'https://accounts.google.com/.well-known/openid-configuration';
  async function json(uri: string, token?: string): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await (options.fetcher ?? fetch)(uri, { redirect: 'manual', signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (response.status === 401 || response.status === 403) throw new Error('DRIVE_AUTH_REQUIRED');
      if (!response.ok || response.redirected) throw new Error('UNAVAILABLE');
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) > 32768)) throw new Error('INVALID_RESPONSE');
      const raw = await response.text();
      if (raw.length > 32768) throw new Error('INVALID_RESPONSE');
      let data: unknown;
      try { data = JSON.parse(raw); } catch { throw new Error('INVALID_RESPONSE'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_RESPONSE');
      return data as Record<string, unknown>;
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      throw new Error(['DRIVE_AUTH_REQUIRED', 'INVALID_RESPONSE'].includes(code) ? code : 'UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  return async (token: string) => {
    if (!/^[A-Za-z0-9._~+\/-]{1,4096}$/.test(token)) throw new Error('DRIVE_AUTH_REQUIRED');
    const configuration = await json(discovery);
    if (configuration.issuer !== 'https://accounts.google.com' || typeof configuration.userinfo_endpoint !== 'string') throw new Error('INVALID_RESPONSE');
    let endpoint: URL;
    try { endpoint = new URL(configuration.userinfo_endpoint); } catch { throw new Error('INVALID_RESPONSE'); }
    const known = endpoint.href === 'https://openidconnect.googleapis.com/v1/userinfo' || endpoint.href === 'https://www.googleapis.com/oauth2/v3/userinfo';
    if ((!known && !(local && endpoint.origin === local.origin && endpoint.pathname === '/userinfo')) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('INVALID_RESPONSE');
    const identity = await json(endpoint.toString(), token);
    if (typeof identity.sub !== 'string' || !/^[!-~]{1,255}$/.test(identity.sub)) throw new Error('INVALID_RESPONSE');
    return { subject: identity.sub };
  };
}
