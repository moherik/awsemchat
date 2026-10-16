export type NativeStickerRoute = 'maker' | 'personal-library' | 'circle-library' | 'unavailable';

export function resolveNativeStickerRoute(mode: string, circle: string | undefined): NativeStickerRoute {
  if (mode === 'maker') return 'maker';
  if (mode === 'circle') return circle ? 'circle-library' : 'unavailable';
  return 'personal-library';
}
