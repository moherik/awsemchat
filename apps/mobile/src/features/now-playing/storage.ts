export function nativeNowPlayingStorage(_fingerprint: string) {
  return { read: async () => false, write: async (_value: boolean) => undefined };
}
