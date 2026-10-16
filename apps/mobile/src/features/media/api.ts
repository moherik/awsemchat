import type { Session } from '../auth/api';
import type { CiphertextStorage } from './encrypted-media';

export class MediaError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = 'MediaError'; this.code = code; }
}
const maxCiphertext = 8 * 1024 * 1024;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value);
const archive = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= maxCiphertext && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
const codes = new Set(['INVALID_INPUT', 'SESSION_REVOKED', 'DENIED', 'OBJECT_CONFLICT', 'OPERATION_CANCELLED', 'MEDIA_TOO_LARGE', 'UNAVAILABLE']);
function binding(session: Session): string { return JSON.stringify([session.accessToken, session.account.id, session.deviceId, session.generation]); }

export function createCircleMediaStorage(baseURL: string, session: () => Session, circle: { circleId: string; epoch: number }, development = false): CiphertextStorage {
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new MediaError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new MediaError('CONFIGURATION');
  const circleId = circle.circleId, epoch = circle.epoch;
  if (!identifier(circleId) || !Number.isSafeInteger(epoch) || epoch < 1) throw new MediaError('INVALID_INPUT');
  const owner = binding(session());
  function check() { if (binding(session()) !== owner) throw new MediaError('SESSION_CHANGED'); }
  async function request(id: string, ciphertext?: string, operationID?: string): Promise<string> {
    if (!identifier(id) || (ciphertext !== undefined && (!archive(ciphertext) || !identifier(operationID)))) throw new MediaError('INVALID_INPUT');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      check();
      const path = `/v1/media/circles/${encodeURIComponent(circleId)}/objects/${encodeURIComponent(id)}`;
      const response = await fetch(`${url.origin}${path}${ciphertext === undefined ? '' : `?epoch=${epoch}&operation=${encodeURIComponent(operationID!)}`}`, {
        method: ciphertext === undefined ? 'GET' : 'PUT', body: ciphertext,
        headers: { Authorization: `Bearer ${session().accessToken}`, Accept: 'application/octet-stream', ...(ciphertext === undefined ? {} : { 'Content-Type': 'application/octet-stream' }) },
        signal: controller.signal, redirect: 'error',
      });
      check();
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > (response.ok ? maxCiphertext : 4096))) throw new MediaError('INVALID_RESPONSE');
      const text = await response.text(); check();
      if (!response.ok) {
        if (text.length > 4096) throw new MediaError('UNAVAILABLE');
        let value: unknown;
        try { value = JSON.parse(text); } catch { throw new MediaError('UNAVAILABLE'); }
        const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
        throw new MediaError(typeof code === 'string' && codes.has(code) ? code : 'UNAVAILABLE');
      }
      if (ciphertext !== undefined) {
        if (response.status !== 204 || text !== '') throw new MediaError('INVALID_RESPONSE');
        return '';
      }
      if (response.status !== 200 || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/octet-stream' || !archive(text)) throw new MediaError('INVALID_RESPONSE');
      return text;
    } catch (error) {
      if (error instanceof MediaError) throw error;
      try { check(); } catch { throw new MediaError('SESSION_CHANGED'); }
      throw new MediaError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  async function cancel(operationID: string): Promise<{ state: 'cancelled' } | { state: 'committed'; eventId: string }> {
    if (!identifier(operationID)) throw new MediaError('INVALID_INPUT');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      check();
      const response = await fetch(`${url.origin}/v1/media/circles/${encodeURIComponent(circleId)}/operations/${encodeURIComponent(operationID)}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${session().accessToken}`, Accept: 'application/json' },
        signal: controller.signal, redirect: 'error',
      });
      check();
      const text = await response.text(); check();
      if (text.length > 4096) throw new MediaError('INVALID_RESPONSE');
      if (!response.ok) {
        let value: unknown;
        try { value = JSON.parse(text); } catch { throw new MediaError('UNAVAILABLE'); }
        const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
        throw new MediaError(typeof code === 'string' && codes.has(code) ? code : 'UNAVAILABLE');
      }
      if (response.status !== 200 || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || response.headers.get('Cache-Control') !== 'no-store') throw new MediaError('INVALID_RESPONSE');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new MediaError('INVALID_RESPONSE'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MediaError('INVALID_RESPONSE');
      const result = value as Record<string, unknown>;
      if (result.state === 'cancelled' && Object.keys(result).length === 1) return Object.freeze({ state: 'cancelled' });
      if (result.state === 'committed' && Object.keys(result).sort().join(',') === 'eventId,state' && identifier(result.eventId)) return Object.freeze({ state: 'committed', eventId: result.eventId });
      throw new MediaError('INVALID_RESPONSE');
    } catch (error) {
      if (error instanceof MediaError) throw error;
      try { check(); } catch { throw new MediaError('SESSION_CHANGED'); }
      throw new MediaError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  return { async put(id: string, ciphertext: string, operationID: string) { await request(id, ciphertext, operationID); }, get: id => request(id), cancel };
}

