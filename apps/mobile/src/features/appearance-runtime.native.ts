import { useEffect, useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createAppearanceStore } from './appearance-store';

const key = 'settings.appearance.theme';
const store = createAppearanceStore({
  get: () => SecureStore.getItemAsync(key),
  set: value => SecureStore.setItemAsync(key, value),
});
export function useDeviceAppearance() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { void store.load().catch(() => undefined); }, []);
  return { ...snapshot, load: store.load, setTheme: store.setTheme };
}
