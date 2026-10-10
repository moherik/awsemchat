export async function downloadPhoto(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Download failed');
  const blob = await response.blob(); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `AwsemChat-${Date.now()}.${blob.type.includes('gif') ? 'gif' : blob.type.includes('jpeg') ? 'jpg' : 'png'}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
