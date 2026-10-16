import { useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { PeerKeys } from '../../security/durable-encryption';
import { createIdentityReview } from './identity-review';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
export function IdentityPanel({ runtime, peer, circle }: { runtime: AuthenticationRuntime; peer: string; circle?: string }) {
  const c = usePalette();
  const [open, setOpen] = useState(false), [own, setOwn] = useState<PeerKeys>();
  const review = useMemo(() => createIdentityReview({ peer: id => runtime.encryption().peer(id), acknowledgePeer: (id, keys) => runtime.encryption().acknowledgePeer(id, keys), verifyPeer: (id, keys) => runtime.encryption().verifyPeer(id, keys) }, peer, async () => {
    const context = await runtime.messages.context(circle ? { circleId: circle } : { targetId: peer });
    const recipient = context.recipients.find(item => item.accountId === peer);
    if (!recipient) throw new Error('UNAVAILABLE');
    await runtime.encryption().observePeer(peer, recipient.keys);
  }), [runtime, peer, circle]);
  const state = useSyncExternalStore(review.subscribe, review.getSnapshot, review.getSnapshot);
  const work = (job: () => Promise<unknown>, success?: string) => { void job().then(() => { if (success) showFeedback(success); }, error => {
    showFeedback(error?.code === 'OPERATION_CONFLICT' ? 'The identity changed again. Review the updated keys.' : 'Could not update security details. Please retry.');
  }); };
  const button = (title: string, job: () => void) => <Pressable accessibilityRole="button" disabled={state.busy} accessibilityState={{ disabled: state.busy }} onPress={job} style={{ minHeight: 44, justifyContent: 'center', opacity: state.busy ? 0.5 : 1 }}><Text style={{ color: c.accent }}>{title}</Text></Pressable>;
  const identity = (title: string, keys?: PeerKeys) => keys && <View style={{ gap: 4 }}><Text style={{ color: c.text, fontWeight: '600' }}>{title}</Text><Text selectable style={{ color: c.muted, fontFamily: 'monospace', fontSize: 12 }}>{keys.identity}</Text><Text selectable style={{ color: c.muted, fontFamily: 'monospace', fontSize: 12 }}>{keys.signingIdentity}</Text></View>;
  return <View style={{ paddingHorizontal: 16, borderBottomWidth: 0.5, borderColor: c.line }}>
    {button(open ? 'Hide security details' : 'Security details', () => { setOpen(value => !value); if (!open) work(async () => { setOwn(await runtime.encryption().bundle()); await review.refresh(); }); })}
    {open && <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}><Text style={{ color: c.muted, fontSize: 13 }}>{state.phase === 'changed' ? 'Your friend’s identity changed. Confirm it with your friend before accepting. Previously queued messages stay blocked. Write a new message after accepting.' : state.phase === 'locked' ? 'Too many identity changes. Sending stays locked.' : state.phase === 'verified' ? 'You marked this identity as compared with your friend.' : 'Comparing identities is optional. Ask your friend to compare their own public keys with the friend keys shown here.'}</Text>
      {identity('Your public keys', own)}{identity('Friend’s current public keys', state.current)}{identity('New public keys', state.pending)}
      {state.phase === 'changed' && button('Accept this new identity', () => work(review.accept, 'New identity accepted. It is not marked verified.'))}
      {state.phase === 'unverified' && button('I compared these keys with my friend', () => work(review.verify, 'Identity marked as compared.'))}
      {button('Refresh security details', () => work(review.refresh))}
    </ScrollView>}
  </View>;
}
