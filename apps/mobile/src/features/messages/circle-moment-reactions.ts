import type { HistorySnapshot } from './history-store';

export const circleMomentReactionEmojis = Object.freeze(['❤️', '😂', '😮', '😢', '👍', '🎉'] as const);
export type CircleMomentReactionEmoji = typeof circleMomentReactionEmojis[number];
export type CircleMomentReaction = Readonly<{ version: 1; type: 'circle-moment-reaction'; id: string; momentId: string; emoji: CircleMomentReactionEmoji; active: boolean }>;
export type MomentReactionSummary = Readonly<{ emoji: CircleMomentReactionEmoji; count: number; reactedByMe: boolean }>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function invalid(): never { throw new Error('INVALID_CIRCLE_MOMENT_REACTION'); }
function parse(value: unknown): CircleMomentReaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).sort().join(',') !== 'active,emoji,id,momentId,type,version' || raw.version !== 1 || raw.type !== 'circle-moment-reaction' ||
    typeof raw.id !== 'string' || !idPattern.test(raw.id) || typeof raw.momentId !== 'string' || !idPattern.test(raw.momentId) ||
    typeof raw.emoji !== 'string' || !circleMomentReactionEmojis.includes(raw.emoji as CircleMomentReactionEmoji) || typeof raw.active !== 'boolean') return invalid();
  return Object.freeze({ version: 1, type: 'circle-moment-reaction', id: raw.id, momentId: raw.momentId, emoji: raw.emoji as CircleMomentReactionEmoji, active: raw.active });
}
export function encodeCircleMomentReaction(value: Omit<CircleMomentReaction, 'version' | 'type'>): string {
  return JSON.stringify(parse({ version: 1, type: 'circle-moment-reaction', ...value }));
}
export function decodeCircleMomentReaction(value: string): CircleMomentReaction | undefined {
  if (typeof value !== 'string' || value.length > 1024) return undefined;
  try { const parsed: unknown = JSON.parse(value); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).type !== 'circle-moment-reaction') return undefined; return parse(parsed); } catch { return undefined; }
}
type MomentAudience = { id: string; audience: string };
type ReactionRecord = { conversation: string; audience: string; plaintext: string; operation: string; sequence?: number | null; createdAt?: number | null; sender?: { identity: string }; direction?: string; circle?: string; target?: string | null };
export function selectCircleMomentReactions(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, circle: string, moment: MomentAudience): readonly MomentReactionSummary[] {
  if (!idPattern.test(circle) || !idPattern.test(moment.id) || !/^circle:[1-9][0-9]*$/.test(moment.audience)) throw new Error('INVALID_CIRCLE_MOMENT');
  const latest = new Map<string, { identity: string; emoji: CircleMomentReactionEmoji; active: boolean; order: number; operation: string }>();
  const records = [
    ...(history.incoming as readonly ReactionRecord[]).map(record => ({ record, own: record.direction === 'outgoing' })),
    ...(history.outgoing as readonly ReactionRecord[]).map(record => ({ record, own: true })),
  ];
  for (const { record, own } of records) {
    if (record.conversation !== circle || record.audience !== moment.audience || !/^circle:[1-9][0-9]*$/.test(record.audience)) continue;
    if (own && (record.circle !== circle || record.target !== null)) continue;
    const reaction = decodeCircleMomentReaction(record.plaintext);
    if (!reaction || reaction.id !== record.operation || reaction.momentId !== moment.id) continue;
    const identity = own ? 'self' : record.sender?.identity;
    const sequence = record.sequence, createdAt = record.createdAt;
    if (!identity || typeof identity !== 'string' || (!Number.isSafeInteger(sequence) && !Number.isFinite(createdAt))) continue;
    const order = Number.isSafeInteger(sequence) ? Number(sequence) : Number(createdAt);
    const previous = latest.get(identity);
    if (previous && (order < previous.order || order === previous.order && reaction.id <= previous.operation)) continue;
    latest.set(identity, { identity, emoji: reaction.emoji, active: reaction.active, order, operation: reaction.id });
  }
  const counts = new Map<CircleMomentReactionEmoji, { count: number; reactedByMe: boolean }>();
  for (const value of latest.values()) {
    if (!value.active) continue;
    const current = counts.get(value.emoji) ?? { count: 0, reactedByMe: false };
    current.count++;
    if (value.identity === 'self') current.reactedByMe = true;
    counts.set(value.emoji, current);
  }
  return Object.freeze([...counts.entries()].map(([emoji, value]) => Object.freeze({ emoji, ...value })).sort((a, b) => circleMomentReactionEmojis.indexOf(a.emoji) - circleMomentReactionEmojis.indexOf(b.emoji)));
}
