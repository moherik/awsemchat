import { MessageError } from './api.ts';
export function createComposer(send: (input: { operation: string; plaintext: string }) => Promise<unknown>, queued: (operation: string) => Promise<boolean>, operationID: () => string) {
  let snapshot: Readonly<{ text: string; busy: boolean; uncertain: boolean }> = Object.freeze({ text: '', busy: false, uncertain: false });
  let operation: string | undefined;
  const listeners = new Set<() => void>();
  function publish(text: string, busy: boolean, uncertain = snapshot.uncertain) {
    snapshot = Object.freeze({ text, busy, uncertain });
    for (const listener of listeners) { try { listener(); } catch { /* Rendering cannot change the send outcome. */ } }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setText(text: string) { if (!snapshot.busy && !snapshot.uncertain) { if (text !== snapshot.text) operation = undefined; publish(text, false); } },
    async submit() {
      if (snapshot.busy) throw new MessageError('BUSY');
      if (!snapshot.text.trim()) throw new MessageError('INVALID_INPUT');
      operation ??= operationID();
      const input = { operation, plaintext: snapshot.text };
      publish(snapshot.text, true);
      try { await send(input); operation = undefined; publish('', true, false); }
      catch (error) {
        try {
          if (await queued(input.operation)) { operation = undefined; publish('', true, false); }
          else publish(snapshot.text, true, false);
        } catch { publish(snapshot.text, true, true); }
        throw error;
      } finally { publish(snapshot.text, false); }
    },
  };
}
