import { useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const subscribe = () => () => {};
export function FeedbackOverlay({ children }: { children: ReactNode; sheet: boolean }) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  if (!ready) return null;
  return createPortal(<div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', pointerEvents: 'none', zIndex: 10000 }}>{children}</div>, document.body);
}
