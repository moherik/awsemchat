import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import type { StickerArtwork } from './model';

export function Artwork({ artwork, size = 100 }: { artwork: StickerArtwork; size?: number }) {
  return <View style={{ width: size, height: size, backgroundColor: artwork.background ?? 'transparent', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
    <Image source={{ uri: artwork.image.includes("twitter/twemoji@14.0.2/assets/72x72/") ? artwork.image.replace("assets/72x72/", "assets/svg/").replace(".png", ".svg") : artwork.image }} contentFit="contain" style={{ width: size * .82, height: size * .82 }} />
    {!artwork.textBoxes && artwork.text !== '' && <Text numberOfLines={2} style={{ position: 'absolute', top: `${Math.min(artwork.textY, 60)}%`, width: '94%', textAlign: 'center', color: artwork.textColor, fontSize: Math.max(10, artwork.textSize * size / 280), fontWeight: '800', textShadowColor: '#000000', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>{artwork.text}</Text>}
    {artwork.textBoxes?.map(box => <Text key={box.id} numberOfLines={2} style={{ position: 'absolute', left: box.x * size, top: box.y * size, width: size * .7, padding: 5 * size / 280, textAlign: 'center', color: box.color, fontSize: box.size * size / 280, lineHeight: box.size * 1.15 * size / 280, fontWeight: '800', textShadowColor: '#000', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } }}>{box.text}</Text>)}
  </View>;
}
