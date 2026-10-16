import { copySnapshotHeader } from '../../security/snapshot-header.ts';
import { AuthError } from '../auth/api.ts';
import type { Session } from '../auth/api.ts';
import type { MessageDraft } from './send';
import type { SentEvent } from './api';

export function createAccountSender(session: () => Session, ready: () => boolean, send: (draft: MessageDraft) => Promise<SentEvent>, reconcile: () => Promise<void> = async () => {}, recover: (draft: MessageDraft) => Promise<'cancelled' | 'committed'> = async () => { throw new AuthError('UNAVAILABLE'); }) {
  let tail: Promise<void> = Promise.resolve();
  function assertBinding(bound: Session) {
    const current = session();
    if (current.account.id !== bound.account.id || current.deviceId !== bound.deviceId || current.generation !== bound.generation || current.accessToken !== bound.accessToken) {
      throw new AuthError('SESSION_REVOKED');
    }
    if (!ready()) throw new AuthError('UNAVAILABLE');
  }
  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    let bound: Session;
    try { const value = session(); bound = { ...value, account: { ...value.account } }; assertBinding(bound); } catch (error) { return Promise.reject(error); }
    const result = tail.then(async () => {
      assertBinding(bound);
      const value = await job();
      assertBinding(bound);
      return value;
    });
    tail = result.then(() => {}, () => {});
    return result;
  }
  return {
    send(input: MessageDraft): Promise<SentEvent> { const draft = { ...input, ...(input.collectionSnapshot ? { collectionSnapshot: copySnapshotHeader(input.collectionSnapshot) } : {}), ...(input.collectionChange ? { collectionChange: Object.freeze({ ...input.collectionChange }) } : {}) }; return enqueue(() => send(draft)); },
    reconcile: () => enqueue(reconcile),
    recoverProfile(input: MessageDraft) { const draft = { ...input, ...(input.collectionSnapshot ? { collectionSnapshot: copySnapshotHeader(input.collectionSnapshot) } : {}), ...(input.collectionChange ? { collectionChange: Object.freeze({ ...input.collectionChange }) } : {}) }; return enqueue(() => recover(draft)); },
  };
}
