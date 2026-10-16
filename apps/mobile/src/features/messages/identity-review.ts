import type { PeerKeys, PeerPin } from '../../security/durable-encryption';
import { MessageError } from './api.ts';
type Native = { peer(peer: string): Promise<PeerPin>; acknowledgePeer(peer: string, keys: PeerKeys): Promise<PeerPin>; verifyPeer(peer: string, keys: PeerKeys): Promise<PeerPin> };
type Snapshot = { phase: 'idle' | 'unverified' | 'verified' | 'changed' | 'locked'; busy: boolean; current?: PeerKeys; pending?: PeerKeys };
export function createIdentityReview(native: Native, peer: string, observeCurrent: () => Promise<void> = async () => {}) {
  let snapshot: Snapshot = Object.freeze({ phase: 'idle', busy: false });
  const listeners = new Set<() => void>();
  function publish(value: Snapshot) {
    snapshot = Object.freeze(value);
    for (const listener of listeners) { try { listener(); } catch { /* A rendering failure cannot acknowledge an identity. */ } }
  }
  function show(pin: PeerPin) {
    publish({ phase: pin.historyExhausted ? 'locked' : pin.pending ? 'changed' : pin.verified ? 'verified' : 'unverified', busy: snapshot.busy,
      current: pin.current ? Object.freeze({ ...pin.current }) : undefined, pending: pin.pending ? Object.freeze({ ...pin.pending }) : undefined });
  }
  async function work(job: () => Promise<void>) {
    if (snapshot.busy) throw new MessageError('BUSY');
    publish({ ...snapshot, busy: true });
    try { await job(); } finally { publish({ ...snapshot, busy: false }); }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => work(async () => { await observeCurrent(); show(await native.peer(peer)); }),
    verify: () => work(async () => {
      const reviewed = snapshot.current;
      await observeCurrent();
      const pin = await native.peer(peer);
      show(pin);
      if (pin.historyExhausted || pin.pending) throw new MessageError('IDENTITY_CHANGED');
      if (!reviewed || reviewed.identity !== pin.current.identity || reviewed.signingIdentity !== pin.current.signingIdentity) throw new MessageError('OPERATION_CONFLICT');
      show(await native.verifyPeer(peer, reviewed));
    }),
    accept: () => work(async () => {
      const reviewed = snapshot.pending;
      await observeCurrent();
      const pin = await native.peer(peer);
      show(pin);
      if (pin.historyExhausted || !pin.pending) throw new MessageError('IDENTITY_CHANGED');
      if (!reviewed || reviewed.identity !== pin.pending.identity || reviewed.signingIdentity !== pin.pending.signingIdentity) throw new MessageError('OPERATION_CONFLICT');
      show(await native.acknowledgePeer(peer, reviewed));
    }),
  };
}
