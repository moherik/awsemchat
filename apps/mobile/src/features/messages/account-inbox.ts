import { AuthError } from '../auth/api.ts';
import type { Session } from '../auth/api.ts';

type Worker = { run(): Promise<{ more: boolean }> };
function same(a: Session, b: Session) {
  return a.account.id === b.account.id && a.deviceId === b.deviceId && a.generation === b.generation && a.accessToken === b.accessToken;
}
export function createAccountInbox(session: () => Session, ready: () => boolean, createWorker: () => Worker) {
  let current: { binding: Session; worker: Worker } | undefined;
  return {
    async sync(): Promise<{ more: boolean }> {
      const before = session();
      if (!ready()) throw new AuthError('UNAVAILABLE');
      if (!current || !same(current.binding, before)) {
        current = { binding: { ...before, account: { ...before.account } }, worker: createWorker() };
      }
      const result = await current.worker.run();
      if (!same(before, session())) throw new AuthError('SESSION_REVOKED');
      if (!ready()) throw new AuthError('UNAVAILABLE');
      return result;
    },
  };
}
