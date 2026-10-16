import type { AppearanceSnapshot, AppearanceTheme } from './appearance-store';

const snapshot: AppearanceSnapshot = Object.freeze({ phase: 'ready', theme: 'system' });
export function useDeviceAppearance() {
  return { ...snapshot, load: async () => undefined, setTheme: async (_theme: AppearanceTheme) => undefined };
}
