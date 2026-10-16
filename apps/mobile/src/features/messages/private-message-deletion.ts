import type { durableEncryption, PendingRedaction, Redaction, RedactionTarget } from '../../security/durable-encryption';
import type { createMessageAPI } from './api';
import { encodeRedactionControl } from './redaction-control.ts';

type Binding = { id: string; binding: string };
type Native = Pick<ReturnType<typeof durableEncryption>, 'beginRedaction' | 'pendingRedactions' | 'confirmRedaction' | 'cancelRedaction' | 'completeRedaction'>;
type API = Pick<ReturnType<typeof createMessageAPI>, 'redact'>;
type Notice = (redaction: Redaction, operation: string, plaintext: string, route?: PendingRedaction['route']) => Promise<'committed' | 'unavailable'>;
type Input = { account(): Binding; native: Native | (() => Native); api: API; route: Notice; operation(): string };

function pendingError(cause?: unknown) {
  return Object.assign(new Error('DELETION_PENDING', cause ? { cause } : undefined), { code: 'DELETION_PENDING' });
}
function sameTarget(a: RedactionTarget, b: RedactionTarget) { return JSON.stringify(a) === JSON.stringify(b); }
function definitive(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && ['DENIED', 'INVALID_INPUT', 'MESSAGE_REDACTED', 'REDACTION_CONFLICT'].includes(String(error.code)));
}

export function createPrivateMessageDeletion(input: Input) {
  const native = () => typeof input.native === 'function' ? input.native() : input.native;
  const assertBinding = (binding: Binding) => {
    const current = input.account();
    if (current.id !== binding.id || current.binding !== binding.binding) throw Object.assign(new Error('SESSION_REVOKED'), { code: 'SESSION_REVOKED' });
  };
  async function finish(adapter: Native, binding: Binding, pending: PendingRedaction, redaction: Redaction) {
    const plaintext = encodeRedactionControl(redaction);
    let result: 'committed' | 'unavailable';
    try { result = await input.route(redaction, pending.operation, plaintext, pending.route); }
    catch (error) { throw pendingError(error); }
    assertBinding(binding);
    if (result !== 'committed' && result !== 'unavailable') throw pendingError(new Error('INVALID_ROUTE_RESULT'));
    await adapter.completeRedaction(redaction.eventId);
    assertBinding(binding);
  }
  async function confirm(adapter: Native, binding: Binding, pending: PendingRedaction) {
    let saved = pending;
    if (!saved.confirmed) {
      let redaction: Redaction;
      try { redaction = await input.api.redact(saved.target); }
      catch (error) {
        if (definitive(error)) {
          assertBinding(binding);
          await adapter.cancelRedaction(saved.operation);
          throw error;
        }
        throw pendingError(error);
      }
      assertBinding(binding);
      await adapter.confirmRedaction(saved.target, redaction);
      assertBinding(binding);
      saved = { ...saved, confirmed: true, redaction };
    }
    if (!saved.redaction) throw pendingError(new Error('MISSING_REDACTION'));
    await finish(adapter, binding, saved, saved.redaction);
  }
  return {
    async delete(target: RedactionTarget): Promise<void> {
      const adapter = native();
      const binding = { ...input.account() };
      assertBinding(binding);
      const existing = (await adapter.pendingRedactions()).find(item => sameTarget(item.target, target));
      assertBinding(binding);
      const pending = existing ?? await adapter.beginRedaction(target, input.operation());
      assertBinding(binding);
      await confirm(adapter, binding, pending);
    },
    async retry(): Promise<void> {
      const adapter = native();
      const binding = { ...input.account() };
      const pending = await adapter.pendingRedactions();
      assertBinding(binding);
      for (const item of pending) {
        await confirm(adapter, binding, item);
        assertBinding(binding);
      }
    },
  };
}
