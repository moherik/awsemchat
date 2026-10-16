import type { Session } from '../auth/api';
import { createEncryptedMedia } from './encrypted-media.ts';
import { createCircleMediaUpload, type MediaUploadVault } from './upload.ts';

type Ports = Pick<Parameters<typeof createEncryptedMedia>[0], 'codec' | 'objectId'> & {
  session(): Session; ready(): boolean; fingerprint(session: Session, circleId: string): Promise<string>;
  vault(fingerprint: string): MediaUploadVault;
  storage(circleId: string, epoch: number): Parameters<typeof createEncryptedMedia>[0]['storage'];
};
export async function openAccountCircleMediaUpload(ports: Ports, circleId: string) {
  const session = ports.session(), bound = JSON.stringify([session.account.id, session.deviceId, session.generation, session.accessToken]);
  function check() {
    const current = ports.session();
    if (!ports.ready() || JSON.stringify([current.account.id, current.deviceId, current.generation, current.accessToken]) !== bound) throw new Error('SESSION_CHANGED');
  }
  check(); const fingerprint = await ports.fingerprint(session, circleId); check();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('INVALID_INPUT');
  const vault = ports.vault(fingerprint);
  return createCircleMediaUpload({
    account() { check(); return { id: session.account.id, binding: fingerprint }; }, operation: ports.objectId, vault,
    media: epoch => createEncryptedMedia({ codec: ports.codec, objectId: ports.objectId, storage: ports.storage(circleId, epoch), binding() { check(); return fingerprint; } }),
  }, circleId);
}
