export function availableStickerPacks(items: readonly { artwork: { pack: string } }[]): string[] {
  return [...new Set(items.map(item => item.artwork.pack.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
