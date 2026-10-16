import { useDeviceAppearance } from './appearance-runtime';

export function usePalettePreference() {
  return useDeviceAppearance().theme;
}
