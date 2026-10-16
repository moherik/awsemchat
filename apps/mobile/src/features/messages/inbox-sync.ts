import { receiveDelivery } from './receive.ts';
import type { InboxPage } from './api';

type InboxNative = Parameters<typeof receiveDelivery>[0] & {
  inboxCursor(): Promise<string | null>;
  advanceInboxCursor(previous: string | null, next: string): Promise<unknown>;
};
type InboxAPI = Parameters<typeof receiveDelivery>[1] & {
  inbox(cursor?: string, limit?: number): Promise<InboxPage>;
};

type RedactionWorker = { run(): Promise<{ more: boolean }> };
export function createInboxSynchronizer(native: InboxNative, api: InboxAPI, redactionSync?: RedactionWorker) {
  let active: Promise<{ more: boolean }> | undefined;
  async function page() {
    const beforeInbox = await redactionSync?.run();
    const previous = await native.inboxCursor();
    const result = await api.inbox(previous ?? '', 25);
    for (const delivery of result.items) await receiveDelivery(native, api, delivery);
    if (result.cursor !== undefined && result.cursor !== previous) {
      await native.advanceInboxCursor(previous, result.cursor);
    }
    const afterInbox = await redactionSync?.run();
    return { more: result.more || beforeInbox?.more === true || afterInbox?.more === true };
  }
  return {
    run(): Promise<{ more: boolean }> {
      if (!active) active = page().finally(() => { active = undefined; });
      return active;
    },
  };
}

type HistoryAPI = Parameters<typeof receiveDelivery>[1] & {
  history(conversation: string, audience: string, cursor?: string, limit?: number): Promise<InboxPage>;
};
export function createHistoryPaginator(native: Parameters<typeof receiveDelivery>[0], api: HistoryAPI, redactionSync?: RedactionWorker) {
  const pages = new Map<string, { cursor: string; more: boolean }>();
  const active = new Map<string, Promise<{ more: boolean; cursor?: string }>>();
  async function loadPage(conversation: string, audience: string) {
    const key = JSON.stringify([conversation, audience]);
    const current = pages.get(key) ?? { cursor: '', more: true };
    if (!current.more) return { more: false };
    await redactionSync?.run();
    const result = await api.history(conversation, audience, current.cursor, 25);
    for (const delivery of result.items) await receiveDelivery(native, api, delivery, { acknowledge: false });
    await redactionSync?.run();
    const more = result.more;
    const cursor = result.more ? result.cursor : undefined;
    pages.set(key, { cursor: cursor ?? current.cursor, more: result.more });
    return { more, ...(cursor ? { cursor } : {}) };
  }
  return {
    load(conversation: string, audience: string): Promise<{ more: boolean; cursor?: string }> {
      const key = JSON.stringify([conversation, audience]);
      const running = active.get(key);
      if (running) return running;
      const result = loadPage(conversation, audience).finally(() => active.delete(key));
      active.set(key, result);
      return result;
    },
    reset(conversation: string, audience: string) { pages.delete(JSON.stringify([conversation, audience])); },
  };
}
