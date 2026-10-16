export function photoExtension(uri: string): string {
  const dataMime = uri.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,/i)?.[1];
  const path = dataMime ? '' : uri.split(/[?#]/, 1)[0];
  const mimeExtension = dataMime?.slice('image/'.length).toLowerCase();
  const extension = mimeExtension ?? path.match(/\.(png|gif|webp|jpe?g)$/i)?.[1]?.toLowerCase();
  if (!extension) return 'jpg';
  return extension === 'jpeg' ? 'jpg' : extension;
}
