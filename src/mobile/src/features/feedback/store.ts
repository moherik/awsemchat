export type Feedback = { id: number; message: string; duration: number };
const listeners = new Set<() => void>();
let feedback: Feedback | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
let surfaces: string[] = [];
let snapshot = { feedback, surface: 'root' } as { feedback: Feedback | null; surface: string };
const serverSnapshot = { feedback: null, surface: 'root' };
function publish() { snapshot = { feedback, surface: surfaces.at(-1) ?? 'root' }; listeners.forEach(fn => fn()); }
export const feedbackStore = {
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => serverSnapshot,
};
export function dismissFeedback(id?: number) {
  if (id !== undefined && feedback?.id !== id) return;
  clearTimeout(timer); feedback = null; publish();
}
export function showFeedback(message: string, duration = message.length > 110 ? 10000 : 6000): number {
  if (!message.trim()) return 0;
  clearTimeout(timer);
  const id = ++sequence;
  feedback = { id, message, duration }; publish();
  if (duration > 0) timer = setTimeout(() => dismissFeedback(id), duration);
  return id;
}
export function registerFeedbackSurface(id: string) {
  surfaces = [...surfaces.filter(value => value !== id), id]; publish();
  return () => { surfaces = surfaces.filter(value => value !== id); publish(); };
}
