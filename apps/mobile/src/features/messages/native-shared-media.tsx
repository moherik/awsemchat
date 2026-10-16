import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { fromByteArray } from 'base64-js';
import { router } from 'expo-router';
import { authenticationRuntime, type AuthenticationRuntime } from '../auth/runtime';
import { usePalette } from '../ui';
import { PhotoViewer, type ViewedPhoto } from '../photos/viewer';
import type { SharedMediaItem } from './shared-media';
import { selectCircleSharedMedia, selectPrivateSharedMedia } from './shared-media';
import { chatDestination } from './chat-destination';

const noop = () => () => undefined;
const signedOut = Object.freeze({ status: 'signed-out' as const });
const noLogin = Object.freeze({ phase: 'phone' as const, busy: false, phone: '' });
const idleHistory = Object.freeze({ phase: 'idle' as const, incoming: Object.freeze([]), outgoing: Object.freeze([]) });
type LoadedMedia = { key: string; uri?: string; failed?: true };
const MEDIA_PAGE_SIZE = 40;
const MEDIA_DOWNLOAD_CONCURRENCY = 6;

export function NativeSharedMedia({ peer, circle }: { peer?: string; circle?: string }) {
  const c = usePalette();
  const [runtime, setRuntime] = useState<AuthenticationRuntime>();
  const [contextResult, setContextResult] = useState<{ key: string; value?: Awaited<ReturnType<AuthenticationRuntime['messages']['context']>>; failed?: true }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; items: LoadedMedia[] }>();
  const [page, setPage] = useState<{ key: string; count: number }>();
  const [earlierPage, setEarlierPage] = useState<{ key: string; more: boolean; loading: boolean; error: boolean }>();
  const [viewed, setViewed] = useState<ViewedPhoto>();
  const mediaLoadCache = useRef<{ key: string; entries: Map<string, Promise<LoadedMedia>> }>({ key: '', entries: new Map() });
  const historyPagerRef = useRef<{ key: string; pager: ReturnType<AuthenticationRuntime['historyPager']> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void authenticationRuntime().then(value => { if (active) setRuntime(value); }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const login = useSyncExternalStore(runtime?.flow.subscribe ?? noop, runtime?.flow.getSnapshot ?? (() => noLogin), () => noLogin);
  const account = useSyncExternalStore(runtime?.owner.subscribe ?? noop, runtime?.owner.getSnapshot ?? (() => signedOut), () => signedOut);
  const history = useSyncExternalStore(runtime?.history.subscribe ?? noop, runtime?.history.getSnapshot ?? (() => idleHistory), runtime?.history.getSnapshot ?? (() => idleHistory));
  const destination = useMemo(() => chatDestination(peer, circle), [peer, circle]);
  const requestKey = `${destination ? JSON.stringify(destination) : 'invalid'}:${attempt}`;
  const context = contextResult?.key === requestKey ? contextResult.value : undefined;
  const contextFailed = contextResult?.key === requestKey && contextResult.failed === true;
  useEffect(() => {
    if (!runtime || account.status !== 'ready' || login.phase !== 'ready' || !destination) return;
    let active = true;
    void runtime.messages.context(destination).then(async value => {
      await runtime.history.refresh();
      if (active) setContextResult({ key: requestKey, value });
    }).catch(() => { if (active) setContextResult({ key: requestKey, failed: true }); });
    return () => { active = false; };
  }, [runtime, account.status, login.phase, destination, requestKey]);
  const items = useMemo(() => {
    if (!context || history.phase !== 'ready') return [];
    return circle
      ? selectCircleSharedMedia(history, context.conversation)
      : selectPrivateSharedMedia(history, context.conversation, context.audience);
  }, [circle, context, history]);
  const mediaKey = `${requestKey}:${items.map(item => item.key).join(',')}`;
  const visibleCount = page?.key === mediaKey ? Math.min(page.count, items.length) : Math.min(MEDIA_PAGE_SIZE, items.length);
  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);
  const hasMore = visibleCount < items.length;
  useEffect(() => {
    if (!runtime || !context || history.phase !== 'ready' || !visibleItems.length) return;
    let active = true;
    if (mediaLoadCache.current.key !== requestKey) mediaLoadCache.current = { key: requestKey, entries: new Map() };
    const cache = mediaLoadCache.current;
    const load = (item: SharedMediaItem) => {
      let request = cache.entries.get(item.key);
      if (!request) {
        request = (async (): Promise<LoadedMedia> => {
          try {
            const bytes = circle
              ? await runtime.circleAvatarBytes(circle, { epoch: item.epoch!, media: item.media })
              : item.kind === 'moment'
                ? await (await runtime.privateMomentEditor(peer!)).download(item.media)
                : await (await runtime.privatePhotoEditor(peer!)).download(item.media);
            return { key: item.key, uri: `data:${item.media.mimeType};base64,${fromByteArray(bytes)}` };
          } catch { return { key: item.key, failed: true }; }
        })();
        cache.entries.set(item.key, request);
      }
      return request;
    };
    void (async () => {
      const result: LoadedMedia[] = [];
      let index = 0;
      const worker = async () => { while (active && index < visibleItems.length) result.push(await load(visibleItems[index++])); };
      await Promise.all(Array.from({ length: Math.min(MEDIA_DOWNLOAD_CONCURRENCY, visibleItems.length) }, worker));
      if (active) setLoaded(previous => {
        const merged = new Map(previous?.key === requestKey ? previous.items.map(item => [item.key, item]) : []);
        for (const item of result) merged.set(item.key, item);
        return { key: requestKey, items: [...merged.values()] };
      });
    })();
    return () => { active = false; };
  }, [runtime, context, history.phase, visibleItems, circle, peer, mediaKey, requestKey]);
  const imageByKey = new Map(loaded?.key === requestKey ? loaded.items.map(item => [item.key, item]) : []);
  const openBack = () => router.canGoBack() ? router.back() : router.replace('/');
  const earlier = earlierPage?.key === requestKey
    ? earlierPage
    : { key: requestKey, more: true, loading: false, error: false };
  const loadMore = async () => {
    if (hasMore) {
      setPage({ key: mediaKey, count: Math.min(items.length, visibleCount + MEDIA_PAGE_SIZE) });
      return;
    }
    if (!runtime || !context || earlier.loading || !earlier.more) return;
    setEarlierPage({ ...earlier, loading: true, error: false });
    try {
      const key = JSON.stringify([context.conversation, context.audience]);
      if (!historyPagerRef.current || historyPagerRef.current.key !== key) {
        historyPagerRef.current = { key, pager: runtime.historyPager(context.conversation, context.audience) };
      }
      const result = await historyPagerRef.current.pager.load(context.conversation, context.audience);
      await runtime.history.refresh();
      setEarlierPage({ key: requestKey, more: result.more, loading: false, error: false });
    } catch {
      setEarlierPage({ key: requestKey, more: true, loading: false, error: true });
    }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={openBack} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>Shared media</Text>
    </View>
    {!runtime ? <View style={{ padding: 24, alignItems: 'center', gap: 10 }}>{failed ? <><Text style={{ color: c.muted }}>Could not open your account.</Text><Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }}><Text style={{ color: c.accent }}>Retry</Text></Pressable></> : <ActivityIndicator accessibilityLabel="Opening account" color={c.accent} />}</View>
      : login.phase !== 'ready' || account.status !== 'ready' ? <View style={{ padding: 20, alignItems: 'center', gap: 12 }}><Text style={{ color: c.muted }}>Sign in to view shared media.</Text><Pressable accessibilityRole="button" onPress={() => router.push('/auth')} style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 8, backgroundColor: c.accent }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Sign in</Text></Pressable></View>
        : failed || contextFailed || history.phase === 'error' ? <View style={{ padding: 20, gap: 12 }}><Text style={{ color: c.muted }}>Could not load shared media from this conversation.</Text><Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: c.accent }}>Retry</Text></Pressable></View>
          : !context || history.phase === 'loading' || history.phase === 'idle' ? <View style={{ padding: 24, alignItems: 'center', gap: 10 }}><ActivityIndicator accessibilityLabel="Loading shared media" color={c.accent} /><Text style={{ color: c.muted }}>Loading shared media…</Text></View>
            : <FlatList
              data={visibleItems}
              keyExtractor={item => item.key}
              numColumns={2}
              contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 14, flexGrow: 1 }}
              columnWrapperStyle={{ gap: 10 }}
              ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
              ListEmptyComponent={<View style={{ flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', gap: 8 }}><Icon name="image-multiple-outline" size={32} color={c.muted} /><Text style={{ color: c.muted, textAlign: 'center' }}>No photos, GIFs or Moments shared yet.</Text></View>}
              ListFooterComponent={hasMore || earlier.more ? <Pressable
                accessibilityRole="button"
                accessibilityLabel={hasMore ? 'Load more shared media' : earlier.error ? 'Retry loading earlier shared media' : 'Load earlier shared media'}
                accessibilityState={{ disabled: earlier.loading }}
                disabled={earlier.loading}
                onPress={() => void loadMore()}
                style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
              >{earlier.loading
                ? <ActivityIndicator accessibilityLabel="Loading earlier shared media" color={c.accent} />
                : <Text style={{ color: c.accent, fontWeight: '600' }}>{hasMore
                  ? `Load more shared media (${items.length - visibleCount} remaining)`
                  : earlier.error ? 'Retry loading earlier shared media' : 'Load earlier shared media'}</Text>}
              </Pressable> : null}
              renderItem={({ item }) => <SharedMediaTile item={item} loaded={imageByKey.get(item.key)} onOpen={() => {
                const media = imageByKey.get(item.key);
                if (media?.uri) setViewed({ uri: media.uri, caption: item.caption || undefined, title: item.kind === 'moment' ? 'Moment photo' : item.kind === 'gif' ? 'Chat GIF' : 'Chat photo' });
              }} />}
            />}
    {viewed && <PhotoViewer photo={viewed} onClose={() => setViewed(undefined)} />}
  </SafeAreaView>;
}

function SharedMediaTile({ item, loaded, onOpen }: { item: SharedMediaItem; loaded?: LoadedMedia; onOpen: () => void }) {
  const c = usePalette();
  const label = item.kind === 'moment' ? 'Moment photo' : item.kind === 'gif' ? 'GIF' : 'photo';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${label}${item.caption ? `: ${item.caption}` : ''}`} disabled={!loaded?.uri} onPress={onOpen} style={{ flex: 1, minWidth: 0, gap: 6 }}>
    {loaded?.uri ? <Image source={{ uri: loaded.uri }} contentFit="cover" style={{ width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: c.bg }} />
      : <View style={{ width: '100%', aspectRatio: 1, borderRadius: 10, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.muted, fontSize: 12, textAlign: 'center', padding: 8 }}>{loaded?.failed ? `${label} unavailable` : `Loading ${label.toLowerCase()}…`}</Text></View>}
    {item.caption ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 13 }}>{item.caption}</Text> : null}
  </Pressable>;
}
