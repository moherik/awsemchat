import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import type { AuthenticationRuntime } from '../auth/runtime';
import type { Details, MembershipMutation } from './api';
import type { PendingMembership } from './circle-membership';
import { CreationButton } from './circle-creation-screen';
import { showFeedback } from '../feedback/snackbar';
import { usePalette } from '../ui';
import { PopupMenu } from '../popup-menu.native';
type Controller = Awaited<ReturnType<AuthenticationRuntime['circleMembership']>>;
export function CircleMembershipActions({ runtime, circleId, details, refresh }: { runtime: AuthenticationRuntime; circleId: string; details?: Details; refresh(): Promise<void> }) {
  const c = usePalette();
  const [controller, setController] = useState<Controller>(), [pending, setPending] = useState<PendingMembership>();
  const [confirm, setConfirm] = useState<{ action: MembershipMutation['action']; target?: string; pin?: string; guard: { epoch: number; actorInterval: string; targetInterval?: string } }>();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const active = useRef(true), working = useRef(false);
  useEffect(() => {
    active.current = true; let current = true;
    void runtime.circleMembership(circleId).then(async value => { const record = await value.pending(); if (current) { setController(value); setPending(record); setFailed(false); } }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; active.current = false; };
  }, [runtime, circleId, attempt]);
  const own = details?.members.find(member => member.accountId === runtime.owner.getSnapshot().account?.id);
  function choose(action: MembershipMutation['action'], target?: string, pin?: string, interval?: string) {
    if (!details || !own) return;
    setConfirm({ action, target, pin, guard: { epoch: details.epoch, actorInterval: own.intervalId, ...(interval ? { targetInterval: interval } : {}) } });
  }
  async function execute(cancel = false) {
    if (!controller || working.current) return;
    const account = runtime.owner.getSnapshot(); working.current = true; setBusy(true);
    try {
      if (!pending) { if (!confirm) return; await controller.prepare(confirm.action, confirm.target, confirm.guard); }
      const result = await (cancel ? controller.cancel() : controller.execute());
      if (!active.current || runtime.owner.getSnapshot() !== account) return;
      setPending(await controller.pending()); setConfirm(undefined); setCancelConfirm(false);
      showFeedback(result.cancelled ? 'Saved action canceled.' : result.action === 'leave' ? result.closed ? 'Circle closed.' : 'You left the Circle.' : result.action === 'remove' ? 'Member removed.' : 'Admin role transferred. You are now a member.');
      await controller.acknowledge();
      if (!active.current || runtime.owner.getSnapshot() !== account) return;
      setPending(undefined);
      await runtime.circles.refresh().catch(() => {});
      if (result.action === 'leave' && !result.cancelled) router.replace({ pathname: '/flow', params: { view: 'circles' } });
      else await refresh().catch(() => {});
    } catch (error) {
      if (!active.current || runtime.owner.getSnapshot() !== account) return;
      let record: PendingMembership | undefined;
      try { record = await controller.pending(); } catch { setFailed(true); }
      if (!active.current) return; setPending(record);
      const code = error instanceof Error ? error.message : '';
      showFeedback(record?.result ? 'The action completed. Retry opening its saved result.' : code === 'ADMIN_HANDOFF_REQUIRED' ? 'Choose another member as admin before leaving.' : code === 'MEMBERSHIP_CHANGED' ? 'Membership changed. This saved action was not applied.' : record ? 'Your saved action is kept. Retry the same action.' : 'Could not start this action. Refresh the Circle and retry.');
    } finally { working.current = false; if (active.current) setBusy(false); }
  }
  if (failed) return <CreationButton label="Retry opening member controls" action={() => { setFailed(false); setAttempt(value => value + 1); }} />;
  if (!controller) return null;
  if (pending) return <View style={{ gap: 12 }}><Text style={{ color: c.text }}>Saved {pending.input.action === 'leave' ? 'leave' : pending.input.action === 'handoff' ? 'admin handoff' : 'member removal'} action</Text>{cancelConfirm ? <><Text style={{ color: c.muted }}>Cancel this saved action? If it already completed, we’ll show that result. Completed changes cannot be undone here.</Text><CreationButton label="Confirm cancellation" disabled={busy} action={() => { void execute(true); }} /><CreationButton label="Go back" disabled={busy} action={() => setCancelConfirm(false)} /></> : <><CreationButton label={busy ? 'Finishing…' : pending.result ? 'Open completed result' : 'Retry saved action'} disabled={busy} primary action={() => { void execute(); }} />{!pending.result && <CreationButton label="Cancel saved action" disabled={busy} action={() => setCancelConfirm(true)} />}</>}</View>;
  if (confirm) return <View style={{ gap: 12 }}><Text style={{ color: c.text, fontWeight: '600' }}>{confirm.action === 'leave' ? details?.memberCount === 1 ? 'Close this Circle?' : 'Leave this Circle?' : confirm.action === 'remove' ? `Remove ${confirm.pin}?` : `Make ${confirm.pin} the admin?`}</Text><Text style={{ color: c.muted }}>{confirm.action === 'leave' ? details?.memberCount === 1 ? 'The Circle will close and pending invitations will be revoked.' : 'You will stop receiving new messages and Moments. Rejoining requires a new invitation.' : confirm.action === 'remove' ? 'They will stop receiving new content. Rejoining requires a new accepted invitation.' : 'You will become a member. Your pending invitations will be revoked.'}</Text><CreationButton label={busy ? 'Finishing…' : 'Confirm'} disabled={busy} primary action={() => { void execute(); }} /><CreationButton label="Cancel" disabled={busy} action={() => setConfirm(undefined)} /></View>;
  if (!own) return null;
  const handoffRequired = own.role === 'admin' && details!.memberCount > 1 && details!.members.filter(member => member.role === 'admin').length === 1;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>Members</Text>
    {details!.members.map(member => <View key={member.intervalId} style={{ minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 0.5, borderColor: c.line }}><View style={{ width: 40, height: 40, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-outline" size={24} color={c.muted} /></View><View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 16 }}>{member.pin}</Text><Text style={{ color: c.muted, fontSize: 13 }}>{member.role === 'admin' ? 'Admin' : 'Member'}</Text></View>{own.role === 'admin' && member.accountId !== own.accountId && <PopupMenu label={`${member.pin} member options`} actions={[{ id: 'handoff', label: 'Make admin', icon: 'account-key-outline', onPress: () => choose('handoff', member.accountId, member.pin, member.intervalId) }, { id: 'remove', label: 'Remove member', icon: 'account-remove-outline', destructive: true, onPress: () => choose('remove', member.accountId, member.pin, member.intervalId) }]} />}</View>)}
    {own.role === 'admin' && <CreationButton label="Invite friends" action={() => router.push({ pathname: '/flow', params: { view: 'invite-members', circle: circleId } })} />}
    {handoffRequired && <Text style={{ color: c.muted }}>Choose another member as admin before leaving.</Text>}
    <CreationButton label={details!.memberCount === 1 ? 'Leave and close Circle' : 'Leave Circle'} disabled={handoffRequired} action={() => choose('leave')} />
  </View>;
}
