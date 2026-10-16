export type ReportReason = 'spam' | 'harassment' | 'scam' | 'something-else';
export type SelectedReportMessage = Readonly<{ eventId: string; text: string }>;
export type ReportInput = Readonly<{ operationId: string; conversation: string; subjectId: string; reason: ReportReason; details: string; selected: readonly SelectedReportMessage[] }>;
export type ReportResult = Readonly<{ id: string; operationId: string; expiresAt: string }>;
type Session = Readonly<{ accessToken: string; account: Readonly<{ id: string }>; deviceId: string; generation: number }>;
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
const reasons = new Set<ReportReason>(['spam', 'harassment', 'scam', 'something-else']);

export class ReportError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'ReportError'; this.code = code; }
}

function validate(input: ReportInput) {
  if (!input || !id(input.operationId) || !id(input.subjectId) || !/^private:[a-f0-9]{64}$/.test(input.conversation) || !reasons.has(input.reason) ||
    typeof input.details !== 'string' || [...input.details].length > 1000 || !Array.isArray(input.selected) || input.selected.length > 20) throw new ReportError('INVALID_INPUT');
  const seen = new Set<string>();
  for (const item of input.selected) {
    if (!item || !id(item.eventId) || typeof item.text !== 'string' || !item.text.trim() || [...item.text].length > 2000 || seen.has(item.eventId)) throw new ReportError('INVALID_INPUT');
    seen.add(item.eventId);
  }
  if (JSON.stringify(input).length > 32 * 1024) throw new ReportError('INVALID_INPUT');
}

export function createReportAPI(origin: string, session: () => Session, development = false) {
  let url: URL;
  try { url = new URL(origin); } catch { throw new ReportError('CONFIGURATION'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(development && local && url.protocol === 'http:'))) throw new ReportError('CONFIGURATION');
  return {
    async submit(input: ReportInput): Promise<ReportResult> {
      validate(input);
      const before = session(), controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(`${url.origin}/v1/reports`, { method: 'POST', headers: { Authorization: `Bearer ${before.accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(input), redirect: 'error', signal: controller.signal });
        const raw = await response.text(), after = session();
        if (before.account.id !== after.account.id || before.deviceId !== after.deviceId || before.generation !== after.generation || before.accessToken !== after.accessToken) throw new ReportError('SESSION_CHANGED');
        if (raw.length > 4096) throw new ReportError('INVALID_RESPONSE');
        let value: unknown;
        try { value = JSON.parse(raw); } catch { throw new ReportError(response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE'); }
        if (!response.ok) {
          const code = value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined;
          throw new ReportError(typeof code === 'string' && ['INVALID_INPUT', 'DENIED', 'OPERATION_CONFLICT', 'SESSION_REVOKED'].includes(code) ? code : 'UNAVAILABLE');
        }
        if (response.status !== 200 || !value || typeof value !== 'object') throw new ReportError('INVALID_RESPONSE');
        const result = value as Record<string, unknown>;
        if (Object.keys(result).sort().join(',') !== 'expiresAt,id,operationId' || !id(result.id) || result.operationId !== input.operationId || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new ReportError('INVALID_RESPONSE');
        return { id: result.id, operationId: result.operationId, expiresAt: result.expiresAt };
      } catch (error) {
        if (error instanceof ReportError) throw error;
        throw new ReportError('NETWORK');
      } finally { clearTimeout(timer); }
    },
  };
}
