import type { GoogleGrant } from './google-connection';
export async function authorizeGoogle(execute: () => Promise<unknown>): Promise<GoogleGrant | null> {
  let value: unknown;
  try { value = await execute(); } catch { throw new Error('UNAVAILABLE'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  const result = value as Record<string, unknown>;
  if (result.cancelled === true) return null;
  if (result.cancelled !== false || typeof result.accessToken !== 'string' || !/^[A-Za-z0-9._~+\/-]{1,4096}$/.test(result.accessToken) ||
    !Array.isArray(result.grantedScopes) || result.grantedScopes.some(scope => typeof scope !== 'string')) throw new Error('INVALID_RESPONSE');
  return { accessToken: result.accessToken, grantedScopes: [...result.grantedScopes] };
}
