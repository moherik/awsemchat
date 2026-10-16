import type { Page, Summary } from './api';
type Ports = { binding(): string; page(cursor: string, limit: number): Promise<Page<Pick<Summary, 'id' | 'role'>>>; share(circleId: string): Promise<void> };
export function createCircleProfileFanout(ports: Ports) {
  let cursor = '', owner: string | undefined, active: Promise<void> | undefined;
  async function scan() {
    const bound = ports.binding();
    if (bound !== owner) { owner = bound; cursor = ''; }
    const check = () => { if (ports.binding() !== bound) throw new Error('SESSION_CHANGED'); };
    const page = await ports.page(cursor, 5); check();
    for (const circle of page.items) {
      check(); if (circle.role !== 'admin') continue;
      try { await ports.share(circle.id); } catch { check(); }
      check();
    }
    cursor = page.nextCursor ?? '';
  }
  return { run(): Promise<void> { if (!active) active = scan().finally(() => { active = undefined; }); return active; } };
}
