import { decodeCircleMemberProfile, encodeCircleMemberProfile } from './circle-member-profile.ts';
import type { Page, Summary } from './api.ts';

type Profile = Readonly<{ revision: number; name: string; status: string }>;
type Outgoing = Readonly<{ conversation: string; audience: string; circle: string | null; target: string | null; operation: string; contentType?: string | null; plaintext: string; status: 'queued' | 'sent' | 'delivered' }>;
type Context = Readonly<{ conversation: string; audience: string; epoch?: number; recipients: readonly unknown[] }>;
type Ports = {
  binding(): string;
  page(cursor: string, limit: number): Promise<Page<Pick<Summary, 'id'>>>;
  context(circleId: string): Promise<Context>;
  outgoing(): Promise<readonly Outgoing[]>;
  operation(revision: number, circleId: string, audience: string): string | Promise<string>;
  send(draft: { circleId: string; expectedEpoch: number; operation: string; contentType: 'circle-member-profile'; plaintext: string }): Promise<unknown>;
};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) && value !== '.' && value !== '..';

export function createCircleMemberProfileFanout(ports: Ports) {
  let requested: Profile | undefined;
  let active: Promise<void> | undefined;

  function check(bound: string) {
    if (!bound || ports.binding() !== bound) throw new Error('SESSION_CHANGED');
  }

  async function publish(profile: Profile) {
    if (!Number.isSafeInteger(profile.revision) || profile.revision < 1 || typeof profile.name !== 'string' || !profile.name.trim()) return;
    const bound = ports.binding(); check(bound);
    const plaintext = encodeCircleMemberProfile(profile);
    const seenCursors = new Set<string>();
    let cursor = '';
    do {
      check(bound);
      const page = await ports.page(cursor, 25); check(bound);
      const seenCircles = new Set<string>();
      for (const circle of page.items) {
        if (!validId(circle.id) || seenCircles.has(circle.id)) continue;
        seenCircles.add(circle.id);
        const context = await ports.context(circle.id); check(bound);
        if (context.conversation !== circle.id || !Number.isSafeInteger(context.epoch) || context.epoch! < 1 || context.audience !== `circle:${context.epoch}` || !Array.isArray(context.recipients) || context.recipients.length === 0) continue;
        const outgoing = await ports.outgoing(); check(bound);
        const prior = outgoing.filter(record => record.contentType === 'circle-member-profile' && record.conversation === circle.id && record.circle === circle.id && record.target === null && record.audience === context.audience);
        const decoded = prior.map(record => ({ record, profile: decodeCircleMemberProfile(record.plaintext) }));
        if (decoded.some(value => !value.profile)) throw new Error('PROFILE_CONFLICT');
        const exact = decoded.filter(value => value.profile!.revision === profile.revision);
        if (exact.some(value => value.profile!.name !== profile.name || value.profile!.status !== profile.status)) throw new Error('PROFILE_CONFLICT');
        const committed = decoded.filter(value => value.record.status !== 'queued');
        const newest = committed.reduce((revision, value) => Math.max(revision, value.profile!.revision), 0);
        if (newest > profile.revision || exact.some(value => value.record.status !== 'queued')) continue;
        const queued = exact.find(value => value.record.status === 'queued');
        const operation = queued?.record.operation ?? await ports.operation(profile.revision, circle.id, context.audience);
        if (!validId(operation)) throw new Error('INVALID_PROFILE_OPERATION');
        await ports.send({ circleId: circle.id, expectedEpoch: context.epoch!, operation, contentType: 'circle-member-profile', plaintext: queued?.record.plaintext ?? plaintext });
        check(bound);
      }
      const next = page.nextCursor;
      if (!next) break;
      if (typeof next !== 'string' || !next || seenCursors.has(next)) throw new Error('INVALID_CURSOR');
      seenCursors.add(next); cursor = next;
    } while (true);
  }

  async function drain() {
    while (requested) {
      const profile = requested; requested = undefined;
      await publish(profile);
    }
  }

  return {
    run(profile: Profile): Promise<void> {
      requested = Object.freeze({ ...profile });
      if (!active) active = drain().finally(() => { active = undefined; });
      return active;
    },
  };
}