export function createPrivateMediaStorage(baseURL: string, session: () => Session, friendship: { peerId: string; audience: string }, development = false): CiphertextStorage {
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new MediaError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new MediaError('CONFIGURATION');
  const { peerId, audience } = friendship;
  if (!identifier(peerId) || !/^friend:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(audience)) throw new MediaError('INVALID_INPUT');
  const owner = binding(session());
  function check() { if (binding(session()) !== owner) throw new MediaError('SESSION_CHANGED'); }
  async function request(path: string, method: 'GET' | 'PUT' | 'POST', body?: string): Promise<Response> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      check();
      const response = await fetch(`${url.origin}${path}`, {
        method, ...(body === undefined ? {} : { body }),
        headers: { Authorization: `Bearer ${session().accessToken}`, Accept: method === 'POST' ? 'application/json' : 'application/octet-stream', ...(body === undefined ? {} : { 'Content-Type': 'application/octet-stream' }) },
        signal: controller.signal, redirect: 'error',
      });
      check(); return response;
    } catch (error) {
      if (error instanceof MediaError) throw error;
      try { check(); } catch { throw new MediaError('SESSION_CHANGED'); }
      throw new MediaError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  async function readError(response: Response): Promise<never> {
    const text = await response.text(); check();
    if (text.length > 4096) throw new MediaError('UNAVAILABLE');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new MediaError('UNAVAILABLE'); }
    const code = value && typeof value === 'object' && 'code' in value ? value.code : undefined;
    throw new MediaError(typeof code === 'string' && codes.has(code) ? code : 'UNAVAILABLE');
  }
  function objectPath(id: string) {
    if (!identifier(id)) throw new MediaError('INVALID_INPUT');
    return `/v1/media/private/${encodeURIComponent(peerId)}/objects/${encodeURIComponent(id)}?audience=${encodeURIComponent(audience)}`;
  }
  return {
    async put(id, ciphertext, operationID) {
      if (!archive(ciphertext) || !identifier(operationID)) throw new MediaError('INVALID_INPUT');
      const response = await request(`${objectPath(id)}&operation=${encodeURIComponent(operationID)}`, 'PUT', ciphertext);
      if (!response.ok) await readError(response);
      const text = await response.text(); check();
      if (response.status !== 204 || text !== '') throw new MediaError('INVALID_RESPONSE');
    },
    async get(id) {
      const response = await request(objectPath(id), 'GET');
      if (!response.ok) await readError(response);
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxCiphertext)) throw new MediaError('INVALID_RESPONSE');
      const text = await response.text(); check();
      if (response.status !== 200 || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/octet-stream' || !archive(text)) throw new MediaError('INVALID_RESPONSE');
      return text;
    },
    async cancel(operationID) {
      if (!identifier(operationID)) throw new MediaError('INVALID_INPUT');
      const path = `/v1/media/private/${encodeURIComponent(peerId)}/operations/${encodeURIComponent(operationID)}/cancel?audience=${encodeURIComponent(audience)}`;
      const response = await request(path, 'POST');
      if (!response.ok) await readError(response);
      const text = await response.text(); check();
      if (text.length > 4096 || response.status !== 200 || response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || response.headers.get('Cache-Control') !== 'no-store') throw new MediaError('INVALID_RESPONSE');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new MediaError('INVALID_RESPONSE'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MediaError('INVALID_RESPONSE');
      const result = value as Record<string, unknown>;
      if (result.state === 'cancelled' && Object.keys(result).length === 1) return Object.freeze({ state: 'cancelled' as const });
      if (result.state === 'committed' && Object.keys(result).sort().join(',') === 'eventId,state' && identifier(result.eventId)) return Object.freeze({ state: 'committed' as const, eventId: result.eventId });
      throw new MediaError('INVALID_RESPONSE');
    },
  };
}
