import { Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import type { StickerArtwork } from '../stickers/model';
import { Artwork } from '../stickers/artwork';
import { usePalette } from '../ui';
export type ReplyContext = { kind: 'message' | 'moment'; index: number; author: string; text: string; image?: string; stickerArtwork?: StickerArtwork; deleted?: boolean };
export function ReplyCard({ reply, onPress }: { reply: ReplyContext; onPress?: () => void }) {
  const c = usePalette();
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? `Open replied ${reply.kind}` : undefined} onPress={onPress ? event => { event.stopPropagation(); onPress(); } : undefined} style={{ flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderLeftWidth: 3, borderColor: c.accent, backgroundColor: c.bg, borderRadius: 4, minHeight: 58 }}><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.accent, fontSize: 12, fontWeight: '600', marginBottom: 3 }}>{reply.kind === 'moment' ? 'Moment · ' : ''}{reply.author}</Text><Text numberOfLines={2} style={{ color: c.muted, fontSize: 13, lineHeight: 18 }}>{reply.deleted ? 'This Moment was deleted' : reply.text || (reply.stickerArtwork ? 'Sticker' : reply.image ? 'Photo' : 'Message')}</Text></View>{!reply.deleted && (reply.stickerArtwork ? <Artwork artwork={reply.stickerArtwork} size={44} /> : reply.image ? <Image source={{ uri: reply.image }} contentFit="cover" style={{ width: 44, height: 44, borderRadius: 4 }} /> : null)}</Pressable>;
}
