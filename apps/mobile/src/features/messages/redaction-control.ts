import type { PeerKeys, Redaction } from '../../security/durable-encryption';

const controlType = 'awsemchat.redaction.v1';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const publicKey = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]$/.test(value);

export type RedactionControl = Pick<Redaction, 'eventId' | 'conversation' | 'audience' | 'operation' | 'sender'>;
function validate(value: unknown): RedactionControl {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONTROL');
  const item = value as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== 'audience,conversation,eventId,operation,sender' ||
      !id(item.eventId) || !id(item.conversation) || !id(item.audience) || !id(item.operation) ||
      !item.sender || typeof item.sender !== 'object' || Array.isArray(item.sender)) throw new Error('INVALID_CONTROL');
  const sender = item.sender as Record<string, unknown>;
  if (Object.keys(sender).sort().join(',') !== 'identity,signingIdentity' || !publicKey(sender.identity) || !publicKey(sender.signingIdentity)) throw new Error('INVALID_CONTROL');
  return { eventId: item.eventId, conversation: item.conversation, audience: item.audience, operation: item.operation,
    sender: { identity: sender.identity, signingIdentity: sender.signingIdentity } as PeerKeys };
}

export function encodeRedactionControl(value: RedactionControl): string {
  return JSON.stringify({ type: controlType, ...validate(value) });
}

export function decodeRedactionControl(value: string, expected?: { conversation: string; audience: string; sender?: PeerKeys }): RedactionControl {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('INVALID_CONTROL');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('INVALID_CONTROL'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_CONTROL');
  const item = parsed as Record<string, unknown>;
  if (item.type !== controlType || Object.keys(item).sort().join(',') !== 'audience,conversation,eventId,operation,sender,type') throw new Error('INVALID_CONTROL');
  const result = validate({ eventId: item.eventId, conversation: item.conversation, audience: item.audience, operation: item.operation, sender: item.sender });
  if (expected && (result.conversation !== expected.conversation || result.audience !== expected.audience ||
    (expected.sender !== undefined && (result.sender.identity !== expected.sender.identity || result.sender.signingIdentity !== expected.sender.signingIdentity)))) throw new Error('INVALID_CONTROL');
  return result;
}
