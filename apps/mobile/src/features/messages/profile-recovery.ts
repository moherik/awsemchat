import type { durableEncryption } from '../../security/durable-encryption';
import type { ProfileCancellation } from './api';
import type { MessageDraft } from './send';

type Ports = { binding(): string; native: Pick<ReturnType<typeof durableEncryption>, 'profileRecoveryDraft' | 'confirmSend' | 'retireProfile'>; cancel(envelope: string): Promise<ProfileCancellation>; cleanupCancelled?(draft: MessageDraft): Promise<void> };
export async function recoverProfileUpdate(ports: Ports, draft: MessageDraft): Promise<'cancelled' | 'committed'> {
  draft = { ...draft };
  if (draft.contentType !== 'circle-profile' || !draft.circleId || draft.targetId !== undefined || !Number.isSafeInteger(draft.profileRevision) || (draft.profileRevision ?? 0) < 1) throw new Error('INVALID_INPUT');
  const bound = ports.binding();
  function check() { if (ports.binding() !== bound) throw new Error('SESSION_CHANGED'); }
  let envelope: string;
  try {
    envelope = await ports.native.profileRecoveryDraft({ operation: draft.operation, circle: draft.circleId, plaintext: draft.plaintext, profileRevision: draft.profileRevision! });
  } catch (error) {
    check();
    if (error && typeof error === 'object' && 'code' in error && error.code === 'OPERATION_CANCELLED') return 'cancelled';
    throw error;
  }
  check(); const result = await ports.cancel(envelope); check();
  if (result.operation !== draft.operation) throw new Error('INVALID_RESPONSE');
  if (result.state === 'committed') {
    if (result.event.operation !== draft.operation || result.event.status !== 'sent' || !result.event.id) throw new Error('INVALID_RESPONSE');
    await ports.native.confirmSend({ operation: draft.operation, event: result.event.id, status: result.event.status });
  } else if (result.state === 'cancelled') {
    if (ports.cleanupCancelled) { await ports.cleanupCancelled(draft); check(); }
    await ports.native.retireProfile({ operation: draft.operation, envelope });
  }
  else throw new Error('INVALID_RESPONSE');
  check(); return result.state;
}
