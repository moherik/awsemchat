export type CircleMomentDeletion = Readonly<{ version: 1; type: 'circle-moment-deletion'; id: string; momentId: string }>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function invalid(): never { throw new Error('INVALID_CIRCLE_MOMENT_DELETION'); }
function parse(value: unknown): CircleMomentDeletion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'id,momentId,type,version' || raw.version !== 1 || raw.type !== 'circle-moment-deletion' || typeof raw.id !== 'string' || !idPattern.test(raw.id) || typeof raw.momentId !== 'string' || !idPattern.test(raw.momentId)) return invalid();
  return Object.freeze({ version: 1, type: 'circle-moment-deletion', id: raw.id, momentId: raw.momentId });
}
export function encodeCircleMomentDeletion(value: { id: string; momentId: string }) { return JSON.stringify(parse({ version: 1, type: 'circle-moment-deletion', ...value })); }
export function decodeCircleMomentDeletion(value: string) {
  if (typeof value !== 'string' || value.length > 512) return undefined;
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-moment-deletion') return undefined; return parse(parsed); } catch { return undefined; }
}
