export type PhotoFilter = 'Original' | 'Mono' | 'Warm' | 'Cool' | 'Vivid';
export function filterPixels(source: Uint8Array, filter: PhotoFilter) {
  const pixels = source.slice();
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  for (let i = 0; i < pixels.length; i += 4) {
    const r = source[i], g = source[i + 1], b = source[i + 2];
    const gray = .299 * r + .587 * g + .114 * b;
    if (filter === 'Mono') pixels[i] = pixels[i + 1] = pixels[i + 2] = clamp(gray);
    if (filter === 'Warm') { pixels[i] = clamp(r * 1.08 + 8); pixels[i + 1] = clamp(g * 1.02); pixels[i + 2] = clamp(b * .88); }
    if (filter === 'Cool') { pixels[i] = clamp(r * .9); pixels[i + 1] = clamp(g * 1.02); pixels[i + 2] = clamp(b * 1.08 + 8); }
    if (filter === 'Vivid') { pixels[i] = clamp(gray + (r - gray) * 1.3); pixels[i + 1] = clamp(gray + (g - gray) * 1.3); pixels[i + 2] = clamp(gray + (b - gray) * 1.3); }
  }
  return pixels;
}
