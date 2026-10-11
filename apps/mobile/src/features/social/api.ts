import type { Session } from '../auth/api.ts';

export class SocialError extends Error {
  code: string;
  constructor(code: string) { super(code); this.name = 'SocialError'; this.code = code; }
}
export type Circle = { id: string; epoch: number; memberCount: number; closed: false };
export type Summary = Circle & { intervalId: string; role: 'admin' | 'member'; joinedEpoch: number };
export type Membership = { intervalId: string; accountId: string; pin: string; role: 'admin' | 'member'; joinedEpoch: number };
export type Details = Circle & { members: Membership[] };
export type Invitation = { id: string; circleId: string; inviterId: string; inviteeId: string; status: 'pending' };
export type Page<T> = { items: T[]; nextCursor?: string };
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SocialError('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function circle(value: unknown): Circle {
  const v = object(value);
  if (!id(v.id) || !positive(v.epoch) || !positive(v.memberCount) || v.memberCount > 20 || v.closed !== false) throw new SocialError('INVALID_RESPONSE');
  return { id: v.id, epoch: v.epoch, memberCount: v.memberCount, closed: false };
}
function summary(value: unknown): Summary {
  const v = object(value), c = circle(v);
  if (!id(v.intervalId) || (v.role !== 'admin' && v.role !== 'member') || !positive(v.joinedEpoch) || v.joinedEpoch > c.epoch) throw new SocialError('INVALID_RESPONSE');
  return { ...c, intervalId: v.intervalId, role: v.role, joinedEpoch: v.joinedEpoch };
}
function details(value: unknown): Details {
  const v = object(value), c = circle(v);
  if (!Array.isArray(v.members) || v.members.length !== c.memberCount) throw new SocialError('INVALID_RESPONSE');
  const members = v.members.map((value): Membership => {
    const m = object(value);
    if (!id(m.intervalId) || !id(m.accountId) || typeof m.pin !== 'string' || !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(m.pin) || (m.role !== 'admin' && m.role !== 'member') || !positive(m.joinedEpoch) || m.joinedEpoch > c.epoch) throw new SocialError('INVALID_RESPONSE');
    return { intervalId: m.intervalId, accountId: m.accountId, pin: m.pin, role: m.role, joinedEpoch: m.joinedEpoch };
  });
  if (new Set(members.map(m => m.accountId)).size !== members.length || new Set(members.map(m => m.intervalId)).size !== members.length) throw new SocialError('INVALID_RESPONSE');
  return { ...c, members };
}
function invitation(value: unknown): Invitation {
  const v = object(value);
  if (!id(v.id) || !id(v.circleId) || !id(v.inviterId) || !id(v.inviteeId) || v.inviterId === v.inviteeId || v.status !== 'pending') throw new SocialError('INVALID_RESPONSE');
  return { id: v.id, circleId: v.circleId, inviterId: v.inviterId, inviteeId: v.inviteeId, status: 'pending' };
}
function page<T extends { id: string }>(value: unknown, parse: (v: unknown) => T, limit: number): Page<T> {
  const v = object(value);
  if (!Array.isArray(v.items) || v.items.length > limit) throw new SocialError('INVALID_RESPONSE');
  const items = v.items.map(parse);
  if (new Set(items.map(i => i.id)).size !== items.length) throw new SocialError('INVALID_RESPONSE');
  if (v.nextCursor !== undefined && (!id(v.nextCursor) || items.length !== limit || v.nextCursor !== items.at(-1)?.id)) throw new SocialError('INVALID_RESPONSE');
  return { items, ...(v.nextCursor !== undefined ? { nextCursor: v.nextCursor } : {}) };
}
const codes = new Set(['INVALID_INPUT', 'SESSION_REVOKED', 'DENIED', 'CIRCLE_FULL', 'ADMIN_HANDOFF_REQUIRED', 'UNAVAILABLE', 'RATE_LIMITED']);
export function createSocialAPI(baseURL: string, session: () => Session, development = false) {
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new SocialError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new SocialError('CONFIGURATION');
  async function request(path: string): Promise<unknown> {
    const current = session();
    const binding = [current.accessToken, current.account.id, current.deviceId, current.generation];
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${url.origin}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${current.accessToken}` }, redirect: 'error', signal: controller.signal });
      const text = await response.text();
      const after = session();
      if ([after.accessToken, after.account.id, after.deviceId, after.generation].some((v, i) => v !== binding[i])) throw new SocialError('SESSION_CHANGED');
      if (text.length > 131072) throw new SocialError('INVALID_RESPONSE');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new SocialError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE'); }
      if (!response.ok) { const v = object(value); throw new SocialError(typeof v.code === 'string' && codes.has(v.code) ? v.code : 'UNAVAILABLE'); }
      return value;
    } catch (error) {
      if (error instanceof SocialError) throw error;
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') throw new SocialError(codes.has(error.code) ? error.code : 'SESSION_CHANGED');
      throw new SocialError('NETWORK');
    } finally { clearTimeout(timer); }
  }
  function query(cursor: string, limit: number): string {
    if ((cursor !== '' && !id(cursor)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new SocialError('INVALID_INPUT');
    return `?cursor=${encodeURIComponent(cursor)}&limit=${limit}`;
  }
  return {
    async circles(cursor = '', limit = 25): Promise<Page<Summary>> { return page(await request(`/v1/circles${query(cursor, limit)}`), summary, limit); },
    async circle(circleId: string): Promise<Details> { if (!id(circleId)) throw new SocialError('INVALID_INPUT'); return details(await request(`/v1/circles/${encodeURIComponent(circleId)}`)); },
    async invitations(cursor = '', limit = 25): Promise<Page<Invitation>> { return page(await request(`/v1/circles/invitations${query(cursor, limit)}`), invitation, limit); },
  };
}
