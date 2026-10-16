import type { createCircleMediaUpload } from '../media/upload';
import type { CircleAvatar } from './circle-profile';

type Ports = { upload(purpose: 'avatar-edit' | 'avatar-refresh'): Promise<ReturnType<typeof createCircleMediaUpload>>; download(avatar: CircleAvatar): Promise<Uint8Array> };
export function createCircleAvatarMedia(ports: Ports) {
  return {
    async rebind(avatar: CircleAvatar, epoch: number, revision: number, operation: string): Promise<CircleAvatar> {
      if (avatar.epoch === epoch) return avatar;
      const upload = await ports.upload('avatar-refresh'), pending = await upload.pending();
      if (pending && (pending.epoch !== epoch || pending.profileRevision !== revision)) throw new Error('PROFILE_STALE');
      if (!pending) await upload.prepare({ bytes: await ports.download(avatar), mimeType: avatar.media.mimeType }, epoch, revision, undefined, undefined, undefined, undefined, operation);
      return Object.freeze({ epoch, media: await upload.upload() });
    },
    async cancelled(avatar: CircleAvatar, revision: number) {
      for (const purpose of ['avatar-edit', 'avatar-refresh'] as const) {
        const upload = await ports.upload(purpose), pending = await upload.pending();
        if (pending && pending.profileRevision === revision - 1 && pending.epoch === avatar.epoch && JSON.stringify(pending.prepared.descriptor) === JSON.stringify(avatar.media)) {
          const result = await upload.cancel(); if (result.state !== 'cancelled') throw new Error('PROFILE_COMMITTED');
        }
      }
    },
    async committed(avatar: CircleAvatar, revision: number) {
      for (const purpose of ['avatar-edit', 'avatar-refresh'] as const) {
        const upload = await ports.upload(purpose), pending = await upload.pending();
        if (pending?.phase === 'uploaded' && pending.profileRevision !== undefined && revision > pending.profileRevision && pending.epoch === avatar.epoch && JSON.stringify(pending.prepared.descriptor) === JSON.stringify(avatar.media)) await upload.acknowledge();
      }
    },
  };
}
