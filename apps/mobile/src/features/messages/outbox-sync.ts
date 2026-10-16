import type { durableEncryption } from '../../security/durable-encryption';
import type { createMessageAPI } from './api';
import { MessageError } from './api.ts';

type Native = Pick<ReturnType<typeof durableEncryption>, 'outgoingHistory' | 'retry' | 'confirmSend'>;
type API = Pick<ReturnType<typeof createMessageAPI>, 'send' | 'status'>;
export function createOutboxSynchronizer(native: Native, api: API) {
  let position = 0;
  let active: Promise<void> | undefined;
  async function refresh() {
    const records = (await native.outgoingHistory()).filter(record => record.status !== 'delivered');
    for (let i = 0; i < Math.min(10, records.length); i++) {
      const record = records[position % records.length];
      position = (position + 1) % records.length;
      const receipt = record.status === 'queued' ? await api.send(await native.retry(record.operation)) :
        record.event === null ? undefined : await api.status(record.event);
      if (!receipt || receipt.operation !== record.operation || (record.event !== null && receipt.id !== record.event)) throw new MessageError('INVALID_RESPONSE');
      await native.confirmSend({ operation: record.operation, event: receipt.id, status: receipt.status });
    }
  }
  return {
    run(): Promise<void> {
      if (!active) active = refresh().finally(() => { active = undefined; });
      return active;
    },
  };
}
