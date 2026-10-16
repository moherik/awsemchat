export type NowPlayingTrack = Readonly<{ title: string; artist: string }>;
export type NativeNowPlaying = {
  hasNotificationAccess(): Promise<boolean>;
  openNotificationAccessSettings(): Promise<void>;
  getActiveTrack(): Promise<unknown>;
};

function parseTrack(value: unknown): NowPlayingTrack | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.title !== 'string' || typeof data.artist !== 'string') return null;
  const title = data.title.trim(), artist = data.artist.trim();
  if (!title || !artist || title.length > 160 || artist.length > 120 || /[\u0000-\u001f\u007f]/.test(title + artist)) return null;
  return Object.freeze({ title, artist });
}

export function createNowPlayingBridge(native: NativeNowPlaying, platform: string) {
  function supported() { if (platform !== 'android') throw new Error('UNSUPPORTED_PLATFORM'); }
  return Object.freeze({
    async hasNotificationAccess() { supported(); return native.hasNotificationAccess(); },
    async openNotificationAccessSettings() { supported(); await native.openNotificationAccessSettings(); },
    async activeTrack() { supported(); return parseTrack(await native.getActiveTrack()); },
  });
}
