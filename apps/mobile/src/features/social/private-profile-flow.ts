import { decodePrivateProfile, encodePrivateProfile, type PrivateProfile } from './private-profile.ts';
import type { PrivateProfilePhoto } from './private-profile-photo-store.ts';

export type PrivateProfileState = Readonly<{ version: 1; revision: number; name: string; status: string; avatarMode?: 'photo' | 'removed' }>;
export type PrivateProfileSnapshot = Readonly<{ phase: 'idle' | 'loading' | 'ready' | 'error'; profile: PrivateProfileState; avatar: PrivateProfilePhoto | null; photoError?: string; busy: boolean; sharePending: boolean; error?: string }>;
type FriendPage = { items: readonly { accountId: string; requestId?: string; status: string }[]; nextCursor?: string };
type Outgoing = { operation: string; target: string | null; audience: string; contentType?: string | null; plaintext: string; event: string | null; status: 'queued' | 'sent' | 'delivered' };
type History = { outgoing: readonly Outgoing[] };
type Ports = {
  binding(): string;
  vault: { read(): Promise<unknown | null>; write(state: PrivateProfileState): Promise<void> };
  history(): Promise<History>;
  acceptedFriends(cursor: string, limit: number): Promise<FriendPage>;
  shareCircles?(profile: Pick<PrivateProfileState, 'revision' | 'name' | 'status'>): Promise<void>;
  operation(revision: number, requestId: string): string | Promise<string>;
  send(draft: { targetId: string; operation: string; contentType: 'private-profile'; plaintext: string }): Promise<unknown>;
  photoStore: { read(): Promise<PrivateProfilePhoto | undefined>; write(photo: PrivateProfilePhoto): Promise<void>; clear(): Promise<void> };
  publishPhoto?(input: { targetId: string; requestId: string; operation: string; revision: number; name: string; status: string; photo: PrivateProfilePhoto | null }): Promise<unknown>;
};

const empty = (): PrivateProfileState => Object.freeze({ version: 1, revision: 0, name: '', status: '' });
const modeForWire = (profile: PrivateProfile): 'none' | 'photo' | 'removed' => profile.version === 1 ? 'none' : profile.avatar === null ? 'removed' : 'photo';
const modeForState = (profile: PrivateProfileState): 'none' | 'photo' | 'removed' => profile.avatarMode ?? 'none';
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
function checkedState(value: unknown): PrivateProfileState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 || typeof data.name !== 'string' || typeof data.status !== 'string' || Object.keys(data).some(key => !['version', 'revision', 'name', 'status', 'avatarMode'].includes(key)) || (data.avatarMode !== undefined && data.avatarMode !== 'photo' && data.avatarMode !== 'removed')) return undefined;
  const profile = decodePrivateProfile(JSON.stringify({ version: 1, revision: data.revision, name: data.name, status: data.status }));
  return profile ? Object.freeze({ version: 1, revision: profile.revision, name: profile.name, status: profile.status, ...(data.avatarMode ? { avatarMode: data.avatarMode as 'photo' | 'removed' } : {}) }) : undefined;
}

