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
export type MembershipMutation = Readonly<{ operationId: string; action: 'leave' | 'remove' | 'handoff'; actorInterval: string; expectedEpoch: number; targetId?: string; targetInterval?: string }>;
export type MembershipResult = { operationId: string; circleId: string; action: MembershipMutation['action']; closed: boolean; cancelled?: boolean };
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
function page<T>(value: unknown, parse: (v: unknown) => T, limit: number, key: (item:T)=>string): Page<T> {
  const v = object(value);
  if (!Array.isArray(v.items) || v.items.length > limit) throw new SocialError('INVALID_RESPONSE');
  const items = v.items.map(parse);
  if (new Set(items.map(key)).size !== items.length) throw new SocialError('INVALID_RESPONSE');
  if (v.nextCursor !== undefined && (!id(v.nextCursor) || items.length !== limit || v.nextCursor !== (items.length ? key(items[items.length-1]) : undefined))) throw new SocialError('INVALID_RESPONSE');
  return { items, ...(v.nextCursor !== undefined ? { nextCursor: v.nextCursor } : {}) };
}
const codes = new Set(['INVALID_INPUT', 'SESSION_REVOKED', 'DENIED', 'CIRCLE_FULL', 'ADMIN_HANDOFF_REQUIRED', 'OPERATION_CONFLICT', 'MEMBERSHIP_CHANGED', 'UNAVAILABLE', 'RATE_LIMITED']);
export function createSocialAPI(baseURL: string, session: () => Session, development = false) {
  let url: URL;
  try { url = new URL(baseURL); } catch { throw new SocialError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new SocialError('CONFIGURATION');
  async function request(path: string, method = 'GET', body?: unknown, empty = false): Promise<unknown> {
    const current = session();
    const binding = [current.accessToken, current.account.id, current.deviceId, current.generation];
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${url.origin}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type':'application/json' }), Authorization: `Bearer ${current.accessToken}` }, redirect: 'error', signal: controller.signal });
      const text = await response.text();
      const after = session();
      if ([after.accessToken, after.account.id, after.deviceId, after.generation].some((v, i) => v !== binding[i])) throw new SocialError('SESSION_CHANGED');
      if (response.ok && empty) { if (response.status !== 204 || text !== '') throw new SocialError('INVALID_RESPONSE'); return undefined; }
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
  async function membershipOperation(circleId: string, input: MembershipMutation, cancel = false): Promise<MembershipResult> {
      requireIDs(circleId, input.operationId, input.actorInterval);
      if (!positive(input.expectedEpoch) || !['leave', 'remove', 'handoff'].includes(input.action)) throw new SocialError('INVALID_INPUT');
      if (input.action === 'leave') { if (input.targetId !== undefined || input.targetInterval !== undefined) throw new SocialError('INVALID_INPUT'); }
      else requireIDs(input.targetId, input.targetInterval);
      const payload = { operationId: input.operationId, action: input.action, actorInterval: input.actorInterval, expectedEpoch: input.expectedEpoch,
        ...(input.action === 'leave' ? {} : { targetId: input.targetId, targetInterval: input.targetInterval }) };
      const result = object(await request(`/v1/circles/${encodeURIComponent(circleId)}/membership-operations${cancel ? "/cancel" : ""}`, 'POST', payload));
      if (result.operationId !== input.operationId || result.circleId !== circleId || result.action !== input.action || typeof result.closed !== 'boolean' || (result.cancelled !== undefined && typeof result.cancelled !== 'boolean') || (result.cancelled === true && result.closed) || (input.action !== 'leave' && result.closed)) throw new SocialError('INVALID_RESPONSE');
      return { operationId: input.operationId, circleId, action: input.action, closed: result.closed, ...(result.cancelled === true ? { cancelled: true } : {}) };
      }
  return {
    mutateMembership: (circleId: string, input: MembershipMutation) => membershipOperation(circleId, input),
    cancelMembership: (circleId: string, input: MembershipMutation) => membershipOperation(circleId, input, true),
    async friends(kind: FriendKind = 'accepted', cursor = '', limit = 25): Promise<Page<Contact>> {
      if (!['accepted','incoming','outgoing','blocked'].includes(kind)) throw new SocialError('INVALID_INPUT');
      return page(await request(`/v1/friends${query(cursor,limit)}&kind=${kind}`), value => contact(value,kind),limit, item => item.accountId);
    },
    async requestFriend(pin: string): Promise<FriendRequest> { if (!pinValid(pin)) throw new SocialError('INVALID_INPUT'); return friendRequest(await request('/v1/friends/requests','POST',{pin})); },
    async respondFriend(requestId: string, accept: boolean): Promise<void> { requireIDs(requestId); requireBoolean(accept); await request(`/v1/friends/requests/${encodeURIComponent(requestId)}/response`,'POST',{accept},true); },
    async blockAccount(accountId: string, blocked: boolean): Promise<void> { requireIDs(accountId); requireBoolean(blocked); await request(`/v1/friends/blocks/${encodeURIComponent(accountId)}`,'PUT',{blocked},true); },
    async createCircle(operationId: string): Promise<CircleRecord> { requireIDs(operationId); return circleRecord(await request('/v1/circles','POST',{operationId})); },
    async invite(circleId: string, accountId: string): Promise<Invitation> {
      requireIDs(circleId,accountId); const result = invitation(await request(`/v1/circles/${encodeURIComponent(circleId)}/invitations`,'POST',{accountId}));
      if (result.circleId !== circleId || result.inviteeId !== accountId) throw new SocialError('INVALID_RESPONSE'); return result;
    },
    async respondInvitation(invitationId: string, accept: boolean): Promise<InvitationResponse> {
      requireIDs(invitationId); requireBoolean(accept); const result = invitationResponse(await request(`/v1/circles/invitations/${encodeURIComponent(invitationId)}/response`,'POST',{accept}));
      if (result.id !== invitationId || result.status !== (accept ? 'accepted':'declined')) throw new SocialError('INVALID_RESPONSE'); return result;
    },
    async handoff(circleId: string, accountId: string): Promise<void> { requireIDs(circleId,accountId); await request(`/v1/circles/${encodeURIComponent(circleId)}/handoff`,'POST',{accountId},true); },
    async leave(circleId: string): Promise<void> { requireIDs(circleId); await request(`/v1/circles/${encodeURIComponent(circleId)}/leave`,'POST',{},true); },
    async removeMember(circleId: string, accountId: string): Promise<void> { requireIDs(circleId,accountId); await request(`/v1/circles/${encodeURIComponent(circleId)}/members/${encodeURIComponent(accountId)}/remove`,'POST',{},true); },
    async circles(cursor = '', limit = 25): Promise<Page<Summary>> { return page(await request(`/v1/circles${query(cursor, limit)}`), summary, limit, item=>item.id); },
    async circle(circleId: string): Promise<Details> { if (!id(circleId)) throw new SocialError('INVALID_INPUT'); return details(await request(`/v1/circles/${encodeURIComponent(circleId)}`)); },
    async invitations(cursor = '', limit = 25): Promise<Page<Invitation>> { return page(await request(`/v1/circles/invitations${query(cursor, limit)}`), invitation, limit, item=>item.id); },
  };
}

export type FriendKind = 'accepted' | 'incoming' | 'outgoing' | 'blocked';
export type Contact = {accountId:string;pin:string;status:'pending'|'accepted'|'blocked';requestId?:string};
export type FriendRequest = {id:string;requestedBy:string;targetId:string;status:'pending'|'accepted'};
export type CircleRecord = {id:string;epoch:number;memberCount:number;closed:boolean};
export type InvitationResponse = Omit<Invitation,'status'> & ({status:'accepted';intervalId:string}|{status:'declined'});
const pinValid = (value:unknown):value is string=>typeof value==='string'&&/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(value);
function requireIDs(...values:unknown[]):void { if(values.some(value=>!id(value)||value==='.'||value==='..'))throw new SocialError('INVALID_INPUT'); }
function requireBoolean(value:unknown):void {if(typeof value!=='boolean')throw new SocialError('INVALID_INPUT');}
function contact(value:unknown,kind:FriendKind):Contact {
  const v=object(value), expected=kind==='accepted'?'accepted':kind==='blocked'?'blocked':'pending';
  if(!id(v.accountId)||!pinValid(v.pin)||v.status!==expected||(kind!=='blocked'&&!id(v.requestId)))throw new SocialError('INVALID_RESPONSE');
  return {accountId:v.accountId,pin:v.pin,status:expected,...(kind!=='blocked'?{requestId:v.requestId as string}:{})};
}
function friendRequest(value:unknown):FriendRequest {
  const v=object(value);if(!id(v.id)||!id(v.requestedBy)||!id(v.targetId)||v.requestedBy===v.targetId||(v.status!=='pending'&&v.status!=='accepted'))throw new SocialError('INVALID_RESPONSE');
  return {id:v.id,requestedBy:v.requestedBy,targetId:v.targetId,status:v.status};
}
function circleRecord(value:unknown):CircleRecord {
  const v=object(value);if(!id(v.id)||!positive(v.epoch)||typeof v.closed!=='boolean'||typeof v.memberCount!=='number'||!Number.isInteger(v.memberCount)||(v.closed?v.memberCount!==0:v.memberCount<1||v.memberCount>20))throw new SocialError('INVALID_RESPONSE');
  return {id:v.id,epoch:v.epoch,memberCount:v.memberCount,closed:v.closed};
}
function invitationResponse(value:unknown):InvitationResponse {
  const v=object(value); const base=invitation({...v,status:'pending'});
  if(v.status==='accepted'&&id(v.intervalId))return {...base,status:'accepted',intervalId:v.intervalId};
  if(v.status==='declined'&&v.intervalId===undefined)return {...base,status:'declined'};
  throw new SocialError('INVALID_RESPONSE');
}
