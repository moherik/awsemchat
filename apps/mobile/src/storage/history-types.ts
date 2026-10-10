export type HistoryRecord = {
  eventId: string;
  conversationId: string;
  originalAudience: string[];
  membershipInterval: string;
  receivedAt: number;
  payload: string;
};

export function validateHistoryRecord(record: HistoryRecord): void {
  if (!record.eventId || !record.conversationId || !record.membershipInterval ||
      !Number.isSafeInteger(record.receivedAt) || record.receivedAt < 0 ||
      !Array.isArray(record.originalAudience) || record.originalAudience.length === 0 ||
      record.originalAudience.some((id) => typeof id !== 'string' || !id) ||
      new Set(record.originalAudience).size !== record.originalAudience.length ||
      typeof record.payload !== 'string' || record.payload.length > 1_000_000) {
    throw new Error('Invalid archival history record');
  }
}
