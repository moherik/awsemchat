import type { Session } from '../auth/api';
import { createCircleCreation, type CircleCreationVault } from './circle-creation.ts';

type Ports = Omit<Parameters<typeof createCircleCreation>[0], 'binding' | 'vault'> & {
  session(): Session;
  ready(): boolean;
  fingerprint(session: Session): Promise<string>;
  vault(fingerprint: string): CircleCreationVault;
};
export async function openAccountCircleCreation(ports: Ports) {
  const session = ports.session();
  const bound = JSON.stringify([session.account.id, session.deviceId, session.generation, session.accessToken]);
  function check() {
    const current = ports.session();
    if (!ports.ready() || JSON.stringify([current.account.id, current.deviceId, current.generation, current.accessToken]) !== bound) {
      throw new Error('SESSION_CHANGED');
    }
  }
  check();
  const fingerprint = await ports.fingerprint(session);
  check();
  const vault = ports.vault(fingerprint);
  return createCircleCreation({ ...ports, vault, binding() { check(); return fingerprint; } });
}
