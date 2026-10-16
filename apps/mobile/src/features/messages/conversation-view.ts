import type { PeerKeys, RedactionTarget } from '../../security/durable-encryption';
import type { HistorySnapshot } from './history-store';
import { decodeCircleStickerMessage, type CircleStickerMessage } from './circle-sticker-message.ts';
import { decodeCircleMoment } from './circle-moments.ts';
import { decodeCircleMomentReaction } from './circle-moment-reactions.ts';
import { decodeCircleMomentDeletion } from './circle-moment-deletion.ts';
import { decodeCirclePhotoMessage, type CirclePhotoMessage } from './circle-photo-message.ts';
import { decodeCircleMomentReply, type CircleMomentReply } from './circle-moment-reply.ts';
import { decodePrivateMoment, decodePrivateMomentReaction, decodePrivateMomentDeletion, decodePrivateMomentReply, type PrivateMomentReply } from './private-moments.ts';
import { decodePrivatePhotoMessage, type PrivatePhotoMessage } from './private-photo-message.ts';
import { decodePrivateStickerMessage, type PrivateStickerMessage } from './private-sticker-message.ts';
import { decodePing, decodePong } from './ping-pong.ts';
export type ConversationMessage = { id: string; operation: string; own: boolean; sender?: PeerKeys; redactionTarget?: RedactionTarget; text: string; ping?: true; pong?: { pingOperation: string }; respondedByMe?: boolean; sticker?: CircleStickerMessage; privateSticker?: PrivateStickerMessage; momentReply?: CircleMomentReply | PrivateMomentReply; photoMessage?: CirclePhotoMessage; privatePhotoMessage?: PrivatePhotoMessage; sequence?: number; timestamp?: number; status?: 'queued' | 'sent' | 'delivered' };
function messageContent(plaintext: string) {
  const momentReply = decodeCircleMomentReply(plaintext);
  const privateMomentReply = decodePrivateMomentReply(plaintext);
  const photoMessage = decodeCirclePhotoMessage(plaintext);
  const privatePhotoMessage = decodePrivatePhotoMessage(plaintext);
  const privateSticker = decodePrivateStickerMessage(plaintext);
  const sticker = decodeCircleStickerMessage(plaintext);
  return { text: momentReply?.text ?? privateMomentReply?.text ?? photoMessage?.caption ?? privatePhotoMessage?.caption ?? privateSticker?.label ?? sticker?.label ?? plaintext, ...(sticker ? { sticker } : {}), ...(privateSticker ? { privateSticker } : {}), ...(momentReply ? { momentReply } : privateMomentReply ? { momentReply: privateMomentReply } : {}), ...(photoMessage ? { photoMessage } : {}), ...(privatePhotoMessage ? { privatePhotoMessage } : {}) };
}
function isMomentControl(plaintext: string) { return !!decodeCircleMoment(plaintext) || !!decodeCircleMomentReaction(plaintext) || !!decodeCircleMomentDeletion(plaintext) || !!decodePrivateMoment(plaintext) || !!decodePrivateMomentReaction(plaintext) || !!decodePrivateMomentDeletion(plaintext); }
function validPrivatePhotoRecord(record: { plaintext: string; operation: string; audience?: string }) { const photo = decodePrivatePhotoMessage(record.plaintext); return !photo || photo.id === record.operation && photo.audience === record.audience; }
function validPrivateStickerRecord(record: { plaintext: string; operation: string; audience?: string }) { const sticker = decodePrivateStickerMessage(record.plaintext); return !sticker || sticker.id === record.operation && sticker.audience === record.audience; }
function validPingPongRecord(record: { contentType?: string | null; plaintext: string }, conversation: string) {
  if (record.contentType !== 'ping' && record.contentType !== 'pong') return true;
  if (!conversation.startsWith('private:')) return false;
  return record.contentType === 'ping' ? !!decodePing(record.plaintext) : !!decodePong(record.plaintext);
}
function pingPongContent(record: { contentType?: string | null; plaintext: string }): Pick<ConversationMessage, 'text' | 'ping' | 'pong'> | undefined {
  if (record.contentType === 'ping') return { text: 'PING!', ping: true };
  if (record.contentType === 'pong') {
    const pong = decodePong(record.plaintext);
    return pong ? { text: 'PONG!', pong: { pingOperation: pong.pingOperation } } : undefined;
  }
  return undefined;
}
function redactionTarget(record: { serverEventId?: string | null; operation: string; conversation: string; audience?: string | null; sender?: PeerKeys }, own: boolean): RedactionTarget | undefined {
  if (!own) return undefined;
  if (record.serverEventId) return { eventId: record.serverEventId };
  if (record.audience && record.sender?.identity && record.sender.signingIdentity) return { legacy: {
    conversation: record.conversation, audience: record.audience, operation: record.operation,
    peerKeys: { identity: record.sender.identity, signingIdentity: record.sender.signingIdentity },
  } };
  return undefined;
}
export function conversationMessages(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, conversation: string, ownSender?: PeerKeys): ConversationMessage[] {
  const messages: ConversationMessage[] = [
    ...history.incoming.filter(record => record.conversation === conversation && record.contentType !== 'redaction-control' && record.contentType !== 'circle-profile' && record.contentType !== 'circle-member-profile' && record.contentType !== 'private-profile' && record.contentType !== 'now-playing' && record.contentType !== 'circle-collection' && record.contentType !== 'circle-collection-snapshot' && !isMomentControl(record.plaintext) && validPrivatePhotoRecord(record) && validPrivateStickerRecord(record) && validPingPongRecord(record, conversation)).map(record => ({
      id: `incoming:${record.sender.identity}:${record.operation}`, operation: record.operation, own: record.direction === 'outgoing', sender: record.sender,
      ...(redactionTarget(record, record.direction === 'outgoing') ? { redactionTarget: redactionTarget(record, true) } : {}), ...messageContent(record.plaintext), ...pingPongContent(record), sequence: record.sequence,
      ...(record.createdAt === undefined ? {} : { timestamp: record.createdAt * 1000 }),
    })),
    ...history.outgoing.filter(record => record.conversation === conversation && record.contentType !== 'redaction-control' && record.contentType !== 'circle-profile' && record.contentType !== 'circle-member-profile' && record.contentType !== 'private-profile' && record.contentType !== 'now-playing' && record.contentType !== 'circle-collection' && record.contentType !== 'circle-collection-snapshot' && !isMomentControl(record.plaintext) && validPrivatePhotoRecord(record) && validPrivateStickerRecord(record) && validPingPongRecord(record, conversation)).map(record => ({
      id: `outgoing:${record.operation}`, operation: record.operation, own: true,
      ...(record.status !== 'queued' && redactionTarget({ ...record, sender: ownSender }, true) ? { redactionTarget: redactionTarget({ ...record, sender: ownSender }, true) } : {}), ...messageContent(record.plaintext), ...pingPongContent(record), status: record.status, sequence: record.sequence ?? undefined,
      ...(record.createdAt === null ? {} : { timestamp: record.createdAt * 1000 }),
    })),
  ].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const responded = new Set(messages.filter(item => item.own && item.pong).map(item => item.pong!.pingOperation));
  return messages.map(item => item.ping ? { ...item, respondedByMe: responded.has(item.operation) } : item);
}

export function conversationTitle(accepted: readonly { accountId: string; pin: string }[], peer: string) {
  return accepted.find(contact => contact.accountId === peer)?.pin ?? "Private chat";
}
