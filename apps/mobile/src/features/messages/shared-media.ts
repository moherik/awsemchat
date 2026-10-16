import type { HistorySnapshot } from './history-store';
import { conversationMessages } from './conversation-view.ts';
import { selectPrivateMoments } from './private-moments.ts';
import { selectCircleMoments } from './circle-moments.ts';
import type { MediaDescriptor } from '../media/encrypted-media';

export type SharedMediaItem = Readonly<{
  key: string;
  kind: 'photo' | 'gif' | 'moment';
  caption: string;
  media: MediaDescriptor;
  epoch?: number;
  sequence?: number;
}>;

export function selectPrivateSharedMedia(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, conversation: string, audience: string): readonly SharedMediaItem[] {
  const items: SharedMediaItem[] = conversationMessages(history, conversation)
    .flatMap(item => item.privatePhotoMessage
      ? [{ key: `photo:${item.operation}`, kind: item.privatePhotoMessage.media.mimeType === 'image/gif' ? 'gif' as const : 'photo' as const, caption: item.privatePhotoMessage.caption, media: item.privatePhotoMessage.media, sequence: item.sequence }]
      : []);
  for (const item of selectPrivateMoments(history, conversation, audience)) {
    if (item.media) items.push({ key: `moment:${item.operation}`, kind: 'moment', caption: item.caption, media: item.media, sequence: item.sequence });
  }
  return Object.freeze(items.sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0)));
}

export function selectCircleSharedMedia(history: Pick<HistorySnapshot, 'incoming' | 'outgoing'>, circle: string): readonly SharedMediaItem[] {
  const items: SharedMediaItem[] = conversationMessages(history, circle)
    .flatMap(item => item.photoMessage
      ? [{ key: `photo:${item.operation}`, kind: item.photoMessage.image.media.mimeType === 'image/gif' ? 'gif' as const : 'photo' as const, caption: item.photoMessage.caption, media: item.photoMessage.image.media, epoch: item.photoMessage.image.epoch, sequence: item.sequence }]
      : []);
  for (const item of selectCircleMoments(history, circle)) {
    if (item.media) items.push({ key: `moment:${item.operation}`, kind: 'moment', caption: item.caption, media: item.media.media, epoch: item.media.epoch, sequence: item.sequence });
  }
  return Object.freeze(items.sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0)));
}
