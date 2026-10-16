import type { Gif } from './client';
export async function sendEncryptedGif(input: { client: { download(gif: Gif): Promise<Uint8Array> }; gif: Gif; editor: { sendPhoto(input: { bytes: Uint8Array; mimeType: string; caption: string }): Promise<unknown> }; caption: string }) {
  const bytes = await input.client.download(input.gif);
  return input.editor.sendPhoto({ bytes, mimeType: 'image/gif', caption: input.caption.trim() });
}
