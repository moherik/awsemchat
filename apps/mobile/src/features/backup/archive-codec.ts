import type { ArchiveCodec } from './history-backup';
import type { HistoryRecord } from '../../storage/history-types';

export function createArchiveCodec(execute: (input: string) => Promise<string>): ArchiveCodec {
  async function call(input: object): Promise<Record<string, unknown>> {
    try {
      const response = JSON.parse(await execute(JSON.stringify(input)));
      if (response.ok !== true || !response.value || typeof response.value !== 'object' || Array.isArray(response.value)) throw new Error();
      return response.value;
    } catch { throw new Error('ARCHIVE_REJECTED'); }
  }
  return {
    async encode(account, records) {
      const value = await call({ op: 'encode', account, records });
      if (typeof value.archive !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.archive) ||
        typeof value.recoveryKey !== 'string' || !/^[a-f0-9]{64}$/.test(value.recoveryKey)) throw new Error('ARCHIVE_REJECTED');
      return { archive: value.archive, recoveryKey: value.recoveryKey };
    },
    async decode(account, archive, recoveryKey) {
      const value = await call({ op: 'decode', account, archive, recoveryKey });
      if (!Array.isArray(value.records)) throw new Error('ARCHIVE_REJECTED');
      return { records: value.records as HistoryRecord[] };
    },
  };
}
