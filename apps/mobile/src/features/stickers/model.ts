export type StickerTextBox = { id: string; text: string; x: number; y: number; color: string; size: number };
export type StickerArtwork = {
  textBoxes?: StickerTextBox[];
  image: string;
  title: string;
  text: string;
  textColor: string;
  textSize: number;
  textY: number;
  background: string | null;
  pack: string;
};
export function makeStickerMessage(artwork: StickerArtwork) {
  return { text: artwork.title, own: true, image: artwork.image, sticker: true, stickerArtwork: copySticker(artwork, artwork.pack) };
}
export function copySticker(artwork: StickerArtwork, pack: string): StickerArtwork {
  return { ...artwork, pack, textBoxes: artwork.textBoxes?.map(box => ({ ...box })) };
}
export const starterStickers: Record<string, StickerArtwork> = Object.fromEntries([
  ['Coffee break', '2615'], ['Big hug', '1f43b'], ['Love it', '2764'], ['Hello!', '1f44b'], ['Weekend mood', '1f973'], ['For you', '1f33b'],
].map(([title, code]) => [title, { image: `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`, title, text: '', textColor: '#FFFFFF', textSize: 26, textY: 72, background: null, pack: 'Everyday' }]));
export function uniqueStickerKey() { return `made-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
