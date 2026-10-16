import { conversationMessages } from './conversation-view.ts';
import type { HistorySnapshot } from './history-store';
import type { Contact, Summary } from '../social/api';
import { selectCircleProfile } from '../social/circle-profile.ts';

export type ConversationPreference = Readonly<{ pinned?: boolean; muted?: boolean; archived?: boolean }>;
export type ConversationFilter = 'All' | 'Private' | 'Circles';
export type ConversationRow = Readonly<{
  id: string;
  kind: 'private' | 'circle';
  peerId?: string;
  circleId?: string;
  title: string;
  subtitle: string;
  preview: string;
  time: string;
  lastActivity?: number;
  latestSequence: number;
  avatar: import('../social/circle-profile').CircleAvatar | null;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
}>;

type Input = {
  friends: readonly Contact[];
  circles: readonly Summary[];
  history: HistorySnapshot;
  preferences: Readonly<Record<string, ConversationPreference>>;
  filter: ConversationFilter;
  query: string;
  archived?: 'exclude' | 'only';
};

function previewFor(history: HistorySnapshot, conversation: string, audience?: string) {
  const selected = audience === undefined ? history : {
    ...history,
    incoming: history.incoming.filter(record => record.audience === audience),
    outgoing: history.outgoing.filter(record => record.audience === audience),
  };
  const messages = conversationMessages(selected, conversation);
  const latest = messages[messages.length - 1];
  return latest ? {
    preview: latest.text || (latest.photoMessage || latest.privatePhotoMessage ? 'Photo' : latest.sticker || latest.privateSticker ? 'Sticker' : 'Message'),
    latestSequence: latest.sequence ?? 0,
    timestamp: latest.timestamp,
  } : { preview: audience?.startsWith('friend:') ? 'Start a private chat' : 'Your Circle is ready', latestSequence: 0, timestamp: undefined };
}

function time(value?: number) {
  return value === undefined ? '' : new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function membershipHistory(history: HistorySnapshot, joinedEpoch: number): HistorySnapshot {
  const current = (record: { audience: string }) => {
    const match = /^circle:(\d+)$/.exec(record.audience);
    return match !== null && Number(match[1]) >= joinedEpoch;
  };
  return { ...history, incoming: history.incoming.filter(current), outgoing: history.outgoing.filter(current) };
}

export function projectConversations(input: Input): ConversationRow[] {
  const rows: ConversationRow[] = [];
  for (const friend of input.friends) {
    if (friend.status !== 'accepted' || !friend.requestId) continue;
    const id = `private:${friend.accountId}`;
    const records = [...input.history.incoming, ...input.history.outgoing].filter(record => record.audience === `friend:${friend.requestId}`);
    const conversation = records[0]?.conversation;
    const summary = conversation ? previewFor(input.history, conversation, `friend:${friend.requestId}`) : previewFor(input.history, '', `friend:${friend.requestId}`);
    const preference = input.preferences[id] ?? {};
    rows.push(Object.freeze({ id, kind: 'private', peerId: friend.accountId, title: friend.pin, subtitle: 'Private chat',
      preview: summary.preview, time: time(summary.timestamp), lastActivity: summary.timestamp, latestSequence: summary.latestSequence, avatar: null,
      pinned: preference.pinned === true, muted: preference.muted === true, archived: preference.archived === true }));
  }
  for (const circle of input.circles) {
    const id = `circle:${circle.id}`;
    const visibleHistory = membershipHistory(input.history, circle.joinedEpoch);
    const profile = selectCircleProfile(visibleHistory, circle.id);
    const latest = previewFor(visibleHistory, circle.id);
    const preference = input.preferences[id] ?? {};
    rows.push(Object.freeze({ id, kind: 'circle', circleId: circle.id,
      title: profile.state === 'ready' ? profile.profile.name : 'Circle', subtitle: `${circle.memberCount} people · Circle`,
      preview: latest.preview, time: time(latest.timestamp), lastActivity: latest.timestamp, latestSequence: latest.latestSequence,
      avatar: profile.state === 'ready' ? profile.profile.avatar : null,
      pinned: preference.pinned === true, muted: preference.muted === true, archived: preference.archived === true }));
  }
  const query = input.query.trim().toLocaleLowerCase();
  return rows.filter(row => (input.filter === 'All' || (input.filter === 'Private' ? row.kind === 'private' : row.kind === 'circle')) &&
      (input.archived === 'only' ? row.archived : !row.archived) && (!query || `${row.title} ${row.subtitle} ${row.preview}`.toLocaleLowerCase().includes(query)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.title.localeCompare(b.title));
}
