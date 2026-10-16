import type { createCircleMediaUpload } from '../media/upload';
import type { createCircleDetails } from './circle-details';

type Ports = { profile: ReturnType<typeof createCircleDetails>; upload: ReturnType<typeof createCircleMediaUpload> };
export function createCircleAvatarEditor(ports: Ports) {
  let busy = false;
  async function run(work: () => Promise<void>) { if (busy) throw new Error('BUSY'); busy = true; try { await work(); } finally { busy = false; } }
  async function resume() {
    const job = await ports.upload.pending(); if (!job) return;
    await ports.profile.refresh(); const state = ports.profile.getSnapshot();
    const avatar = { epoch: job.epoch, media: job.prepared.descriptor };
    if (state.pending) {
      if (JSON.stringify(state.pending.profile.avatar) !== JSON.stringify(avatar)) throw new Error('PROFILE_PENDING');
      await ports.profile.retry();
    } else {
      if (state.profile?.state !== 'ready') throw new Error('PROFILE_STALE');
      if (state.profile.revision > (job.profileRevision ?? 0) && JSON.stringify(state.profile.profile.avatar) === JSON.stringify(avatar)) {
        if (await ports.upload.pending()) await ports.upload.acknowledge(); return;
      }
      if (!state.canEdit || state.profile.revision !== job.profileRevision) throw new Error('PROFILE_STALE');
      if (state.details?.epoch !== job.epoch) throw new Error('AVATAR_EPOCH_CHANGED');
      const media = await ports.upload.upload();
      await ports.profile.update(job.profileRevision, { ...state.profile.profile, avatar: { epoch: job.epoch, media } }, job.operationID);
    }
    const accepted = ports.profile.getSnapshot().profile;
    if (accepted?.state !== 'ready' || JSON.stringify(accepted.profile.avatar) !== JSON.stringify(avatar)) throw new Error('PROFILE_STALE');
    if (await ports.upload.pending()) await ports.upload.acknowledge();
  }
  return {
    resume: () => run(resume),
    choose: (input: { bytes: Uint8Array; mimeType: string }) => run(async () => {
      if (await ports.upload.pending()) throw new Error('MEDIA_PENDING');
      await ports.profile.refresh(); const state = ports.profile.getSnapshot();
      if (!state.canEdit || !state.details || state.profile?.state !== 'ready') throw new Error('DENIED');
      await ports.upload.prepare(input, state.details.epoch, state.profile.revision); await resume();
    }),
  };
}
