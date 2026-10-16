export type DriveSession = { accessToken: string; binding: string };
export type DriveBackup = { id: string; name: string; size: number; modifiedAt: string };
const format = 'awsemchat.history.v1';
const fields = 'id,name,size,modifiedTime,spaces,appProperties';
const maxBytes = 24 * 1024 * 1024;
function identifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}
function metadata(value: unknown): DriveBackup {
  const data = object(value);
  if (!identifier(data.id) || typeof data.name !== 'string' || data.name.length > 256 ||
    typeof data.size !== 'string' || !/^[0-9]{1,10}$/.test(data.size) ||
    typeof data.modifiedTime !== 'string' || !Number.isFinite(Date.parse(data.modifiedTime)) ||
    !Array.isArray(data.spaces) || !data.spaces.includes('appDataFolder') || object(data.appProperties).backupFormat !== format) throw new Error('INVALID_RESPONSE');
  const size = Number(data.size);
  if (size <= 0 || size > maxBytes) throw new Error('CAPACITY');
  return { id: data.id, name: data.name, size, modifiedAt: data.modifiedTime };
}
export function createDriveAPI(session: () => DriveSession, options: { origin?: string; development?: boolean; fetcher?: typeof fetch } = {}) {
  const origin = options.origin ?? 'https://www.googleapis.com';
  const base = new URL(origin);
  const local = options.development && base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.origin !== 'https://www.googleapis.com' && !local) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('INVALID_ORIGIN');
  function current() {
    const bound = { ...session() };
    if (!bound.binding || !/^[A-Za-z0-9._~+\/-]{1,4096}$/.test(bound.accessToken)) throw new Error('DRIVE_AUTH_REQUIRED');
    return bound;
  }
  function guard(bound: DriveSession) {
    const now = current();
    if (now.binding !== bound.binding || now.accessToken !== bound.accessToken) throw new Error('SESSION_REVOKED');
  }
  function uploadURL(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('INVALID_RESPONSE'); }
    if (url.origin !== base.origin || url.pathname !== '/upload/drive/v3/files' || url.username || url.password || url.hash || !url.searchParams.get('upload_id')) throw new Error('INVALID_RESPONSE');
    return url.toString();
  }
  async function request<T>(path: string, init: RequestInit, consume: (response: Response) => Promise<T>, accepted: number[] = []): Promise<T> {
    const bound = current();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await (options.fetcher ?? fetch)(new URL(path, base).toString(), { ...init, headers: { ...init.headers, Authorization: `Bearer ${bound.accessToken}` }, redirect: 'manual', signal: controller.signal });
      guard(bound);
      if ((response.redirected && response.status !== 308) || (response.status === 308 && response.headers.has('Location'))) throw new Error('UNAVAILABLE');
      if (response.status === 401 || response.status === 403) throw new Error('DRIVE_AUTH_REQUIRED');
      if (response.status === 409) throw new Error('DRIVE_CONFLICT');
      if (!response.ok && !accepted.includes(response.status)) throw new Error(response.status === 429 ? 'RATE_LIMITED' : 'UNAVAILABLE');
      const result = await consume(response);
      guard(bound);
      return result;
    } catch (error) {
      if (error instanceof Error && ['DRIVE_AUTH_REQUIRED', 'DRIVE_CONFLICT', 'RATE_LIMITED', 'UNAVAILABLE', 'SESSION_REVOKED', 'INVALID_RESPONSE', 'CAPACITY', 'UPLOAD_INCOMPLETE', 'UPLOAD_EXPIRED'].includes(error.message)) throw error;
      throw new Error('UNAVAILABLE');
    } finally { clearTimeout(timer); }
  }
  function filePath(id: string) { if (!identifier(id)) throw new Error('INVALID_INPUT'); return `/drive/v3/files/${id}`; }
  return {
    generateId() {
      return request('/drive/v3/files/generateIds?count=1&space=appDataFolder&type=files', {}, async response => {
        const data = object(await response.json());
        if (!Array.isArray(data.ids) || data.ids.length !== 1 || !identifier(data.ids[0])) throw new Error('INVALID_RESPONSE');
        return data.ids[0];
      });
    },
    beginUpload(id: string, size: number) {
      filePath(id);
      if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) throw new Error('CAPACITY');
      return request(`/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(fields)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) },
        body: JSON.stringify({ id, name: 'AwsemChat.awsembackup', mimeType: 'application/octet-stream', parents: ['appDataFolder'], appProperties: { backupFormat: format } }),
      }, async response => uploadURL(response.headers.get('Location') ?? ''));
    },
    uploadStatus(id: string, uri: string, size: number) {
      filePath(id);
      if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) throw new Error('CAPACITY');
      return request(uploadURL(uri), { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` }, body: '' }, async response => {
        if (response.status === 404 || response.status === 410) return { phase: 'expired' as const };
        if (response.status === 308) {
          const range = response.headers.get('Range');
          if (range === null) return { phase: 'incomplete' as const, offset: 0 };
          const match = /^bytes=0-([0-9]{1,10})$/.exec(range);
          if (!match) throw new Error('INVALID_RESPONSE');
          const offset = Number(match[1]) + 1;
          if (!Number.isSafeInteger(offset) || offset >= size) throw new Error('INVALID_RESPONSE');
          return { phase: 'incomplete' as const, offset };
        }
        const file = metadata(await response.json());
        if (file.id !== id || file.size !== size) throw new Error('INVALID_RESPONSE');
        return { phase: 'complete' as const };
      }, [308, 404, 410]);
    },
    upload(id: string, uri: string, archive: string, offset = 0) {
      filePath(id);
      if (!archive || archive.length > maxBytes || !/^[A-Za-z0-9+/]+={0,2}$/.test(archive)) throw new Error('INVALID_INPUT');
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= archive.length) throw new Error('INVALID_INPUT');
      return request(uploadURL(uri), { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${offset}-${archive.length - 1}/${archive.length}` }, body: archive.slice(offset) }, async response => {
        if (response.status === 308) throw new Error('UPLOAD_INCOMPLETE');
        if (response.status === 404 || response.status === 410) throw new Error('UPLOAD_EXPIRED');
        const file = metadata(await response.json());
        if (file.id !== id || file.size !== archive.length) throw new Error('INVALID_RESPONSE');
        return file;
      }, [308, 404, 410]);
    },
    list(cursor = '') {
      if (cursor.length > 4096) throw new Error('INVALID_INPUT');
      const query = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '100', fields: `nextPageToken,files(${fields})`, orderBy: 'modifiedTime desc', q: `trashed = false and appProperties has { key='backupFormat' and value='${format}' }` });
      if (cursor) query.set('pageToken', cursor);
      return request(`/drive/v3/files?${query}`, {}, async response => {
        const data = object(await response.json());
        if (!Array.isArray(data.files) || data.files.length > 100 || (data.nextPageToken !== undefined && (typeof data.nextPageToken !== 'string' || !data.nextPageToken || data.nextPageToken.length > 4096 || data.nextPageToken === cursor))) throw new Error('INVALID_RESPONSE');
        const items = data.files.map(metadata);
        if (new Set(items.map(file => file.id)).size !== items.length) throw new Error('INVALID_RESPONSE');
        return { items, ...(data.nextPageToken === undefined ? {} : { cursor: data.nextPageToken as string }) };
      });
    },
    async download(id: string) {
      const bound = current();
      const path = filePath(id);
      const file = await request(`${path}?fields=${encodeURIComponent(fields)}`, {}, async response => metadata(await response.json()));
      guard(bound);
      if (file.id !== id) throw new Error('INVALID_RESPONSE');
      return request(`${path}?alt=media`, {}, async response => {
        const declared = response.headers.get('Content-Length');
        if (declared !== null && Number(declared) !== file.size) throw new Error('INVALID_RESPONSE');
        const archive = await response.text();
        if (archive.length !== file.size || !/^[A-Za-z0-9+/]+={0,2}$/.test(archive)) throw new Error('INVALID_RESPONSE');
        return archive;
      });
    },
  };
}