export function createPrivateProfileFlow(ports: Ports) {
  let snapshot: PrivateProfileSnapshot = Object.freeze({ phase: 'idle', profile: empty(), avatar: null, busy: false, sharePending: false });
  let loadedBinding = '', generation = 0, active: Promise<unknown> | undefined;
  const listeners = new Set<() => void>();
  function publish(change: Partial<PrivateProfileSnapshot>) { snapshot = Object.freeze({ ...snapshot, ...change }); for (const listener of listeners) { try { listener(); } catch { /* A view cannot alter saved profile state. */ } } }
  function check(bound: string) { if (!bound || ports.binding() !== bound || generation < 0) throw new Error('SESSION_CHANGED'); }
  async function recovered(history: History): Promise<PrivateProfileState | undefined> {
    const profiles = history.outgoing.filter(record => record.contentType === 'private-profile' && record.status !== 'queued' && !!record.event).map(record => decodePrivateProfile(record.plaintext)).filter((value): value is PrivateProfile => !!value);
    if (!profiles.length) return undefined;
    const revision = Math.max(...profiles.map(profile => profile.revision));
    const current = profiles.filter(profile => profile.revision === revision);
    if (current.some(profile => profile.name !== current[0].name || profile.status !== current[0].status || modeForWire(profile) !== modeForWire(current[0]))) throw new Error('PROFILE_CONFLICT');
    const avatarMode = modeForWire(current[0]);
    return Object.freeze({ version: 1, revision, name: current[0].name, status: current[0].status, ...(avatarMode === 'none' ? {} : { avatarMode }) });
  }
  async function load() {
    const bound = ports.binding();
    if (!bound) { publish({ phase: 'error', error: 'SIGN_IN_REQUIRED' }); return; }
    const ticket = ++generation; loadedBinding = bound; publish({ phase: 'loading', error: undefined });
    try {
      const stored = await ports.vault.read();
      if (ticket !== generation || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
      const history = await ports.history();
      if (ticket !== generation || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
      const local = checkedState(stored), sent = await recovered(history);
      if (local && sent && local.revision === sent.revision && local.avatarMode && local.avatarMode !== modeForState(sent)) throw new Error('PROFILE_CONFLICT');
      const preferSent = !!sent && (!local || sent.revision > local.revision || sent.revision === local.revision && !local.avatarMode && modeForState(sent) !== 'none');
      let profile = preferSent ? sent! : local ?? sent ?? empty();
      if (profile.revision > 0 && (!local || profile.revision > local.revision)) await ports.vault.write(profile);
      if (ticket !== generation || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
      let avatar: PrivateProfilePhoto | undefined, photoError: string | undefined;
      try { avatar = await ports.photoStore.read(); }
      catch (error) { if (error instanceof Error && error.message === 'SESSION_CHANGED') throw error; photoError = error instanceof Error ? error.message : 'PROFILE_PHOTO_UNAVAILABLE'; }
      if (ticket !== generation || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
      if (avatar && !profile.avatarMode) {
        if (profile.revision >= Number.MAX_SAFE_INTEGER) throw new Error('INVALID_PROFILE');
        profile = checkedState({ ...profile, revision: profile.revision + 1, avatarMode: 'photo' })!;
        await ports.vault.write(profile);
        if (ticket !== generation || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
      }
      if (profile.avatarMode === 'photo' && !avatar && !photoError) photoError = 'PROFILE_PHOTO_UNAVAILABLE';
      publish({ phase: 'ready', profile, avatar: avatar ?? null, photoError, sharePending: false, error: undefined });
    } catch (error) {
      if (ticket === generation && ports.binding() === bound) publish({ phase: 'error', error: error instanceof Error ? error.message : 'UNAVAILABLE' });
      throw error;
    }
  }
  async function share(bound: string, profile: PrivateProfileState): Promise<boolean> {
    check(bound);
    let pending = false;
    if (profile.revision && profile.name && ports.shareCircles) {
      try { await ports.shareCircles(profile); }
      catch { check(bound); pending = true; }
      check(bound);
    }
    const mode = profile.avatarMode ?? 'none';
    if (snapshot.photoError || (mode === 'photo' && !snapshot.avatar)) return true;
    if (!profile.revision || !profile.name) return pending;
    const plaintext = mode === 'none' ? encodePrivateProfile({ revision: profile.revision, name: profile.name, status: profile.status }) : undefined;
    let cursor = '';
    const seenAccounts = new Set<string>(), seenCursors = new Set<string>();
    do {
      check(bound);
      const page = await ports.acceptedFriends(cursor, 25);
      check(bound);
      for (const friend of page.items) {
        if (friend.status !== 'accepted' || !identifier(friend.accountId) || !identifier(friend.requestId) || seenAccounts.has(friend.accountId)) continue;
        seenAccounts.add(friend.accountId);
        const audience = `friend:${friend.requestId}`;
        const history = await ports.history(); check(bound);
        const prior = history.outgoing.filter(record => record.contentType === 'private-profile' && record.audience === audience && record.target === friend.accountId);
        const sentProfiles = prior.filter(record => record.status !== 'queued' && !!record.event).map(record => decodePrivateProfile(record.plaintext)).filter((value): value is PrivateProfile => !!value);
        const matchingRevision = sentProfiles.filter(value => value.revision === profile.revision);
        if (matchingRevision.some(value => JSON.stringify(value) !== JSON.stringify(matchingRevision[0]))) throw new Error('PROFILE_CONFLICT');
        const matching = matchingRevision.find(value => value.name === profile.name && value.status === profile.status);
        if (matching) {
          const sentMode = modeForWire(matching);
          if (sentMode !== mode) throw new Error('PROFILE_CONFLICT');
          continue;
        }
        if (matchingRevision.length) throw new Error('PROFILE_CONFLICT');
        if (mode !== 'none') {
          if (!ports.publishPhoto || (mode === 'photo' && !snapshot.avatar)) { pending = true; continue; }
          const operation = await ports.operation(profile.revision, friend.requestId);
          if (!identifier(operation)) throw new Error('INVALID_PROFILE_OPERATION');
          try { await ports.publishPhoto({ targetId: friend.accountId, requestId: friend.requestId!, operation, revision: profile.revision, name: profile.name, status: profile.status, photo: mode === 'photo' ? snapshot.avatar! : null }); }
          catch { check(bound); pending = true; }
          check(bound);
          continue;
        }
        const saved = prior.find(record => record.status === 'queued');
        if (saved) {
          try { await ports.send({ targetId: friend.accountId, operation: saved.operation, contentType: 'private-profile', plaintext: saved.plaintext }); }
          catch { check(bound); pending = true; continue; }
          check(bound);
          pending = true;
          continue;
        }
        const operation = await ports.operation(profile.revision, friend.requestId);
        if (!identifier(operation)) throw new Error('INVALID_PROFILE_OPERATION');
        try { await ports.send({ targetId: friend.accountId, operation, contentType: 'private-profile', plaintext: plaintext! }); }
        catch { check(bound); pending = true; }
        check(bound);
      }
      if (page.nextCursor) {
        if (!identifier(page.nextCursor) || seenCursors.has(page.nextCursor) || page.nextCursor === cursor) throw new Error('INVALID_FRIEND_CURSOR');
        seenCursors.add(page.nextCursor); cursor = page.nextCursor;
      } else cursor = '';
    } while (cursor);
    return pending;
  }
  async function serialized<T>(job: () => Promise<T>): Promise<T> {
    if (active) await active.catch(() => {});
    const current = job(); active = current;
    try { return await current; } finally { if (active === current) active = undefined; }
  }
  async function save(input: { name: string; status: string }) {
    return serialized(async () => {
      const bound = loadedBinding || ports.binding(); check(bound);
      if (snapshot.phase !== 'ready' || snapshot.busy) throw new Error('UNAVAILABLE');
      if (snapshot.profile.revision >= Number.MAX_SAFE_INTEGER) throw new Error('INVALID_PROFILE');
      const profile = checkedState({ version: 1, revision: snapshot.profile.revision + 1, name: input.name, status: input.status, ...(snapshot.profile.avatarMode ? { avatarMode: snapshot.profile.avatarMode } : {}) });
      if (!profile) throw new Error('INVALID_PROFILE');
      const ticket = generation; publish({ busy: true, error: undefined });
      try {
        await ports.vault.write(profile); check(bound);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        publish({ profile });
        const sharePending = await share(bound, profile);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        publish({ phase: 'ready', sharePending });
      } catch (error) {
        if (ports.binding() === bound && ticket === generation) publish({ profile, phase: 'ready', sharePending: true, error: error instanceof Error ? error.message : 'UNAVAILABLE' });
        else throw new Error('SESSION_CHANGED');
      } finally { if (ports.binding() === bound && ticket === generation) publish({ busy: false }); }
    });
  }
  async function setPhoto(photo: PrivateProfilePhoto | null) {
    return serialized(async () => {
      const bound = loadedBinding || ports.binding(); check(bound);
      if (snapshot.phase !== 'ready' || snapshot.busy) throw new Error('UNAVAILABLE');
      if (snapshot.profile.revision >= Number.MAX_SAFE_INTEGER) throw new Error('INVALID_PROFILE');
      const profile = checkedState({ version: 1, revision: snapshot.profile.revision + 1, name: snapshot.profile.name, status: snapshot.profile.status, avatarMode: photo === null ? 'removed' : 'photo' });
      if (!profile) throw new Error('INVALID_PROFILE');
      const ticket = generation; publish({ busy: true, photoError: undefined });
      try {
        await ports.vault.write(profile); check(bound);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        publish({ profile });
        if (photo === null) await ports.photoStore.clear();
        else await ports.photoStore.write(photo);
        check(bound);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        const avatar = photo === null ? null : await ports.photoStore.read() ?? null;
        check(bound);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        if (photo !== null && !avatar) throw new Error('PROFILE_PHOTO_UNAVAILABLE');
        publish({ avatar, photoError: undefined });
        const sharePending = await share(bound, profile);
        if (ticket !== generation) throw new Error('SESSION_CHANGED');
        publish({ phase: 'ready', sharePending });
      } catch (error) {
        if (ports.binding() === bound && ticket === generation) publish({ photoError: error instanceof Error ? error.message : 'PROFILE_PHOTO_UNAVAILABLE', sharePending: true });
        else throw new Error('SESSION_CHANGED');
        throw error;
      } finally { if (ports.binding() === bound && ticket === generation) publish({ busy: false }); }
    });
  }
  async function sync() {
    return serialized(async () => {
      const bound = loadedBinding || ports.binding(); check(bound);
      if (snapshot.phase !== 'ready' || !snapshot.profile.revision) return;
      const ticket = generation;
      try { const sharePending = await share(bound, snapshot.profile); if (ticket === generation) publish({ sharePending, error: undefined }); }
      catch (error) { if (ticket === generation && ports.binding() === bound) publish({ sharePending: true, error: error instanceof Error ? error.message : 'UNAVAILABLE' }); else throw new Error('SESSION_CHANGED'); }
    });
  }
  return { getSnapshot: () => snapshot, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, load, save, setPhoto, sync };
}
