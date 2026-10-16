import type { ContextInput, ConversationContext } from './api';
import type { PeerKeys } from '../../security/durable-encryption';
export function chatDestination(peer?: string, circle?: string): ContextInput {
  if ((peer === undefined) === (circle === undefined) || !/^[A-Za-z0-9._:-]{1,128}$/.test(peer ?? circle ?? '') || ['.', '..'].includes(peer ?? circle ?? '')) throw new Error('INVALID_INPUT');
  return circle === undefined ? { targetId: peer } : { circleId: circle };
}
export function validChatDestination(peer: unknown, circle: unknown): ContextInput | undefined {
  if ((peer !== undefined && typeof peer !== 'string') || (circle !== undefined && typeof circle !== 'string')) return undefined;
  try { return chatDestination(peer, circle); } catch { return undefined; }
}
export async function privateConversationId(localAccountId: string, peerAccountId: string, digest: (value: string) => Promise<string>): Promise<string> {
  const valid = (value: string) => /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';
  if (!valid(localAccountId) || !valid(peerAccountId) || localAccountId === peerAccountId) throw new Error('INVALID_INPUT');
  const [low, high] = [localAccountId, peerAccountId].sort();
  const hash = await digest(JSON.stringify(['awsemchat.private.v1', low, high]));
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('INVALID_INPUT');
  return `private:${hash}`;
}
export function circleSender(sender: PeerKeys | undefined, context: Pick<ConversationContext, 'recipients'> | undefined,
  members: readonly { accountId: string; pin: string }[]): string {
  const recipient = context?.recipients.find(item => item.keys.identity === sender?.identity && item.keys.signingIdentity === sender?.signingIdentity);
  return members.find(member => member.accountId === recipient?.accountId)?.pin ?? 'Circle member';
}
