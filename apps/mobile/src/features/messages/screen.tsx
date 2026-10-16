import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image as ExpoImage } from 'expo-image';
import { File } from 'expo-file-system';
import { fromByteArray, toByteArray } from 'base64-js';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { showFeedback } from '../feedback/snackbar';
import { createComposer } from './composer';
import { IdentityPanel } from './identity-panel';
import type { ConversationContext } from './api';
import type { Membership } from '../social/api';
import { selectCircleProfile } from '../social/circle-profile';
import { selectCircleMemberProfile } from '../social/circle-member-profile';
import { selectPrivateProfile } from '../social/private-profile';
import type { PeerKeys } from '../../security/durable-encryption';
import { CircleAvatarView } from '../social/circle-avatar-view';
import { PrivateProfileAvatar } from '../social/private-profile-avatar';
import { PhotoViewer } from '../photos/viewer';
import type { ViewedPhoto } from '../photos/viewer';
import { PhotoEditor, type EditablePhoto } from '../photos/editor';
import { PopupMenu } from '../popup-menu.native';
import { chatDestination, circleSender, validChatDestination } from './chat-destination';
import { conversationMessages, conversationTitle, type ConversationMessage } from './conversation-view';
import { encodeCircleStickerMessage } from './circle-sticker-message';
import type { PrivateStickerMessage } from './private-sticker-message';
import { selectCircleMoments, type CircleMoment, type CircleMomentEntry } from './circle-moments';
import { circleMomentReactionEmojis, selectCircleMomentReactions, type CircleMomentReactionEmoji } from './circle-moment-reactions';
import type { CollectionItem, CollectionSelection } from '../social/circle-collection';
import type { PersonalSticker } from '../stickers/personal-stickers';
import { decodeEditedPhotoDataUri } from './circle-photo-data';
import { selectPrivateMoments, selectPrivateMomentReactions, type PrivateMomentEntry, type PrivateMomentEmoji } from './private-moments';
import { createPingAlertGate, encodePing, encodePong } from './ping-pong';
import type { ConversationPreferences } from './conversation-preferences';
import { createGiphyClient, type Gif } from '../giphy/client';
import { sendEncryptedGif } from '../giphy/send';
import { gifFavorites } from '../giphy/favorites.native';
import { GiphyPicker } from '../giphy/picker';
import { selectNowPlaying } from '../now-playing/payload';
import { ScrollingStatus } from '../scrolling-status';
const noop = () => () => {};
const signedOut = Object.freeze({ status: 'signed-out' as const });
const notReady = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
const emptyPreferences = Object.freeze({ phase: 'idle' as const, values: Object.freeze({}) as ConversationPreferences });
const getEmptyPreferences = () => emptyPreferences;
async function prepareCirclePhoto(photo: EditablePhoto) {
  if (photo.uri.startsWith('data:')) {
    const decoded = decodeEditedPhotoDataUri(photo.uri);
    if (!decoded) throw new Error('INVALID_MEDIA');
    return { ...decoded, dispose() {} };
  }
  const ratio = Math.min(1, 1600 / Math.max(photo.width, photo.height));
  const image = ImageManipulator.manipulate(photo.uri);
  if (ratio < 1) image.resize({ width: Math.max(1, Math.round(photo.width * ratio)), height: Math.max(1, Math.round(photo.height * ratio)) });
  const rendered = await image.renderAsync();
  const prepared = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: .82, base64: true });
  if (!prepared.base64) { const file = new File(prepared.uri); if (file.exists) file.delete(); throw new Error('INVALID_MEDIA'); }
  return { bytes: toByteArray(prepared.base64), mimeType: 'image/jpeg', dispose() { const file = new File(prepared.uri); if (file.exists) file.delete(); } };
}
function CircleStickerImage({ runtime, circle, item, selectable, onSelect }: { runtime: AuthenticationRuntime; circle: string; item: CollectionItem; selectable?: boolean; onSelect?: (item: CollectionItem) => void }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void runtime.circleAvatarBytes(circle, item.image).then(bytes => {
      if (active) setURI(`data:${item.image.media.mimeType};base64,${fromByteArray(bytes)}`);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [runtime, circle, item]);
  const content = uri ? <Image source={{ uri }} resizeMode="contain" style={{ width: 96, height: 96 }} /> : <Text style={{ color: c.muted, fontSize: 13 }}>{failed ? 'Preview unavailable' : item.label}</Text>;
  return selectable ? <Pressable accessibilityRole="button" accessibilityLabel={`Send sticker ${item.label}`} disabled={!uri} onPress={() => onSelect?.(item)} style={{ width: '33.333%', minHeight: 128, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }}>{content}<Text numberOfLines={1} style={{ color: c.text, fontSize: 12 }}>{item.label}</Text></Pressable> : <View style={{ minWidth: 112, minHeight: 112, borderRadius: 12, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>{content}</View>;
}
function CircleMomentPhoto({ runtime, circle, media, caption, compact = false, kind = 'Moment' }: { runtime: AuthenticationRuntime; circle: string; media: NonNullable<CircleMoment['media']>; caption: string; compact?: boolean; kind?: 'Moment' | 'Chat' }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [failed, setFailed] = useState(false); const [viewedPhoto, setViewedPhoto] = useState<ViewedPhoto>();
  useEffect(() => {
    let active = true;
    void runtime.circleAvatarBytes(circle, media).then(bytes => { if (active) setURI(`data:${media.media.mimeType};base64,${fromByteArray(bytes)}`); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [runtime, circle, media]);
  const image = uri ? <ExpoImage accessibilityLabel={caption ? `${kind} photo: ${caption}` : `${kind} photo`} source={{ uri }} contentFit="cover" style={{ width: '100%', height: compact ? 76 : 240, borderRadius: 10, backgroundColor: c.bg }} /> : <View accessibilityLabel={failed ? `${kind} photo unavailable` : `Loading ${kind} photo`} style={{ minHeight: compact ? 60 : 120, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderRadius: 10 }}><Text style={{ color: c.muted }}>{failed ? 'Photo unavailable' : 'Loading photo…'}</Text></View>;
  return <>{uri && !compact ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${kind.toLowerCase()} photo full screen`} onPress={() => setViewedPhoto({ uri, caption: caption || undefined, title: `${kind} photo` })}>{image}</Pressable> : image}{viewedPhoto && <PhotoViewer photo={viewedPhoto} onClose={() => setViewedPhoto(undefined)} />}</>;
}
function PrivateMomentPhoto({ runtime, peer, media, caption, compact = false }: { runtime: AuthenticationRuntime; peer: string; media: import('../media/encrypted-media').MediaDescriptor; caption: string; compact?: boolean }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [failed, setFailed] = useState(false); const [viewedPhoto, setViewedPhoto] = useState<ViewedPhoto>();
  useEffect(() => { let active = true; void runtime.privateMomentEditor(peer).then(editor => editor.download(media)).then(bytes => { if (active) setURI(`data:${media.mimeType};base64,${fromByteArray(bytes)}`); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [runtime, peer, media]);
  const image = uri ? <ExpoImage accessibilityLabel={caption ? `Moment photo: ${caption}` : 'Moment photo'} source={{ uri }} contentFit="cover" style={{ width: '100%', height: compact ? 76 : 240, borderRadius: 10, backgroundColor: c.bg }} /> : <View accessibilityLabel={failed ? 'Moment photo unavailable' : 'Loading Moment photo'} style={{ minHeight: compact ? 60 : 120, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderRadius: 10 }}><Text style={{ color: c.muted }}>{failed ? 'Photo unavailable' : 'Loading photo…'}</Text></View>;
  return <>{uri && !compact ? <Pressable accessibilityRole="button" accessibilityLabel="Open Moment photo full screen" onPress={() => setViewedPhoto({ uri, caption: caption || undefined, title: 'Moment photo' })}>{image}</Pressable> : image}{viewedPhoto && <PhotoViewer photo={viewedPhoto} onClose={() => setViewedPhoto(undefined)} />}</>;
}
function PrivateChatPhoto({ runtime, peer, media, caption, compact = false }: { runtime: AuthenticationRuntime; peer: string; media: import('../media/encrypted-media').MediaDescriptor; caption: string; compact?: boolean }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [failed, setFailed] = useState(false); const [viewedPhoto, setViewedPhoto] = useState<ViewedPhoto>();
  useEffect(() => { let active = true; void runtime.privatePhotoEditor(peer).then(editor => editor.download(media)).then(bytes => { if (active) setURI(`data:${media.mimeType};base64,${fromByteArray(bytes)}`); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [runtime, peer, media]);
  const image = uri ? <ExpoImage accessibilityLabel={caption ? `Chat photo: ${caption}` : 'Chat photo'} source={{ uri }} contentFit="cover" style={{ width: '100%', height: compact ? 76 : 240, borderRadius: 10, backgroundColor: c.bg }} /> : <View accessibilityLabel={failed ? 'Chat photo unavailable' : 'Loading chat photo'} style={{ minHeight: compact ? 60 : 120, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, borderRadius: 10 }}><Text style={{ color: c.muted }}>{failed ? 'Photo unavailable' : 'Loading photo…'}</Text></View>;
  return <>{uri && !compact ? <Pressable accessibilityRole="button" accessibilityLabel="Open chat photo full screen" onPress={() => setViewedPhoto({ uri, caption: caption || undefined, title: 'Chat photo' })}>{image}</Pressable> : image}{viewedPhoto && <PhotoViewer photo={viewedPhoto} onClose={() => setViewedPhoto(undefined)} />}</>;
}
function PrivateChatSticker({ runtime, peer, message }: { runtime: AuthenticationRuntime; peer: string; message: PrivateStickerMessage }) {
  const c = usePalette(); const [uri, setURI] = useState<string>(); const [failed, setFailed] = useState(false); const [viewedPhoto, setViewedPhoto] = useState<ViewedPhoto>();
  useEffect(() => { let active = true; void runtime.privatePhotoEditor(peer).then(editor => editor.download(message.media)).then(bytes => { if (active) setURI(`data:${message.media.mimeType};base64,${fromByteArray(bytes)}`); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [runtime, peer, message]);
  const image = uri ? <Image accessibilityLabel={`Sticker: ${message.label}`} source={{ uri }} resizeMode="contain" style={{ width: 132, height: 132 }} /> : <View accessibilityLabel={failed ? 'Sticker unavailable' : 'Loading sticker'} style={{ width: 132, height: 92, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.muted }}>{failed ? 'Sticker unavailable' : 'Loading sticker…'}</Text></View>;
  return <View style={{ alignItems: 'flex-start', gap: 2 }}>{uri ? <Pressable accessibilityRole="button" accessibilityLabel={`Open sticker ${message.label} full screen`} onPress={() => setViewedPhoto({ uri, title: message.label })}>{image}</Pressable> : image}<Text numberOfLines={1} style={{ color: c.muted, fontSize: 12 }}>{message.label}</Text>{viewedPhoto && <PhotoViewer photo={viewedPhoto} onClose={() => setViewedPhoto(undefined)} />}</View>;
}
function PersonalStickerTile({ item, busy, onSelect }: { item: PersonalSticker; busy: boolean; onSelect: (item: PersonalSticker) => void }) {
  const c = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={`Send personal sticker ${item.artwork.title}`} disabled={busy} onPress={() => onSelect(item)} style={{ width: '33.333%', minHeight: 128, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }}><Image source={{ uri: item.artwork.image }} resizeMode="contain" style={{ width: 96, height: 96 }} /><Text numberOfLines={1} style={{ color: c.text, fontSize: 12 }}>{item.artwork.title}</Text></Pressable>;
}
function CircleStickerPicker({ open, runtime, circle, busy, onClose, onSelect }: { open: boolean; runtime: AuthenticationRuntime; circle: string; busy: boolean; onClose: () => void; onSelect: (item: PersonalSticker | CollectionItem, source: 'personal' | 'circle') => void }) {
  const c = usePalette(); const [tab, setTab] = useState<'personal' | 'circle'>('personal'); const [result, setResult] = useState<{ key: string; selection?: CollectionSelection; personal?: readonly PersonalSticker[]; collectionFailed?: boolean; personalFailed?: boolean }>(); const [attempt, setAttempt] = useState(0);
  const requestKey = `${circle}:${attempt}`, current = result?.key === requestKey ? result : undefined;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.allSettled([runtime.circleCollection(circle), runtime.personalStickers().then(store => store.list())]).then(([collection, personal]) => {
      if (!active) return;
      setResult({ key: requestKey,
        ...(collection.status === 'fulfilled' ? { selection: collection.value } : { collectionFailed: true }),
        ...(personal.status === 'fulfilled' ? { personal: personal.value } : { personalFailed: true }),
      });
    });
    return () => { active = false; };
  }, [open, runtime, circle, requestKey]);
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' }}><View style={{ maxHeight: '72%', minHeight: 240, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: c.surface, paddingBottom: 24 }}>
      <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: .5, borderColor: c.line }}><Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '600' }}>Stickers</Text><Pressable accessibilityRole="button" accessibilityLabel="Close stickers" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={24} color={c.text} /></Pressable></View>
      <View accessibilityRole="tablist" style={{ minHeight: 52, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: .5, borderColor: c.line }}>
        {(['personal', 'circle'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={{ minHeight: 36, minWidth: 92, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === value ? c.accent : c.bg }}><Text style={{ color: tab === value ? '#FFFFFF' : c.text, fontSize: 14, fontWeight: '600' }}>{value === 'personal' ? 'Personal' : 'Circle'}</Text></Pressable>)}
      </View>
      {busy || !current ? <ActivityIndicator accessibilityLabel={`Loading ${tab} stickers`} style={{ marginTop: 28 }} color={c.accent} /> : tab === 'personal' ? current.personalFailed ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ padding: 24 }}><Text style={{ color: c.accent }}>Could not load your personal stickers. Tap to try again.</Text></Pressable> : <FlatList data={current.personal ?? []} keyExtractor={item => item.id} numColumns={3} contentContainerStyle={{ padding: 8 }} renderItem={({ item }) => <PersonalStickerTile item={item} busy={busy} onSelect={value => onSelect(value, 'personal')} />} ListEmptyComponent={<Text style={{ color: c.muted, padding: 20 }}>No personal stickers yet. Make one in Sticker Maker to keep it here.</Text>} /> : current.collectionFailed ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ padding: 24 }}><Text style={{ color: c.accent }}>Could not load Circle stickers. Tap to try again.</Text></Pressable> : current.selection?.state !== 'ready' ? <Text style={{ color: c.muted, padding: 24 }}>The shared stickers need to be refreshed before they can be sent.</Text> : <FlatList data={current.selection.items.filter(item => item.kind === 'sticker')} keyExtractor={item => item.id} numColumns={3} contentContainerStyle={{ padding: 8 }} renderItem={({ item }) => <CircleStickerImage runtime={runtime} circle={circle} item={item} selectable onSelect={value => onSelect(value, 'circle')} />} ListEmptyComponent={<Text style={{ color: c.muted, padding: 20 }}>No stickers have been shared with this Circle yet.</Text>} />}
    </View></View>
  </Modal>;
}
function PrivateStickerPicker({ open, runtime, busy, onClose, onSelect }: { open: boolean; runtime: AuthenticationRuntime; busy: boolean; onClose: () => void; onSelect: (item: PersonalSticker) => void }) {
  const c = usePalette(); const [result, setResult] = useState<{ attempt: number; items?: readonly PersonalSticker[]; failed?: boolean }>(); const [attempt, setAttempt] = useState(0);
  const current = result?.attempt === attempt ? result : undefined;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void runtime.personalStickers().then(store => store.list()).then(items => { if (active) setResult({ attempt, items }); }, () => { if (active) setResult({ attempt, failed: true }); });
    return () => { active = false; };
  }, [open, runtime, attempt]);
  return <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' }}><View style={{ maxHeight: '72%', minHeight: 240, borderTopLeftRadius: 18, borderTopRightRadius: 18, backgroundColor: c.surface, paddingBottom: 24 }}>
      <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: .5, borderColor: c.line }}><Text style={{ flex: 1, color: c.text, fontSize: 18, fontWeight: '600' }}>Personal stickers</Text><Pressable accessibilityRole="button" accessibilityLabel="Close stickers" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={24} color={c.text} /></Pressable></View>
      {busy || !current ? <ActivityIndicator accessibilityLabel="Loading personal stickers" style={{ marginTop: 28 }} color={c.accent} /> : current.failed ? <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ padding: 24 }}><Text style={{ color: c.accent }}>Could not load your personal stickers. Tap to try again.</Text></Pressable> : <FlatList data={current.items ?? []} keyExtractor={item => item.id} numColumns={3} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 8 }} renderItem={({ item }) => <PersonalStickerTile item={item} busy={busy} onSelect={onSelect} />} ListEmptyComponent={<Text style={{ color: c.muted, padding: 20 }}>No personal stickers yet. Make one in Sticker Maker to keep it here.</Text>} />}
    </View></View>
  </Modal>;
}
function feedback(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  showFeedback(code === 'IDENTITY_CHANGED' ? 'Your friend’s security identity changed. Review it before sending.' : code === 'DENIED' ? 'This conversation is no longer available.' : code === 'SESSION_REVOKED' ? 'Your session ended. Sign in again.' : code === 'DELETION_PENDING' ? 'Delete request saved. It will finish when you are back online.' : 'Could not finish. Your saved messages are kept for retry.');
}
export function ProductionChat({ peer, circle }: { peer?: string; circle?: string }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { let active = true; void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); }); return () => { active = false; }; }, [attempt]);
  const account = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => signedOut), () => signedOut);
  const login = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => notReady), () => notReady);
  if (!validChatDestination(peer, circle)) return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface, padding: 18 }}><Text style={{ color: c.text }}>This conversation link is invalid.</Text><Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Back to chats</Text></Pressable></SafeAreaView>;
  if (runtime && account.status === 'ready' && login.phase === 'ready') return <ReadyChat key={`${account.account?.id}:${account.generation}:${peer ?? circle}`} runtime={runtime} peer={peer} circle={circle} />;
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface, padding: 18, gap: 16 }}><Text style={{ fontSize: 20, fontWeight: '600', color: c.text }}>{circle ? 'Circle' : 'Private chat'}</Text>{!runtime && !failed ? <ActivityIndicator accessibilityLabel="Opening chat" color={c.accent} /> : <><Text style={{ color: c.muted }}>{failed ? 'Could not open your account.' : 'Sign in to open your private conversations.'}</Text><Pressable accessibilityRole="button" onPress={() => failed ? (setFailed(false), setAttempt(value => value + 1)) : router.push('/auth')} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>{failed ? 'Retry' : 'Sign in'}</Text></Pressable></>}<Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Back</Text></Pressable></SafeAreaView>;
}
export function ReadyChat({ runtime, peer, circle }: { runtime: AuthenticationRuntime; peer?: string; circle?: string }) {
  const c = usePalette();
  const destination = useMemo(() => chatDestination(peer, circle), [peer, circle]);
  const [context, setContext] = useState<ConversationContext>();
  const [members, setMembers] = useState<Membership[]>([]);
  const [conversation, setConversation] = useState<string>(), [failed, setFailed] = useState(false), [attempt, setAttempt] = useState(0);
  const [olderPage, setOlderPage] = useState<{ conversation: string; more: boolean; loading: boolean; error: boolean }>();
  const historyPagerRef = useRef<{ conversation: string; pager: ReturnType<AuthenticationRuntime['historyPager']> } | undefined>(undefined);
  const [stickerPicker, setStickerPicker] = useState(false), [stickerBusy, setStickerBusy] = useState(false);
  const [gifPicker, setGifPicker] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(() => new Set());
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(() => new Set());
  const [loadedPreferences, setLoadedPreferences] = useState<{ conversation: string; store: Awaited<ReturnType<AuthenticationRuntime['conversationPreferences']>> }>();
  const [pendingPing, setPendingPing] = useState<{ conversation: string; operation: string }>();
  const pendingPingRef = useRef<{ conversation: string; operation: string } | undefined>(undefined);
  const [sendingPing, setSendingPing] = useState(false);
  const pendingPongOperations = useRef(new Map<string, string>());
  const [sendingPongs, setSendingPongs] = useState<Set<string>>(() => new Set());
  const [answeredPings, setAnsweredPings] = useState<Set<string>>(() => new Set());
  const [highlightedPingId, setHighlightedPingId] = useState<string>();
  const pingAlertGate = useRef(createPingAlertGate());
  const seenIncomingPings = useRef(new Map<string, Set<string>>());
  const pingHighlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [section, setSection] = useState<'chat' | 'moments'>('chat');
  const [momentCaption, setMomentCaption] = useState(''), [postingMoment, setPostingMoment] = useState(false);
  const [momentPhoto, setMomentPhoto] = useState<{ uri: string; width: number; height: number }>();
  const [momentEditor, setMomentEditor] = useState<Awaited<ReturnType<AuthenticationRuntime['circleMomentEditor']>>>();
  const [privateEditor, setPrivateEditor] = useState<Awaited<ReturnType<AuthenticationRuntime['privateMomentEditor']>>>();
  const [privatePhotoEditor, setPrivatePhotoEditor] = useState<Awaited<ReturnType<AuthenticationRuntime['privatePhotoEditor']>>>();
  const [pendingPrivateChatPhoto, setPendingPrivateChatPhoto] = useState<Awaited<ReturnType<NonNullable<typeof privatePhotoEditor>['pending']>>>();
  const [pendingPrivateChatSticker, setPendingPrivateChatSticker] = useState<Awaited<ReturnType<NonNullable<typeof privatePhotoEditor>['pending']>>>();
  const [privatePending, setPrivatePending] = useState<Awaited<ReturnType<NonNullable<typeof privateEditor>['pending']>>>();
  const [photoEditor, setPhotoEditor] = useState<Awaited<ReturnType<AuthenticationRuntime['circlePhotoEditor']>>>();
  const [stickerSender, setStickerSender] = useState<Awaited<ReturnType<AuthenticationRuntime['circleStickerSender']>>>();
  const [chatPhoto, setChatPhoto] = useState<{ uri: string; width: number; height: number }>();
  const [photoEditorDraft, setPhotoEditorDraft] = useState<{ destination: 'chat' | 'moment'; photo: EditablePhoto }>();
  const [pendingChatPhoto, setPendingChatPhoto] = useState<Awaited<ReturnType<NonNullable<typeof photoEditor>['pending']>>>();
  const [pendingChatSticker, setPendingChatSticker] = useState<Awaited<ReturnType<NonNullable<typeof stickerSender>['pending']>>>();
  const [sendingPhoto, setSendingPhoto] = useState(false);
  const giphyKey = Platform.OS === 'android' ? process.env.EXPO_PUBLIC_GIPHY_ANDROID_KEY : process.env.EXPO_PUBLIC_GIPHY_IOS_KEY;
  const giphyClient = useMemo(() => giphyKey ? createGiphyClient({ apiKey: giphyKey }) : undefined, [giphyKey]);
  const [reactingMoment, setReactingMoment] = useState<string>();
  const [replyMoment, setReplyMoment] = useState<CircleMomentEntry | PrivateMomentEntry>();
  const replyMomentRef = useRef<CircleMomentEntry | PrivateMomentEntry | undefined>(undefined);
  const momentPublisherRef = useRef<ReturnType<AuthenticationRuntime['circleMomentPublisher']> | ReturnType<AuthenticationRuntime['privateMomentPublisher']> | undefined>(undefined);
  const momentListRef = useRef<FlatList<CircleMomentEntry>>(null);
  const privateMomentListRef = useRef<FlatList<PrivateMomentEntry>>(null);
  useEffect(() => { replyMomentRef.current = replyMoment; }, [replyMoment]);
  const [pendingMoment, setPendingMoment] = useState<CircleMoment>();
  const [pendingMomentRecovery, setPendingMomentRecovery] = useState<Awaited<ReturnType<NonNullable<typeof momentEditor>['pending']>>>();
  const history = useSyncExternalStore(runtime.history.subscribe, runtime.history.getSnapshot, runtime.history.getSnapshot);
  const [nowPlayingClock, setNowPlayingClock] = useState(0);
  useEffect(() => {
    if (!peer) return;
    const initial = setTimeout(() => setNowPlayingClock(Date.now()), 0);
    const timer = setInterval(() => setNowPlayingClock(Date.now()), 15_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [peer]);
  useEffect(() => {
    let active = true;
    void runtime.messages.context(destination).then(async context => {
      const details = circle ? await runtime.social.circle(circle) : undefined;
      await runtime.history.refresh();
      if (!active) return;
      const initial = conversationMessages(runtime.history.getSnapshot(), context.conversation, context.sender);
      seenIncomingPings.current.set(context.conversation, new Set(initial.filter(item => item.ping && !item.own).map(item => item.id)));
      setContext(context); setMembers(details?.members ?? []); setConversation(context.conversation);
      const pager = runtime.historyPager(context.conversation, context.audience);
      historyPagerRef.current = { conversation: context.conversation, pager };
      setOlderPage({ conversation: context.conversation, more: true, loading: true, error: false });
      try {
        const page = await pager.load(context.conversation, context.audience);
        if (!active) return;
        await runtime.history.refresh();
        if (active) setOlderPage({ conversation: context.conversation, more: page.more, loading: false, error: false });
      } catch {
        if (active) { setOlderPage({ conversation: context.conversation, more: true, loading: false, error: true }); showFeedback('Could not load earlier messages. Tap to retry.'); }
      }
    }).catch(error => { if (active) { setFailed(true); feedback(error); } });
    return () => { active = false; };
  }, [runtime, peer, circle, destination, attempt]);
  useEffect(() => {
    if (!peer || !conversation) return;
    let active = true;
    void runtime.conversationPreferences().then(store => { if (active) setLoadedPreferences({ conversation, store }); }, error => { if (active) showFeedback(error && typeof error === 'object' && 'code' in error && error.code === 'SESSION_REVOKED' ? 'Your session ended. Sign in again.' : 'Could not load chat notification settings.'); });
    return () => { active = false; };
  }, [runtime, peer, conversation]);
  const preferenceStore = peer && loadedPreferences && loadedPreferences.conversation === conversation ? loadedPreferences.store : undefined;
  const preferenceSnapshot = useSyncExternalStore(preferenceStore?.subscribe ?? noop, preferenceStore?.getSnapshot ?? getEmptyPreferences, preferenceStore?.getSnapshot ?? getEmptyPreferences);
  const pingMuted = !!(conversation && preferenceSnapshot.values[conversation]?.pingMuted);
  useEffect(() => {
    if (!peer || !context || !conversation || !preferenceStore) return;
    const seen = seenIncomingPings.current.get(conversation) ?? new Set<string>();
    seenIncomingPings.current.set(conversation, seen);
    for (const item of conversationMessages(history, conversation, context.sender)) {
      if (!item.ping || item.own || seen.has(item.id)) continue;
      seen.add(item.id);
      if (pingMuted || !pingAlertGate.current.shouldAlert(conversation, Date.now())) continue;
      setHighlightedPingId(item.id);
      showFeedback('PING! A friend sent you a nudge.', 3500);
      if (pingHighlightTimer.current) clearTimeout(pingHighlightTimer.current);
      pingHighlightTimer.current = setTimeout(() => setHighlightedPingId(current => current === item.id ? undefined : current), 1200);
    }
  }, [history, peer, context, conversation, pingMuted, preferenceStore]);
  useEffect(() => () => { if (pingHighlightTimer.current) clearTimeout(pingHighlightTimer.current); }, []);
  const composer = useMemo(() => createComposer(async draft => {
    try {
      const target = replyMomentRef.current, publisher = momentPublisherRef.current;
      if (target && circle) {
        if (!publisher) throw new Error('MOMENT_NOT_READY');
        await runtime.circleMomentPublisher(circle).reply(target.id, draft.plaintext, draft.operation);
        if (replyMomentRef.current?.id === target.id) { replyMomentRef.current = undefined; setReplyMoment(undefined); }
      } else if (target && peer) {
        if (!publisher) throw new Error('MOMENT_NOT_READY');
        await runtime.privateMomentPublisher(peer).reply(target.id, draft.plaintext);
        if (replyMomentRef.current?.id === target.id) { replyMomentRef.current = undefined; setReplyMoment(undefined); }
      } else await runtime.sender.send({ ...draft, ...destination });
    }
    finally { await runtime.history.refresh().catch(() => {}); }
  }, async operation => { await runtime.history.refresh(); return runtime.history.getSnapshot().outgoing.some(record => record.operation === operation); }, Crypto.randomUUID), [runtime, destination, circle, peer]);
  const draft = useSyncExternalStore(composer.subscribe, composer.getSnapshot, composer.getSnapshot);
  const sendChatPhoto = async (photo = chatPhoto, caption = draft.text) => {
    const editor = circle ? photoEditor : privatePhotoEditor;
    const pending = circle ? pendingChatPhoto : pendingPrivateChatPhoto;
    if (!editor || sendingPhoto || (!circle && !peer)) return;
    setSendingPhoto(true);
    try {
      if (pending) await editor.retry();
      else if (photo) {
        const prepared = await prepareCirclePhoto(photo);
        try { await editor.sendPhoto({ bytes: prepared.bytes, mimeType: prepared.mimeType, caption }); }
        finally { prepared.dispose(); }
      } else return;
      setChatPhoto(undefined); setPendingChatPhoto(undefined); setPendingPrivateChatPhoto(undefined); composer.setText('');
      await runtime.history.refresh();
    } catch (error) {
      feedback(error);
      if (circle) setPendingChatPhoto(await photoEditor?.pending().catch(() => undefined));
      else setPendingPrivateChatPhoto(await privatePhotoEditor?.pending().catch(() => undefined));
      await runtime.history.refresh().catch(() => {});
    } finally { setSendingPhoto(false); }
  };
  const sendChatGif = async (gif: Gif, caption: string) => {
    const editor = circle ? photoEditor : privatePhotoEditor;
    if (!editor || !giphyClient || sendingPhoto || hasPendingChatPhoto || !conversation) return;
    setSendingPhoto(true);
    try {
      await sendEncryptedGif({ client: giphyClient, gif, editor, caption });
      setGifPicker(false); composer.setText('');
      await runtime.history.refresh();
    } catch (error) {
      feedback(error);
      if (circle) setPendingChatPhoto(await photoEditor?.pending().catch(() => undefined));
      else setPendingPrivateChatPhoto(await privatePhotoEditor?.pending().catch(() => undefined));
      await runtime.history.refresh().catch(() => {});
    } finally { setSendingPhoto(false); }
  };
  const discardChatPhoto = () => Alert.alert('Discard this saved photo?', 'If upload may have started, AwsemChat checks whether the message already committed before removing its media.', [
    { text: 'Keep photo', style: 'cancel' },
    { text: 'Discard photo', style: 'destructive', onPress: () => {
      const editor = circle ? photoEditor : privatePhotoEditor;
      if (!editor || sendingPhoto) return;
      setSendingPhoto(true);
      void editor.discard().then(result => { setPendingChatPhoto(undefined); setPendingPrivateChatPhoto(undefined); showFeedback(result.state === 'committed' ? 'This photo was already sent, so it was kept.' : 'Saved photo discarded.'); void runtime.history.refresh().catch(() => {}); }).catch(feedback).finally(() => setSendingPhoto(false));
    } },
  ]);
  const discardMomentPhoto = () => Alert.alert('Discard this saved photo?', 'If upload may have started, AwsemChat checks whether the Moment already committed before removing its media.', [
    { text: 'Keep photo', style: 'cancel' },
    { text: 'Discard photo', style: 'destructive', onPress: () => {
      if (!momentEditor || postingMoment) return;
      setPostingMoment(true);
      void momentEditor.discardPhoto().then(result => { setPendingMoment(undefined); setPendingMomentRecovery(undefined); showFeedback(result.state === 'committed' ? 'This Moment was already shared, so it was kept.' : 'Saved photo discarded.'); }).catch(feedback).finally(() => setPostingMoment(false));
    } },
  ]);
  const rows = conversation ? conversationMessages(history, conversation, context?.sender).reverse() : [];
  const loadEarlierMessages = async () => {
    if (!context || !conversation || olderPage?.loading) return;
    const pager = historyPagerRef.current?.conversation === conversation
      ? historyPagerRef.current.pager
      : runtime.historyPager(context.conversation, context.audience);
    historyPagerRef.current = { conversation, pager };
    setOlderPage({ conversation, more: true, loading: true, error: false });
    try {
      const page = await pager.load(context.conversation, context.audience);
      await runtime.history.refresh();
      setOlderPage({ conversation, more: page.more, loading: false, error: false });
    } catch {
      setOlderPage({ conversation, more: true, loading: false, error: true });
      showFeedback('Could not load earlier messages. Tap to retry.');
    }
  };
  const sendPing = async () => {
    if (!peer || !conversation || !context || sendingPing || circle) return;
    const saved = pendingPingRef.current?.conversation === conversation ? pendingPingRef.current : { conversation, operation: Crypto.randomUUID() };
    pendingPingRef.current = saved; setPendingPing(saved); setSendingPing(true);
    try {
      await runtime.sender.send({ ...destination, operation: saved.operation, contentType: 'ping', plaintext: encodePing() });
      if (pendingPingRef.current?.operation === saved.operation) { pendingPingRef.current = undefined; setPendingPing(undefined); }
      showFeedback('PING sent.');
      await runtime.history.refresh();
    } catch (error) { feedback(error); }
    finally { setSendingPing(false); }
  };
  const sendPong = async (item: ConversationMessage) => {
    if (!peer || circle || !conversation || !item.ping || item.own || item.respondedByMe || answeredPings.has(item.operation) || sendingPongs.has(item.operation)) return;
    const operation = pendingPongOperations.current.get(item.operation) ?? Crypto.randomUUID();
    pendingPongOperations.current.set(item.operation, operation);
    setSendingPongs(current => new Set(current).add(item.operation));
    try {
      await runtime.sender.send({ ...destination, operation, contentType: 'pong', plaintext: encodePong(item.operation) });
      pendingPongOperations.current.delete(item.operation);
      setAnsweredPings(current => new Set(current).add(item.operation));
      showFeedback('PONG sent.');
      await runtime.history.refresh();
    } catch (error) { feedback(error); }
    finally { setSendingPongs(current => { const next = new Set(current); next.delete(item.operation); return next; }); }
  };
  const togglePingMute = async () => {
    if (!preferenceStore || !conversation) return;
    try { await preferenceStore.set(conversation, 'pingMuted', !pingMuted); showFeedback(pingMuted ? 'PING alerts unmuted for this chat.' : 'PING alerts muted for this chat.'); }
    catch (error) { feedback(error); }
  };
  const momentPublisher = useMemo(() => circle ? runtime.circleMomentPublisher(circle) : undefined, [runtime, circle]);
  const privatePublisher = useMemo(() => peer ? runtime.privateMomentPublisher(peer) : undefined, [runtime, peer]);
  useEffect(() => { momentPublisherRef.current = momentPublisher ?? privatePublisher; }, [momentPublisher, privatePublisher]);
  useEffect(() => {
    if (!circle) return;
    let active = true;
    void runtime.circleMomentEditor(circle).then(async editor => {
      const saved = await editor.pending();
      if (active) { setMomentEditor(editor); setPendingMoment(saved?.moment); setPendingMomentRecovery(saved); }
    }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [runtime, circle]);
  useEffect(() => {
    if (!peer) return;
    let active = true;
    void runtime.privateMomentEditor(peer).then(async editor => { const saved = await editor.pending(); if (active) { setPrivateEditor(editor); setPrivatePending(saved); } }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [runtime, peer]);
  useEffect(() => {
    if (!peer) return;
    let active = true;
    void runtime.privatePhotoEditor(peer).then(async editor => { const saved = await editor.pending(); if (active) { setPrivatePhotoEditor(editor); setPendingPrivateChatPhoto(saved?.stickerIntent ? undefined : saved); setPendingPrivateChatSticker(saved?.stickerIntent ? saved : undefined); } }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [runtime, peer]);
  useEffect(() => {
    if (!circle) return;
    let active = true;
    void runtime.circleStickerSender(circle).then(async sender => {
      const saved = await sender.pending();
      if (active) { setStickerSender(sender); setPendingChatSticker(saved); }
    }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [runtime, circle]);
  useEffect(() => {
    if (!circle) return;
    let active = true;
    void runtime.circlePhotoEditor(circle).then(async editor => {
      const saved = await editor.pending();
      if (active) { setPhotoEditor(editor); setPendingChatPhoto(saved); }
    }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [runtime, circle]);
  const moments = useMemo(() => {
    if (!circle) return [] as readonly CircleMomentEntry[];
    try { return selectCircleMoments(history, circle); } catch { return null; }
  }, [history, circle]);
  const privateMoments = useMemo(() => {
    if (!peer || !context || !conversation) return [] as readonly PrivateMomentEntry[];
    try { return selectPrivateMoments(history, conversation, context.audience); } catch { return null; }
  }, [history, peer, context, conversation]);
  const privateMomentReactions = useMemo(() => new Map((privateMoments ?? []).map(moment => [moment.id, selectPrivateMomentReactions(history, conversation ?? '', context?.audience ?? '', moment)])), [privateMoments, history, conversation, context]);
  const momentReactions = useMemo(() => new Map((moments ?? []).map(moment => [moment.id, selectCircleMomentReactions(history, circle ?? '', moment)])), [moments, history, circle]);
  const hasPendingChatPhoto = circle ? !!pendingChatPhoto : !!pendingPrivateChatPhoto;
  const pendingMediaIsGif = circle ? pendingChatPhoto?.image?.media?.mimeType === 'image/gif' : pendingPrivateChatPhoto?.prepared?.descriptor?.mimeType === 'image/gif';
  const pendingMomentPhoto = pendingMomentRecovery && 'kind' in pendingMomentRecovery && pendingMomentRecovery.kind === 'photo' ? pendingMomentRecovery : undefined;
  useEffect(() => {
    if (!momentEditor) return;
    let active = true;
    void momentEditor.pending().then(value => { if (active) { setPendingMoment(value?.moment); setPendingMomentRecovery(value); } }).catch(error => { if (active) feedback(error); });
    return () => { active = false; };
  }, [momentEditor, history.outgoing]);
  useEffect(() => { if (!privateEditor) return; let active = true; void privateEditor.pending().then(value => { if (active) setPrivatePending(value); }).catch(error => { if (active) feedback(error); }); return () => { active = false; }; }, [privateEditor, history.outgoing]);
  useEffect(() => { if (!privatePhotoEditor) return; let active = true; void privatePhotoEditor.pending().then(value => { if (active) { setPendingPrivateChatPhoto(value?.stickerIntent ? undefined : value); setPendingPrivateChatSticker(value?.stickerIntent ? value : undefined); } }).catch(error => { if (active) feedback(error); }); return () => { active = false; }; }, [privatePhotoEditor, history.outgoing]);
  const contacts = useSyncExternalStore(runtime.friends.subscribe, runtime.friends.getSnapshot, runtime.friends.getSnapshot);
  const profile = circle ? selectCircleProfile(history, circle) : undefined;
  const privateProfile = peer && context ? selectPrivateProfile(history, context.conversation, context.audience) : undefined;
  const nowPlaying = peer && context
    ? selectNowPlaying(history, context.conversation, context.audience, nowPlayingClock)
    : { state: 'empty' as const };
  const privateFriend = peer ? contacts.lists.accepted.items.find(item => item.accountId === peer) : undefined;
  const circleMemberLabel = (sender: PeerKeys | undefined) => {
    const selected = circle && context && sender ? selectCircleMemberProfile(history, circle, context.audience, sender) : undefined;
    const current = selected?.state === 'ready' ? selected.profile : undefined;
    return { name: current?.name ?? circleSender(sender, context, members), status: current?.status ?? '' };
  };
  const title = circle ? profile?.state === 'ready' ? profile.profile.name : 'Circle' : privateProfile?.state === 'ready' ? privateProfile.profile.name : conversationTitle(contacts.lists.accepted.items, peer ?? '');
  const subtitle = circle ? `${members.length} people · Circle` : [privateProfile?.state === 'ready' ? privateProfile.profile.status : '', nowPlaying.state === 'playing' ? `♫ ${nowPlaying.track.title} · ${nowPlaying.track.artist}` : ''].filter(Boolean).join(' · ') || 'Private chat';
  const sendMoment = async (retry: boolean, photo = momentPhoto, caption = momentCaption) => {
    if ((!momentPublisher && !privatePublisher) || postingMoment) return;
    setPostingMoment(true);
    try {
      if (retry) {
        if (circle && pendingMoment?.media && momentEditor) await momentEditor.retryPhoto();
        else if (peer && privatePending?.prepared && privateEditor) await privateEditor.retry();
        else if (circle) await momentPublisher!.retry();
        else await privatePublisher!.retry();
      } else if (photo && circle && momentEditor) {
        const prepared = await prepareCirclePhoto(photo);
        try { await momentEditor.postPhoto({ caption, bytes: prepared.bytes, mimeType: prepared.mimeType }); }
        finally { prepared.dispose(); }
      } else if (photo && peer && privateEditor) {
        const prepared = await prepareCirclePhoto(photo);
        try { await privateEditor.postPhoto({ caption, bytes: prepared.bytes, mimeType: prepared.mimeType }); }
        finally { prepared.dispose(); }
      } else if (circle) await momentPublisher!.post(caption);
      else await privatePublisher!.post(caption);
      setMomentCaption(''); setMomentPhoto(undefined); setPendingMoment(undefined); setPendingMomentRecovery(undefined);
      setPrivatePending(undefined);
      await runtime.history.refresh().catch(() => {});
    } catch (error) {
      feedback(error);
      if (momentEditor) setPendingMomentRecovery(await momentEditor.pending().catch(() => undefined));
      if (privateEditor) setPrivatePending(await privateEditor.pending().catch(() => undefined));
      await runtime.history.refresh().catch(() => {});
    } finally { setPostingMoment(false); }
  };
  const sendPersonalSticker = async (sticker: PersonalSticker) => {
    if (stickerBusy || pendingChatSticker || pendingPrivateChatSticker || (circle ? !stickerSender : !privatePhotoEditor)) return;
    setStickerBusy(true);
    try {
      if (circle) await stickerSender!.sendSticker({ image: sticker.artwork.image, label: sticker.artwork.title });
      else await privatePhotoEditor!.sendSticker({ image: sticker.artwork.image, label: sticker.artwork.title });
      setPendingChatSticker(undefined); setPendingPrivateChatSticker(undefined); setStickerPicker(false);
      await runtime.history.refresh();
    } catch (error) {
      feedback(error);
      let hasSaved = false;
      if (circle && stickerSender) {
        const saved = await stickerSender.pending().catch(() => undefined);
        setPendingChatSticker(saved); hasSaved = !!saved;
      }
      if (peer && privatePhotoEditor) {
        const saved = await privatePhotoEditor.pending().catch(() => undefined);
        setPendingPrivateChatPhoto(saved?.stickerIntent ? undefined : saved);
        setPendingPrivateChatSticker(saved?.stickerIntent ? saved : undefined);
        hasSaved = !!saved;
      }
      if (hasSaved) setStickerPicker(false);
      await runtime.history.refresh().catch(() => {});
    } finally { setStickerBusy(false); }
  };
  const retryPersonalSticker = async () => {
    const pending = circle ? pendingChatSticker : pendingPrivateChatSticker;
    if (stickerBusy || !pending || (circle ? !stickerSender : !privatePhotoEditor)) return;
    setStickerBusy(true);
    try {
      if (circle) await stickerSender!.retry(); else await privatePhotoEditor!.retry();
      setPendingChatSticker(undefined); setPendingPrivateChatSticker(undefined); showFeedback('Sticker sent.');
      await runtime.history.refresh();
    } catch (error) {
      feedback(error);
      if (circle && stickerSender) setPendingChatSticker(await stickerSender.pending().catch(() => undefined));
      if (peer && privatePhotoEditor) {
        const saved = await privatePhotoEditor.pending().catch(() => undefined);
        setPendingPrivateChatPhoto(saved?.stickerIntent ? undefined : saved);
        setPendingPrivateChatSticker(saved?.stickerIntent ? saved : undefined);
      }
      await runtime.history.refresh().catch(() => {});
    } finally { setStickerBusy(false); }
  };
  const discardPersonalSticker = () => Alert.alert('Discard this sticker?', 'If upload may have started, AwsemChat checks whether the message already committed before removing its media.', [
    { text: 'Keep sticker', style: 'cancel' },
    { text: 'Discard sticker', style: 'destructive', onPress: () => {
      if (stickerBusy || (circle ? !stickerSender : !privatePhotoEditor)) return;
      setStickerBusy(true);
      const discard = circle ? stickerSender?.discard() : privatePhotoEditor?.discard();
      void discard!.then(result => { setPendingChatSticker(undefined); setPendingPrivateChatSticker(undefined); showFeedback(result.state === 'committed' ? 'This sticker was already sent, so it was kept.' : 'Saved sticker discarded.'); }).catch(error => {
        feedback(error);
        if (circle && stickerSender) void stickerSender.pending().then(setPendingChatSticker).catch(() => {});
        if (peer && privatePhotoEditor) void privatePhotoEditor.pending().then(value => { setPendingPrivateChatPhoto(value?.stickerIntent ? undefined : value); setPendingPrivateChatSticker(value?.stickerIntent ? value : undefined); }).catch(() => {});
      }).finally(() => setStickerBusy(false));
    } },
  ]);
  const reactToMoment = async (momentId: string, emoji: CircleMomentReactionEmoji | PrivateMomentEmoji) => {
    if ((!momentPublisher && !privatePublisher) || reactingMoment) return;
    setReactingMoment(momentId);
    try { if (circle) await momentPublisher!.react(momentId, emoji as CircleMomentReactionEmoji); else await privatePublisher!.react(momentId, emoji as PrivateMomentEmoji); await runtime.history.refresh(); }
    catch (error) { feedback(error); }
    finally { setReactingMoment(undefined); }
  };
  const deleteMoment = (momentId: string) => Alert.alert('Delete this Moment?', circle ? 'It will be removed from the Moment timeline for this Circle.' : 'It will be removed from this private Moment timeline.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => {
      if ((!momentPublisher && !privatePublisher) || reactingMoment) return;
      setReactingMoment(momentId);
      void (circle ? momentPublisher!.remove(momentId) : privatePublisher!.remove(momentId)).then(() => runtime.history.refresh()).catch(feedback).finally(() => setReactingMoment(undefined));
    } },
  ]);
  const promoteMessage = (item: ConversationMessage) => Alert.alert('Add to Moments?', (item.photoMessage || item.privatePhotoMessage) ? `Share this photo and caption with ${circle ? 'the current Circle members' : 'your friend'} as a Moment.` : `Share this message with ${circle ? 'the current Circle members' : 'your friend'} as a Moment.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Add to Moments', onPress: () => {
      if (circle && momentPublisher) void momentPublisher.promote(item.operation).then(() => runtime.history.refresh()).then(() => setSection('moments')).catch(feedback);
      else if (peer && privatePublisher) void privatePublisher.promote(item.operation).then(() => runtime.history.refresh()).then(() => setSection('moments')).catch(feedback);
    } },
  ]);
  const toggleSelectedMessage = (item: ConversationMessage) => {
    if (!item.own || !item.redactionTarget || deletingMessages) return;
    setSelectedMessages(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; });
  };
  const deleteSelectedMessages = (items: ConversationMessage[]) => {
    const eligible = items.filter(item => item.own && item.redactionTarget);
    if (!eligible.length || deletingMessages) return;
    Alert.alert('Delete for everyone?', eligible.length === 1
      ? 'This message will be removed from your chat and the original participants’ chats when they reconnect.'
      : `These ${eligible.length} messages will be removed from your chat and the original participants’ chats when they reconnect.`, [
      { text: 'Keep messages', style: 'cancel' },
      { text: 'Delete for everyone', style: 'destructive', onPress: () => {
        setDeletingMessages(true);
        void (async () => {
          let deleted = 0, pending = 0, failedCount = 0;
          const pendingIds: string[] = [];
          for (const item of eligible) {
            try { await runtime.messageDeletion.delete(item.redactionTarget!); deleted++; }
            catch (error) {
              if (error && typeof error === 'object' && 'code' in error && error.code === 'DELETION_PENDING') { pending++; pendingIds.push(item.id); }
              else { failedCount++; feedback(error); }
            }
          }
          if (pendingIds.length) setPendingDeleteIds(current => new Set([...current, ...pendingIds]));
          setSelectedMessages(new Set());
          await runtime.history.refresh().catch(() => {});
          if (deleted) showFeedback(deleted === 1 ? 'Message deleted for everyone.' : `${deleted} messages deleted for everyone.`);
          if (pending) showFeedback(pending === 1 ? 'Delete request saved. It will finish when you are back online.' : `${pending} delete requests are saved until you are back online.`);
          if (failedCount && !deleted && !pending) showFeedback('Could not delete the selected messages. Try again.');
        })().finally(() => setDeletingMessages(false));
      } },
    ]);
  };
  const openMoment = (momentId: string) => {
    const list = circle ? moments : privateMoments;
    if (!list) return;
    const index = list.findIndex(item => item.id === momentId);
    if (index < 0) { showFeedback('This Moment is no longer available in this conversation.'); return; }
    setSection('moments');
    requestAnimationFrame(() => { if (circle) momentListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); else privateMomentListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }); });
  };
  const renderMoment = ({ item }: { item: CircleMomentEntry }) => <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
    {!item.own && <Text style={{ color: c.muted, fontSize: 13 }}>{circleSender(item.sender, context, members)}</Text>}
    {item.media && <CircleMomentPhoto runtime={runtime} circle={circle ?? ''} media={item.media} caption={item.caption} />}
    {item.caption ? <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>{item.caption}</Text> : null}
    <View accessibilityRole="toolbar" accessibilityLabel="Moment reactions" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {circleMomentReactionEmojis.map(emoji => {
        const summary = momentReactions.get(item.id)?.find(value => value.emoji === emoji), readOnly = context?.audience !== item.audience;
        return <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`React ${emoji}${summary ? `, ${summary.count} reactions` : ''}`} accessibilityState={{ selected: !!summary?.reactedByMe, disabled: reactingMoment === item.id || readOnly }} disabled={!!reactingMoment || readOnly} onPress={() => { void reactToMoment(item.id, emoji); }} style={{ minHeight: 34, minWidth: 38, paddingHorizontal: 7, borderRadius: 17, borderWidth: 1, borderColor: summary?.reactedByMe ? c.accent : c.line, backgroundColor: summary?.reactedByMe ? c.bg : c.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, opacity: readOnly ? .55 : 1 }}><Text style={{ fontSize: 15 }}>{emoji}</Text>{summary && <Text style={{ color: c.muted, fontSize: 12 }}>{summary.count}</Text>}</Pressable>;
      })}
    </View>
    {context?.audience !== item.audience && <Text style={{ color: c.muted, fontSize: 12 }}>This Moment belongs to an earlier Circle membership.</Text>}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text style={{ flex: 1, color: c.muted, fontSize: 12 }}>{[item.createdAt === undefined ? '' : new Date(item.createdAt).toLocaleString(), item.status ? item.status[0].toUpperCase() + item.status.slice(1) : ''].filter(Boolean).join(' · ')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {item.own && context?.audience === item.audience && <Pressable accessibilityRole="button" accessibilityLabel="Delete Moment" accessibilityState={{ disabled: reactingMoment === item.id }} disabled={!!reactingMoment} onPress={() => deleteMoment(item.id)} style={{ minHeight: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="delete-outline" size={19} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>Delete</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel="Reply to Moment in Chat" accessibilityState={{ disabled: context?.audience !== item.audience }} disabled={context?.audience !== item.audience} onPress={() => { setReplyMoment(item); setSection('chat'); }} style={{ minHeight: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="reply-outline" size={19} color={c.accent} /><Text style={{ color: c.accent, fontWeight: '600' }}>Reply in Chat</Text></Pressable>
      </View>
    </View>
  </View>;
  const renderPrivateMoment = ({ item }: { item: PrivateMomentEntry }) => <View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, gap: 8 }}>
    {!item.own && <Text style={{ color: c.muted, fontSize: 13 }}>{title}</Text>}
    {item.media && peer && <PrivateMomentPhoto runtime={runtime} peer={peer} media={item.media} caption={item.caption} />}
    {item.caption ? <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>{item.caption}</Text> : null}
    <View accessibilityRole="toolbar" accessibilityLabel="Moment reactions" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {(['❤️','😂','😮','😢','👍','🎉'] as const).map(emoji => { const reaction = privateMomentReactions.get(item.id)?.find(value => value.emoji === emoji); return <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${reaction?.reactedByMe ? 'Remove' : 'Add'} ${emoji} reaction${reaction ? `, ${reaction.count}` : ''}`} disabled={reactingMoment === item.id} onPress={() => void reactToMoment(item.id, emoji)} style={{ minWidth: 42, minHeight: 40, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: reaction?.reactedByMe ? c.accent : c.line, alignItems: 'center', justifyContent: 'center', backgroundColor: reaction?.reactedByMe ? c.bg : 'transparent' }}><Text style={{ color: c.text }}>{emoji}{reaction ? ` ${reaction.count}` : ''}</Text></Pressable>; })}
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={{ flex: 1, color: c.muted, fontSize: 12 }}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : item.status === 'queued' ? 'Sending…' : 'Just now'}</Text>
      {item.own && <Pressable accessibilityRole="button" accessibilityLabel="Delete Moment" onPress={() => deleteMoment(item.id)} style={{ minHeight: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="delete-outline" size={19} color={c.muted} /><Text style={{ color: c.muted, fontWeight: '600' }}>Delete</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel="Reply to Moment in Chat" onPress={() => { setReplyMoment(item); setSection('chat'); }} style={{ minHeight: 40, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="reply-outline" size={19} color={c.accent} /><Text style={{ color: c.accent, fontWeight: '600' }}>Reply in Chat</Text></Pressable>
    </View>
  </View>;
  const renderChatMessage = ({ item }: { item: ConversationMessage }) => {
    const memberProfile = circle && !item.own ? circleMemberLabel(item.sender) : undefined;
    const promotable = !!context && item.own && !item.sticker && !item.privateSticker && !item.momentReply && (!peer || (!item.photoMessage && (!item.privatePhotoMessage || item.privatePhotoMessage.audience === context.audience))) && history.outgoing.some(record => record.operation === item.operation && record.conversation === context.conversation && record.audience === context.audience && (circle ? record.circle === circle && record.target === null : record.circle === null && record.target === peer) && (record.status === 'sent' || record.status === 'delivered') && !!record.event);
    const selecting = selectedMessages.size > 0, selected = selectedMessages.has(item.id), selectable = item.own && !!item.redactionTarget;
    const messageActions = [
      ...(promotable ? [{ id: 'moment', label: 'Add to Moments', icon: 'image-multiple-outline' as const, onPress: () => promoteMessage(item) }] : []),
      ...(item.redactionTarget ? [
        { id: 'delete', label: 'Delete for everyone', icon: 'delete-outline' as const, destructive: true, onPress: () => deleteSelectedMessages([item]) },
        { id: 'select', label: 'Select messages', icon: 'checkbox-multiple-marked-outline' as const, onPress: () => setSelectedMessages(new Set([item.id])) },
      ] : []),
    ];
    const bubble = <Pressable accessibilityRole={selecting && selectable ? 'button' : undefined} accessibilityLabel={selecting && selectable ? `${selected ? 'Deselect' : 'Select'} your message` : item.own ? 'Your message. Long press for message options.' : undefined} accessibilityHint={selecting ? 'Only your messages can be selected for deletion.' : undefined} onPress={selecting && selectable ? () => toggleSelectedMessage(item) : undefined}>
      <View style={{ maxWidth: '84%', borderRadius: 14, borderWidth: selected || highlightedPingId === item.id ? 2 : 0, borderColor: selected || highlightedPingId === item.id ? c.accent : 'transparent', paddingHorizontal: item.sticker ? 0 : 14, paddingVertical: item.sticker ? 0 : 10, backgroundColor: item.sticker ? 'transparent' : item.own ? c.surface === '#FFFFFF' ? '#E1F0FA' : '#294451' : c.bg }}>
        {item.sticker && circle ? <CircleStickerImage runtime={runtime} circle={circle} item={{ id: item.sticker.item, kind: 'sticker', label: item.sticker.label, image: item.sticker.image }} /> : <>
          {item.ping && <View style={{ minWidth: 170, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="bell-ring-outline" size={21} color={c.accent} /><Text style={{ color: c.text, fontSize: 17, fontWeight: '700' }}>PING!</Text></View>
            {item.own ? <Text style={{ color: c.muted, fontSize: 13 }}>A little nudge sent.</Text> : <>
              <Text style={{ color: c.muted, fontSize: 13 }}>A friend sent you a nudge.</Text>
              {item.respondedByMe || answeredPings.has(item.operation) ? <Text style={{ color: c.accent, fontSize: 14, fontWeight: '600' }}>PONG sent</Text> : <Pressable accessibilityRole="button" accessibilityLabel={sendingPongs.has(item.operation) ? 'Sending PONG' : pendingPongOperations.current.has(item.operation) ? 'Retry PONG' : 'Reply PONG'} accessibilityState={{ disabled: sendingPongs.has(item.operation) }} disabled={sendingPongs.has(item.operation)} onPress={() => { void sendPong(item); }} style={{ alignSelf: 'flex-start', minHeight: 38, paddingHorizontal: 12, borderRadius: 8, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="reply-outline" size={18} color={c.accent} /><Text style={{ color: c.accent, fontWeight: '600' }}>{sendingPongs.has(item.operation) ? 'Sending…' : pendingPongOperations.current.has(item.operation) ? 'Retry PONG!' : 'PONG!'}</Text></Pressable>}
            </>}
          </View>}
          {item.photoMessage && circle && <CircleMomentPhoto runtime={runtime} circle={circle} media={item.photoMessage.image} caption={item.photoMessage.caption} kind="Chat" />}
          {item.privatePhotoMessage && peer && <PrivateChatPhoto runtime={runtime} peer={peer} media={item.privatePhotoMessage.media} caption={item.privatePhotoMessage.caption} />}
          {item.privateSticker && peer && <PrivateChatSticker runtime={runtime} peer={peer} message={item.privateSticker} />}
          {item.momentReply && (circle || peer) && <Pressable accessibilityRole="button" accessibilityLabel={`Open Moment: ${item.momentReply.moment.caption || 'photo'}`} onPress={() => openMoment(item.momentReply!.moment.id)} style={{ padding: 8, marginBottom: 8, borderRadius: 10, borderWidth: 1, borderColor: c.line, gap: 5 }}>
            <Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>Moment</Text>
            {item.momentReply.moment.media && 'epoch' in item.momentReply.moment.media && circle && <CircleMomentPhoto runtime={runtime} circle={circle} media={item.momentReply.moment.media} caption={item.momentReply.moment.caption} compact />}
            {item.momentReply.moment.media && !('epoch' in item.momentReply.moment.media) && peer && <PrivateMomentPhoto runtime={runtime} peer={peer} media={item.momentReply.moment.media} caption={item.momentReply.moment.caption} compact />}
            <Text numberOfLines={2} style={{ color: c.muted, fontSize: 13 }}>{item.momentReply.moment.caption || 'Photo Moment'}</Text>
          </Pressable>}
          {item.pong && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Icon name="reply-outline" size={17} color={c.accent} /><Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>PONG!</Text></View>}
          {!item.ping && !item.pong && item.text ? <Text selectable style={{ color: c.text, fontSize: 16, lineHeight: 23, marginTop: item.photoMessage ? 8 : 0 }}>{item.text}</Text> : null}
        </>}
      </View>
    </Pressable>;
    return <View style={{ alignItems: item.own ? 'flex-end' : 'flex-start', marginVertical: 5 }}>
    {memberProfile && <View style={{ marginBottom: 3 }}><Text style={{ color: c.muted, fontSize: 12 }}>{memberProfile.name}</Text>{!!memberProfile.status && <Text style={{ color: c.muted, fontSize: 11, marginTop: 1 }}>{memberProfile.status}</Text>}</View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: item.own ? 'flex-end' : 'flex-start', gap: 8, width: '100%' }}>
    {selecting && item.own && <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select message: ${item.text || 'attachment'}`} accessibilityState={{ checked: selected, disabled: !selectable }} disabled={!selectable || deletingMessages} onPress={() => toggleSelectedMessage(item)} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name={selected ? 'check-circle' : 'checkbox-blank-circle-outline'} size={23} color={selected ? c.accent : c.muted} /></Pressable>}
    {item.own && messageActions.length > 0 && !selecting ? <PopupMenu label="Message options" actions={messageActions}>{bubble}</PopupMenu> : bubble}
    </View>
    <Text style={{ color: c.muted, fontSize: 12, marginTop: 3 }}>{[item.timestamp === undefined ? '' : new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), pendingDeleteIds.has(item.id) ? 'Deletion pending' : item.status ? item.status[0].toUpperCase() + item.status.slice(1) : ''].filter(Boolean).join(' · ')}</Text>
  </View>;
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}><View style={{ height: 72, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 0.5, borderColor: c.line }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={25} color={c.text} /></Pressable>{circle ? <CircleAvatarView runtime={runtime} circleId={circle} avatar={profile?.state === 'ready' ? profile.profile.avatar : null} /> : <PrivateProfileAvatar name={title} size={44} runtime={runtime} peerId={peer} requestId={privateFriend?.requestId} avatar={privateProfile?.state === 'ready' && privateProfile.profile.version === 2 ? privateProfile.profile.avatar : null} />}{peer ? <Pressable accessibilityRole="button" accessibilityLabel="Open conversation details" onPress={() => router.push({ pathname: '/flow', params: { view: 'conversation', peer } })} style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: c.text, fontSize: 20, fontWeight: '600' }}>{title}</Text><ScrollingStatus text={subtitle} color={c.muted} /></Pressable> : <View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: c.text, fontSize: 20, fontWeight: '600' }}>{title}</Text><Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>{subtitle}</Text></View>}<Pressable accessibilityRole="button" accessibilityLabel="Open shared media" onPress={() => router.push({ pathname: '/flow', params: { view: 'media', ...(peer ? { peer } : {}), ...(circle ? { circle } : {}) } })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="image-multiple-outline" size={22} color={c.accent} /></Pressable>{peer && <Pressable accessibilityRole="button" accessibilityLabel={pingMuted ? 'Unmute PING alerts' : 'Mute PING alerts'} accessibilityState={{ selected: pingMuted, disabled: !preferenceStore }} disabled={!preferenceStore} onPress={() => { void togglePingMute(); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: preferenceStore ? 1 : .45 }}><Icon name={pingMuted ? 'bell-off-outline' : 'bell-ring-outline'} size={22} color={pingMuted ? c.muted : c.accent} /></Pressable>}</View>
    {circle && <Pressable accessibilityRole="button" accessibilityLabel="Open Circle details" onPress={() => router.push({ pathname: '/flow', params: { view: 'members', circle } })} style={{ minHeight: 44, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="information-outline" size={20} color={c.accent} /><Text style={{ color: c.accent }}>Circle details</Text></Pressable>}
    {peer ? <IdentityPanel runtime={runtime} peer={peer} /> : context?.recipients.map(recipient => <IdentityPanel key={recipient.accountId} runtime={runtime} peer={recipient.accountId} circle={circle} />)}
    {(circle || peer) && <View accessibilityRole="tablist" style={{ height: 48, flexDirection: 'row', borderBottomWidth: .5, borderColor: c.line }}>{(['chat', 'moments'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: section === value }} onPress={() => setSection(value)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderColor: section === value ? c.accent : 'transparent' }}><Text style={{ color: section === value ? c.accent : c.muted, fontWeight: '600' }}>{value === 'chat' ? 'Chat' : 'Moments'}</Text></Pressable>)}</View>}
    {section === 'chat' && selectedMessages.size > 0 && <View accessibilityRole="toolbar" accessibilityLabel="Selected messages" style={{ minHeight: 54, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: .5, borderColor: c.line }}>
      <Text accessibilityLiveRegion="polite" style={{ flex: 1, color: c.text }}>{selectedMessages.size} selected</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel message selection" disabled={deletingMessages} onPress={() => setSelectedMessages(new Set())} style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' }}><Text style={{ color: c.muted }}>Cancel</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Delete selected messages for everyone" accessibilityState={{ disabled: deletingMessages }} disabled={deletingMessages} onPress={() => deleteSelectedMessages(rows.filter(item => selectedMessages.has(item.id)))} style={{ minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="delete-outline" size={20} color={c.accent} /><Text style={{ color: c.accent, fontWeight: '600' }}>{deletingMessages ? 'Deleting…' : 'Delete'}</Text></Pressable>
    </View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {!conversation ? <View style={{ padding: 24, gap: 12 }}>{failed ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Retry opening chat</Text></Pressable> : <ActivityIndicator accessibilityLabel="Loading conversation" color={c.accent} />}</View> : section === 'moments' && peer ? <FlatList
        ref={privateMomentListRef}
        data={privateMoments ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={<View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, gap: 10, marginBottom: 4 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>Share a Moment with {title}</Text>
          {privatePending && <Text style={{ color: c.muted, fontSize: 13 }}>A photo is saved securely. Retry to finish sharing it or discard it safely.</Text>}
          {privatePending && <View style={{ flexDirection: 'row', gap: 12 }}><Pressable accessibilityRole="button" disabled={postingMoment} onPress={() => void sendMoment(true)} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Retry photo</Text></Pressable><Pressable accessibilityRole="button" disabled={postingMoment} onPress={() => Alert.alert('Discard saved photo?', 'AwsemChat will check whether the Moment was already sent before removing the upload.', [{ text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { if (!privateEditor) return; setPostingMoment(true); void privateEditor.discard().then(result => { setPrivatePending(undefined); showFeedback(result.state === 'committed' ? 'This Moment was already shared, so it was kept.' : 'Saved photo discarded.'); }).catch(feedback).finally(() => setPostingMoment(false)); } }])} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Discard</Text></Pressable></View>}
          {momentPhoto && <Image accessibilityLabel="Selected Moment photo preview" source={{ uri: momentPhoto.uri }} resizeMode="cover" style={{ width: '100%', height: 190, borderRadius: 10 }} />}
          <TextInput accessibilityLabel="Moment caption" placeholder="A little moment worth keeping…" placeholderTextColor={c.muted} value={momentCaption} onChangeText={setMomentCaption} editable={!postingMoment && !privatePending} multiline maxLength={280} style={{ minHeight: 76, maxHeight: 140, borderRadius: 10, backgroundColor: c.bg, color: c.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }} />
          {!privatePending && <Pressable accessibilityRole="button" accessibilityLabel="Add a photo to Moment" disabled={postingMoment || !privateEditor} onPress={() => { void ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }).then(result => { if (!result.canceled) { const asset = result.assets[0], photo = { uri: asset.uri, width: asset.width, height: asset.height }; setMomentPhoto(photo); setPhotoEditorDraft({ destination: 'moment', photo }); } }).catch(() => showFeedback('Could not open your photos. Please try again.')); }} style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="image-plus-outline" size={21} color={c.accent} /><Text style={{ color: c.accent }}>Add photo</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={postingMoment || (!privatePending && !momentCaption.trim() && !momentPhoto) || (!!momentPhoto && !privateEditor)} onPress={() => void sendMoment(!!privatePending)} style={{ minHeight: 46, borderRadius: 10, backgroundColor: c.accent, opacity: postingMoment || (!privatePending && !momentCaption.trim() && !momentPhoto) ? .5 : 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{postingMoment ? 'Sharing…' : privatePending ? 'Retry saved Moment' : 'Share Moment'}</Text></Pressable>
          <Text style={{ color: c.muted, fontSize: 12 }}>Only you and {title} can see this private Moment.</Text>
        </View>}
        renderItem={renderPrivateMoment}
        onScrollToIndexFailed={({ index }) => requestAnimationFrame(() => privateMomentListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }))}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center', padding: 24 }}>{privateMoments === null ? 'Could not read private Moments.' : 'No Moments yet. Save something just for the two of you.'}</Text>}
      /> : section === 'moments' && circle ? <FlatList
        ref={momentListRef}
        data={moments ?? []}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 14, gap: 12 }}
        ListHeaderComponent={<View style={{ borderRadius: 12, borderWidth: 1, borderColor: c.line, padding: 14, gap: 10, marginBottom: 4 }}>
          <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>Share a Circle Moment</Text>
          {pendingMomentPhoto && <Text style={{ color: c.muted, fontSize: 13 }}>{pendingMomentPhoto.phase === 'prepared' ? 'Photo is saved securely and has not uploaded yet.' : 'Upload completed. Retry to safely confirm Moment delivery before replacing this photo.'}</Text>}
          {pendingMomentPhoto && pendingMomentPhoto.phase === 'prepared' && !pendingMomentPhoto.messagePending && <Pressable accessibilityRole="button" accessibilityLabel="Discard saved Moment photo" disabled={postingMoment} onPress={discardMomentPhoto} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Discard saved photo</Text></Pressable>}
          {momentPhoto && <View style={{ gap: 6 }}><Image accessibilityLabel="Selected Moment photo preview" source={{ uri: momentPhoto.uri }} resizeMode="cover" style={{ width: '100%', height: 190, borderRadius: 10 }} /><Pressable accessibilityRole="button" accessibilityLabel="Remove selected Moment photo" disabled={postingMoment || !!pendingMoment} onPress={() => setMomentPhoto(undefined)} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Remove photo</Text></Pressable></View>}
          <TextInput accessibilityLabel="Moment caption" placeholder="A little moment worth keeping…" placeholderTextColor={c.muted} value={momentCaption} onChangeText={setMomentCaption} editable={!postingMoment && !pendingMoment} multiline maxLength={280} style={{ minHeight: 76, maxHeight: 140, borderRadius: 10, backgroundColor: c.bg, color: c.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }} />
          {!pendingMoment && <Pressable accessibilityRole="button" accessibilityLabel={momentPhoto ? 'Choose a different Moment photo' : 'Add a photo to Moment'} disabled={postingMoment || !momentEditor} onPress={() => { void ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }).then(result => { if (!result.canceled) { const asset = result.assets[0], photo = { uri: asset.uri, width: asset.width, height: asset.height }; setMomentPhoto(photo); setPhotoEditorDraft({ destination: 'moment', photo }); } }).catch(() => showFeedback('Could not open your photos. Please try again.')); }} style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Icon name="image-plus-outline" size={21} color={c.accent} /><Text style={{ color: c.accent }}>{momentPhoto ? 'Change photo' : 'Add photo'}</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={postingMoment || (!pendingMoment && !momentCaption.trim() && !momentPhoto) || (!!momentPhoto && !momentEditor)} onPress={() => { void sendMoment(!!pendingMoment); }} style={{ minHeight: 46, borderRadius: 10, backgroundColor: c.accent, opacity: postingMoment || (!pendingMoment && !momentCaption.trim() && !momentPhoto) || (!!momentPhoto && !momentEditor) ? .5 : 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{postingMoment ? 'Sharing…' : pendingMoment ? 'Retry saved Moment' : 'Share Moment'}</Text></Pressable>
          <Text style={{ color: c.muted, fontSize: 12 }}>Only members in this Circle now receive it.</Text>
        </View>}
        renderItem={renderMoment}
        onScrollToIndexFailed={({ index }) => requestAnimationFrame(() => momentListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 }))}
        ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center', padding: 24 }}>{moments === null ? 'Could not read this Circle’s Moments.' : 'No Moments here yet. Share one with this Circle.'}</Text>}
      /> : <>
        <FlatList inverted data={rows} keyExtractor={row => row.id} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }} keyboardShouldPersistTaps="handled" renderItem={renderChatMessage} ListFooterComponent={olderPage?.conversation === conversation && olderPage.more ? <Pressable accessibilityRole="button" accessibilityLabel={olderPage.loading ? 'Loading earlier messages' : olderPage.error ? 'Retry loading earlier messages' : 'Load earlier messages'} accessibilityState={{ disabled: olderPage.loading }} disabled={olderPage.loading} onPress={() => { void loadEarlierMessages(); }} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.accent }}>{olderPage.loading ? 'Loading…' : olderPage.error ? 'Retry' : 'Load earlier messages'}</Text></Pressable> : null} ListEmptyComponent={<Text style={{ color: c.muted, textAlign: 'center', padding: 24, transform: [{ scaleY: -1 }] }}>Your conversation starts here.</Text>} />
        <View style={{ borderTopWidth: 0.5, borderColor: c.line }}>
          {(circle && (chatPhoto || pendingChatPhoto) || peer && (chatPhoto || pendingPrivateChatPhoto)) && <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
            {chatPhoto && <Image accessibilityLabel="Selected chat photo preview" source={{ uri: chatPhoto.uri }} resizeMode="cover" style={{ width: 104, height: 104, borderRadius: 10, backgroundColor: c.bg }} />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, color: c.muted, fontSize: 13 }}>{(circle ? pendingChatPhoto : pendingPrivateChatPhoto) ? (circle ? pendingChatPhoto?.phase === 'prepared' : !pendingPrivateChatPhoto?.uploadAttempted) ? `${pendingMediaIsGif ? 'GIF' : 'Photo'} is saved securely and has not uploaded yet.` : `Upload completed. Retry to safely confirm message delivery before replacing this ${pendingMediaIsGif ? 'GIF' : 'photo'}.` : 'Photo ready to send'}</Text>
              {(circle ? pendingChatPhoto?.phase === 'prepared' : !!pendingPrivateChatPhoto && !pendingPrivateChatPhoto.uploadAttempted) && <Pressable accessibilityRole="button" accessibilityLabel="Discard saved photo" disabled={sendingPhoto} onPress={discardChatPhoto} style={{ minHeight: 40, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Discard</Text></Pressable>}
              {chatPhoto && <Pressable accessibilityRole="button" accessibilityLabel="Remove selected chat photo" disabled={sendingPhoto} onPress={() => setChatPhoto(undefined)} style={{ minHeight: 40, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Remove</Text></Pressable>}
            </View>
          </View>}
          {circle && pendingChatSticker && <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 6 }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>{pendingChatSticker.phase === 'prepared' ? `“${pendingChatSticker.label}” is saved securely and has not uploaded yet.` : `“${pendingChatSticker.label}” uploaded. Retry to confirm delivery before choosing another sticker.`}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Retry saved sticker" disabled={stickerBusy || !stickerSender} onPress={() => void retryPersonalSticker()} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>{stickerBusy ? 'Sending…' : 'Retry sticker'}</Text></Pressable>
              {pendingChatSticker.phase === 'prepared' && <Pressable accessibilityRole="button" accessibilityLabel="Discard saved sticker" disabled={stickerBusy || !stickerSender} onPress={discardPersonalSticker} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.muted }}>Discard</Text></Pressable>}
            </View>
          </View>}
          {peer && pendingPrivateChatSticker && <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 6 }}>
            <Text style={{ color: c.muted, fontSize: 13 }}>{pendingPrivateChatSticker.uploadAttempted ? `“${pendingPrivateChatSticker.stickerIntent?.label}” uploaded. Retry to confirm delivery before choosing another sticker.` : `“${pendingPrivateChatSticker.stickerIntent?.label}” is saved securely and has not uploaded yet.`}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Retry saved sticker" disabled={stickerBusy || !privatePhotoEditor} onPress={() => void retryPersonalSticker()} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.accent, fontWeight: '600' }}>{stickerBusy ? 'Sending…' : 'Retry sticker'}</Text></Pressable>
              {!pendingPrivateChatSticker.uploadAttempted && <Pressable accessibilityRole="button" accessibilityLabel="Discard saved sticker" disabled={stickerBusy || !privatePhotoEditor} onPress={discardPersonalSticker} style={{ minHeight: 40, justifyContent: 'center' }}><Text style={{ color: c.muted }}>Discard</Text></Pressable>}
            </View>
          </View>}
          {replyMoment && <View style={{ minHeight: 64, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 0.5, borderColor: c.line }}>
            <View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>Replying to a Moment</Text><Text numberOfLines={1} style={{ color: c.text, fontSize: 14 }}>{replyMoment.caption || 'Photo Moment'}</Text></View>
            {replyMoment.media && 'epoch' in replyMoment.media && circle && <View style={{ width: 48, height: 48, overflow: 'hidden', borderRadius: 8 }}><CircleMomentPhoto runtime={runtime} circle={circle} media={replyMoment.media} caption={replyMoment.caption} compact /></View>}
            {replyMoment.media && !('epoch' in replyMoment.media) && peer && <View style={{ width: 48, height: 48, overflow: 'hidden', borderRadius: 8 }}><PrivateMomentPhoto runtime={runtime} peer={peer} media={replyMoment.media} caption={replyMoment.caption} compact /></View>}
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel Moment reply" disabled={draft.busy || draft.uncertain} onPress={() => { replyMomentRef.current = undefined; setReplyMoment(undefined); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={21} color={c.muted} /></Pressable>
          </View>}
          <View style={{ padding: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
            {peer && <Pressable accessibilityRole="button" accessibilityLabel={pendingPing?.conversation === conversation ? 'Retry PING to friend' : 'Send PING to friend'} accessibilityState={{ disabled: !conversation || !context || sendingPing || draft.busy || draft.uncertain || !!chatPhoto || hasPendingChatPhoto }} disabled={!conversation || !context || sendingPing || draft.busy || draft.uncertain || !!chatPhoto || hasPendingChatPhoto} onPress={() => { void sendPing(); }} style={{ width: 42, height: 44, alignItems: 'center', justifyContent: 'center', opacity: !context || sendingPing || draft.busy || draft.uncertain || !!chatPhoto || hasPendingChatPhoto ? .45 : 1 }}><Icon name="bell-ring-outline" size={22} color={c.accent} /></Pressable>}
            {(circle || peer) && <Pressable accessibilityRole="button" accessibilityLabel={circle ? 'Add photo to Circle chat' : 'Add photo to private chat'} disabled={!conversation || sendingPhoto || hasPendingChatPhoto || (circle ? !photoEditor : !privatePhotoEditor)} onPress={() => { void ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }).then(result => { if (!result.canceled) { const asset = result.assets[0], photo = { uri: asset.uri, width: asset.width, height: asset.height }; setChatPhoto(photo); setPhotoEditorDraft({ destination: 'chat', photo }); } }).catch(() => showFeedback('Could not open your photos. Please try again.')); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: !(circle ? photoEditor : privatePhotoEditor) ? .5 : 1 }}><Icon name="image-plus-outline" size={23} color={c.accent} /></Pressable>}
            {(circle || peer) && <Pressable accessibilityRole="button" accessibilityLabel="Open GIF picker" disabled={!conversation || sendingPhoto || hasPendingChatPhoto || !(circle ? photoEditor : privatePhotoEditor)} onPress={() => setGifPicker(true)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: !(circle ? photoEditor : privatePhotoEditor) || hasPendingChatPhoto ? .5 : 1 }}><Icon name="file-gif-box" size={25} color={c.accent} /></Pressable>}
            {circle && <Pressable accessibilityRole="button" accessibilityLabel="Open Circle stickers" disabled={!conversation || draft.busy || draft.uncertain || stickerBusy || !!pendingChatSticker || !stickerSender} onPress={() => { setAttempt(value => value + 1); setStickerPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: stickerBusy || pendingChatSticker || !stickerSender ? 0.5 : 1 }}><Icon name="sticker-emoji" size={25} color={c.accent} /></Pressable>}
            {peer && <Pressable accessibilityRole="button" accessibilityLabel="Open personal stickers" disabled={!conversation || draft.busy || draft.uncertain || stickerBusy || !!pendingPrivateChatSticker || !privatePhotoEditor || hasPendingChatPhoto} onPress={() => { setAttempt(value => value + 1); setStickerPicker(true); }} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: stickerBusy || pendingPrivateChatSticker || !privatePhotoEditor || hasPendingChatPhoto ? 0.5 : 1 }}><Icon name="sticker-emoji" size={25} color={c.accent} /></Pressable>}
            <TextInput accessibilityLabel="Message" placeholder={replyMoment ? "Write a reply…" : "Message"} placeholderTextColor={c.muted} value={draft.text} onChangeText={composer.setText} editable={!!conversation && !draft.busy && !draft.uncertain && !hasPendingChatPhoto} multiline maxLength={circle && chatPhoto ? 280 : 8000} style={{ flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 12, backgroundColor: c.bg, color: c.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 }} />
            <Pressable accessibilityRole="button" accessibilityLabel={sendingPhoto ? `Sending ${chatPhoto || pendingMediaIsGif ? 'GIF' : 'photo'}` : hasPendingChatPhoto ? `Retry ${pendingMediaIsGif ? 'GIF' : 'photo'}` : chatPhoto ? 'Send photo' : draft.uncertain ? 'Retry pending message' : 'Send message'} accessibilityState={{ disabled: !conversation || (chatPhoto || hasPendingChatPhoto ? sendingPhoto || (!hasPendingChatPhoto && !(circle ? photoEditor : privatePhotoEditor)) : draft.busy || !draft.text.trim()) }} disabled={!conversation || (chatPhoto || hasPendingChatPhoto ? sendingPhoto || (!hasPendingChatPhoto && !(circle ? photoEditor : privatePhotoEditor)) : draft.busy || !draft.text.trim())} onPress={() => { if ((circle || peer) && (chatPhoto || hasPendingChatPhoto)) void sendChatPhoto(); else void composer.submit().catch(error => { if (composer.getSnapshot().uncertain) showFeedback("Retry this message before editing it."); else feedback(error); }); }} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: sendingPhoto || (chatPhoto && !(circle ? photoEditor : privatePhotoEditor)) || (!chatPhoto && !hasPendingChatPhoto && !draft.text.trim()) ? 0.45 : 1 }}><Icon name="send" size={25} color={c.accent} /></Pressable>
          </View>
        </View>
      </>}
    </KeyboardAvoidingView>
    {circle && <CircleStickerPicker open={stickerPicker} runtime={runtime} circle={circle} busy={stickerBusy} onClose={() => setStickerPicker(false)} onSelect={(item, source) => {
      if (source === 'personal') { void sendPersonalSticker(item as PersonalSticker); return; }
      setStickerBusy(true);
      void runtime.sender.send({ ...destination, operation: Crypto.randomUUID(), plaintext: encodeCircleStickerMessage(item as CollectionItem) }).then(() => {
        setStickerPicker(false); void runtime.history.refresh().catch(() => {});
      }).catch(feedback).finally(() => setStickerBusy(false));
    }} />}
    {(peer || circle) && <GiphyPicker open={gifPicker} onClose={() => setGifPicker(false)} onSend={(gif, caption) => { void sendChatGif(gif, caption); }} client={giphyClient} favoriteStore={gifFavorites} />}
    {peer && <PrivateStickerPicker open={stickerPicker} runtime={runtime} busy={stickerBusy || !!pendingPrivateChatSticker || !privatePhotoEditor} onClose={() => setStickerPicker(false)} onSelect={item => void sendPersonalSticker(item)} />}
    {photoEditorDraft && <PhotoEditor key={photoEditorDraft.photo.uri} photo={photoEditorDraft.photo} initialCaption={photoEditorDraft.destination === 'chat' ? draft.text : momentCaption} sendLabel={photoEditorDraft.destination === 'chat' ? sendingPhoto ? 'Sending…' : 'Send photo' : postingMoment ? 'Sharing…' : 'Share Moment'} sendDisabled={photoEditorDraft.destination === 'chat' ? sendingPhoto : postingMoment} onClose={() => { if (photoEditorDraft.destination === 'chat') setChatPhoto(undefined); else setMomentPhoto(undefined); setPhotoEditorDraft(undefined); }} onSend={async (uri, caption, dimensions) => {
      const photo = { uri, ...dimensions };
      if (photoEditorDraft.destination === 'chat') {
        setChatPhoto(photo); composer.setText(caption);
        await sendChatPhoto(photo, caption);
      } else {
        setMomentPhoto(photo); setMomentCaption(caption);
        await sendMoment(false, photo, caption);
      }
      setPhotoEditorDraft(undefined);
    }} />}
  </SafeAreaView>;
}
