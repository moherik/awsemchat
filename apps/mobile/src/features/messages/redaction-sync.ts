import type { durableEncryption } from '../../security/durable-encryption';
import type { createMessageAPI } from './api';

type Native = Pick<ReturnType<typeof durableEncryption>, 'redactionCursor' | 'applyRedactions'>;
type API = Pick<ReturnType<typeof createMessageAPI>, 'redactions'>;

export function createRedactionSynchronizer(native: Native, api: API, active: () => boolean = () => true) {
  let pending: Promise<{ more: boolean }> | undefined;
  async function page() {
    if (!active()) throw Object.assign(new Error('SESSION_REVOKED'), { code: 'SESSION_REVOKED' });
    const previousCursor = await native.redactionCursor();
    const result = await api.redactions(previousCursor ?? '', 50);
    if (!active()) throw Object.assign(new Error('SESSION_REVOKED'), { code: 'SESSION_REVOKED' });
    await native.applyRedactions(previousCursor, result.cursor, result.items);
    return { more: result.more };
  }
  return {
    run(): Promise<{ more: boolean }> {
      if (!pending) pending = page().finally(() => { pending = undefined; });
      return pending;
    },
  };
}
