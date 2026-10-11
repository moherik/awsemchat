import { NativeFriends } from './social/friends-screen';
import { PopupMenu } from './popup-menu';
import { ScrollingStatus } from './scrolling-status';
import { removeMomentAsset, updateMomentReply } from './photos/moment-links';
import { PhotoEditor, type EditablePhoto } from './photos/editor';
import { PhotoViewer, type ViewedPhoto } from './photos/viewer';
import { ReplyCard, type ReplyContext } from './photos/reply-card';
import { dismissFeedback, showFeedback as setNotice } from "./feedback/snackbar";
import { copySticker } from '@/features/stickers/model';
import { MediaSheet } from "@/features/media-sheet";
import { StickerPicker } from "@/features/stickers/picker";
import { Artwork } from "@/features/stickers/artwork";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { sampleChats, getSeed, type Chat } from "@/features/sample-data";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { updateDemo, useDemo, type DemoMessage } from "@/features/demo-store";
import { useState, useRef } from "react";
import {
  FlatList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Message = DemoMessage;
const colors = {
  light: {
    bg: "#F4F6F8",
    surface: "#FFFFFF",
    text: "#1B2731",
    muted: "#627079",
    line: "#E4E9ED",
    blue: "#066DB8",
    bubble: "#E1F0FA",
  },
  dark: {
    bg: "#172027",
    surface: "#202C34",
    text: "#F2F4F3",
    muted: "#AFBDC5",
    line: "#3A4850",
    blue: "#80C3EA",
    bubble: "#294451",
  },
};
export default function AwsemChat() {
  const demo = useDemo();
  const chats: Chat[] = [
    ...sampleChats.map((chat) => ({
      ...chat,
      ...(chat.circle
        ? {
            status: `${demo.circles.find((circle) => circle.name === chat.name)?.members.length ?? 0} people · Circle`,
          }
        : {}),
    })),
    ...demo.friends
      .filter((name) => !sampleChats.some((chat) => chat.name === name))
      .map((name) => ({
        id: name,
        name,
        initials: name.slice(0, 1),
        circle: false,
        status: "New friend",
        preview: "Say hello",
        time: "",
        unread: 0,
        color: "#526B83",
      })),
    ...demo.circles
      .filter(
        (circle) => !circle.left && !sampleChats.some((chat) => chat.id === circle.id || chat.name === circle.name),
      )
      .map((circle) => ({
        id: circle.id ?? `circle-${circle.name}`,
        avatar: circle.avatar ?? undefined,
        name: circle.name,
        initials: circle.name.slice(0, 2).toUpperCase(),
        circle: true,
        status: `${circle.members.length} people · Invitations pending`,
        preview: "Your Circle starts here",
        time: "",
        unread: 0,
        color: "#49644D",
      })),
  ]
    .map((chat: Chat) => {
      const circle = demo.circles.find(x => x.id === chat.id || x.name === chat.name);
      chat = circle ? { ...chat, name: circle.name, status: `${circle.members.length} people · Circle`, avatar: circle.avatar ?? chat.avatar } : chat;
      const history = demo.messages[chat.id];
      const last = history?.[history.length - 1];
      return {
        ...chat,
        preview: last ? `${last.own ? "You: " : ""}${last.text || (last.image ? "Photo" : "Sticker")}` : chat.preview,
        unread: demo.opened.includes(chat.id) ? 0 : chat.unread,
      };
    })
    .filter(
      (chat) =>
        (chat.circle ? !demo.circles.find(x => x.id === chat.id || x.name === chat.name)?.left : demo.friends.includes(chat.name)) &&
        !demo.blocked.includes(chat.name),
    );
  const system = useColorScheme();
  const dark = (demo.theme === "system" ? system : demo.theme) === "dark";

  const route = useLocalSearchParams<{ chat?: string; tab?: string }>();
  const c = colors[dark ? "dark" : "light"];
  const tab = route.tab ?? "Chats";
  const setTab = (value: string) => router.setParams({ tab: value });
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const active = chats.find((chat) => chat.id === route.chat) ?? null;
  const setActive = (chat: Chat | null) => {
    if (chat) {
      updateDemo({ opened: [...new Set([...demo.opened, chat.id])] });
      router.push({ pathname: "/chat", params: { chat: chat.id } });
    } else if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  const changeChatPreference = (id: string, key: 'pinned' | 'muted' | 'archived') => {
    const current = demo.chatPreferences?.[id] ?? {};
    updateDemo({ chatPreferences: { ...demo.chatPreferences, [id]: { ...current, [key]: !current[key] } } });
    setNotice(key === 'archived' ? 'Chat archived. Find it in Settings.' : key === 'pinned' ? current.pinned ? 'Chat unpinned.' : 'Chat pinned.' : current.muted ? 'Chat unmuted.' : 'Chat muted.');
  };
  const [section, setSection] = useState("Chat");
  const [draft, setDraft] = useState("");
  const [momentDraft, setMomentDraft] = useState("");
  const [creatingMoment, setCreatingMoment] = useState(false);
  const messages = demo.messages;
  const setMessages = (
    fn: (old: Record<string, Message[]>) => Record<string, Message[]>,
  ) => updateDemo({ messages: fn(demo.messages) });
  const [stickers, setStickers] = useState(false);
  const [attachments, setAttachments] = useState(false);
  const chatScroll = useRef<ScrollView>(null);
  const composerRef = useRef<TextInput>(null);
  const lastScrolledCount = useRef(-1);
  const messageLayouts = useRef<Record<number, number>>({});
  const [highlightedMessage, setHighlightedMessage] = useState<number | null>(null);
  const [photoDraft, setPhotoDraft] = useState<{ photo: EditablePhoto; destination: "chat" | "moment" } | null>(null);
  const [viewedPhoto, setViewedPhoto] = useState<ViewedPhoto | null>(null);
  const addMomentPhoto = async () => {
    if (!active) return;
    const feedback = setNotice("Opening your photos…", 0);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (!result.canceled) {
        const asset = result.assets[0]; setPhotoDraft({ photo: { uri: asset.uri, width: asset.width, height: asset.height }, destination: 'moment' });
      }
    } catch {
      setNotice("Could not open your photos. Try again.");
    } finally { dismissFeedback(feedback); }
  };
  const pingMuted = active ? (demo.pingMute[active.id] ?? false) : false;
  const setPingMuted = (value: boolean) => {
    if (active)
      updateDemo({ pingMute: { ...demo.pingMute, [active.id]: value } });
  };

  const [pin, setPin] = useState("");
  
  const [reactions, setReactions] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState<ReplyContext | null>(null);
  const [focusedMoment, setFocusedMoment] = useState<number | null>(null);
  const [failNext, setFailNext] = useState(false);
  const collections = demo.moments;
  const setCollections = (
    fn: (old: Record<string, string[]>) => Record<string, string[]>,
  ) => updateDemo({ moments: fn(demo.moments) });
  const moments = active
    ? (collections[active.id] ??
      (sampleChats.some((chat) => chat.id === active.id)
        ? ["Sunday, saved."]
        : []))
    : [];
  const momentImage = (index: number) => active ? demo.momentImages[`${active.id}-${index}`] ?? (collections[active.id] === undefined && index === 0 && sampleChats.some(chat => chat.id === active.id) ? 'https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800&q=85' : undefined) : undefined;
  const beginMessageReply = (message: DemoMessage, index: number) => { if (!active) return; setReply({ kind: 'message', index, author: message.own ? demo.name : active.circle ? 'Mum' : active.name, text: message.text, image: message.image, stickerArtwork: message.stickerArtwork ? copySticker(message.stickerArtwork, message.stickerArtwork.pack) : undefined }); composerRef.current?.focus(); };
  const recordMessageLayout = (index: number, y: number) => { messageLayouts.current[index] = y; };
  const beginMomentReply = (text: string, index: number) => { if (!active) return; setSection('Chat'); setReply({ kind: 'moment', index, author: demo.name, text, image: momentImage(index), stickerArtwork: demo.momentStickers[`${active.id}-${index}`] }); };
  const deleteMoment = (index: number) => { if (!active) return; updateDemo({ moments: { ...demo.moments, [active.id]: moments.filter((_, i) => i !== index) }, momentImages: removeMomentAsset(demo.momentImages, active.id, index), momentStickers: removeMomentAsset(demo.momentStickers, active.id, index), messages: { ...demo.messages, [active.id]: (demo.messages[active.id] ?? getSeed(active.id)).map(msg => ({ ...msg, moment: msg.momentIndex === index ? false : msg.moment, momentIndex: msg.momentIndex === index ? undefined : msg.momentIndex !== undefined && msg.momentIndex > index ? msg.momentIndex - 1 : msg.momentIndex, replyContext: msg.replyContext ? updateMomentReply(msg.replyContext, index) : undefined })) } }); setReply(current => current?.kind === 'moment' && current.index === index ? null : current ? updateMomentReply(current, index) : null); setFocusedMoment(null); setNotice('Moment deleted.'); };
  const reactToMessage = (index: number) => { if (!active) return; setMessages(old => ({ ...old, [active.id]: (old[active.id] ?? getSeed(active.id)).map((message, i) => i === index ? { ...message, reaction: message.reaction ? undefined : '♥' } : message) })); };
  const saveMessageMoment = (message: DemoMessage) => { if (!active || !message.own) return; setMoments([...moments, message.text]); if (message.image) updateDemo({ momentImages: { ...demo.momentImages, [`${active.id}-${moments.length}`]: message.image } }); if (message.stickerArtwork) updateDemo({ momentStickers: { ...demo.momentStickers, [`${active.id}-${moments.length}`]: copySticker(message.stickerArtwork, message.stickerArtwork.pack) } }); setNotice('Added to Moments'); };
  const retryMessage = (index: number) => { if (!active) return; setMessages(old => ({ ...old, [active.id]: (old[active.id] ?? getSeed(active.id)).map((message, i) => i === index ? { ...message, failed: false } : message) })); };
  const openReply = (context: ReplyContext) => { if (context.deleted) return; if (context.kind === 'moment') { setFocusedMoment(context.index); setSection('Moments'); } else { setHighlightedMessage(context.index); chatScroll.current?.scrollTo({ y: Math.max(0, (messageLayouts.current[context.index] ?? 0) - 16), animated: true }); } };
  const setMoments = (items: string[]) => {
    if (active) setCollections((old) => ({ ...old, [active.id]: items }));
  };
  const button = (label: string, action: () => void, selected = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={action}
      style={[
        s.button,
        { backgroundColor: selected ? c.blue : c.surface, borderColor: c.line },
      ]}
    >
      <Text
        style={{
          color: selected ? (dark ? "#172027" : "#FFFFFF") : c.text,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const send = (
    text: string,
    moment = false,
    momentIndex?: number,
    image?: string,
  ) => {
    if (!active || (!text.trim() && !image)) return;
    setMessages((old) => ({
      ...old,
      [active.id]: [
        ...(old[active.id] ?? getSeed(active.id)),
        {
          text: text.trim(),
          own: true,
          moment: reply?.kind === "moment" || moment,
          momentIndex: reply?.kind === "moment" ? reply.index : momentIndex,
          sticker: demo.stickers.includes(text.trim()),
          image,
          replyContext: reply ? { ...reply, stickerArtwork: reply.stickerArtwork ? copySticker(reply.stickerArtwork, reply.stickerArtwork.pack) : undefined } : undefined,
          failed: failNext,
        },
      ],
    }));
    setDraft("");
    setStickers(false);
    setReply(null);
    setFailNext(false);
  };
  const menuRow = (
    label: string,
    icon: keyof typeof MaterialCommunityIcons.glyphMap,
    action: () => void,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={action}
      style={[s.menuRow, { borderColor: c.line }]}
    >
      <MaterialCommunityIcons name={icon} color={c.muted} size={23} />
      <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{label}</Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={c.muted} />
    </Pressable>
  );
  const title = (text: string, sub?: string) => (
    <View style={s.titleBlock}>
      <Text style={[s.title, { color: c.text }]}>{text}</Text>
      {sub && <Text style={[s.sub, { color: c.muted }]}>{sub}</Text>}
    </View>
  );
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: c.bg }]}>
      <View style={[s.app, { backgroundColor: c.surface }]}>
        {active ? (
          <>
            <View style={[s.header, { borderColor: c.line }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to chats"
                onPress={() => {
                  setActive(null);
                }}
                style={s.back}
              >
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={24}
                  color={c.text}
                />
              </Pressable>
              <View
                style={[
                  s.avatar,
                  { backgroundColor: "transparent", width: 42, height: 42 },
                ]}
              >
                <Image
                  source={{
                    uri: active.avatar || "https://i.pravatar.cc/120?img=32",
                  }}
                  style={{ width: 42, height: 42, borderRadius: 7 }}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Conversation details"
                  onPress={() =>
                    router.push({
                      pathname: "/flow",
                      params: {
                        view: active.circle ? "members" : "conversation",
                        name: active.name,
                      },
                    })
                  }
                >
                  {title(active.name)}
                  <ScrollingStatus
                    color={c.muted}
                    text={[active.status, !active.circle && demo.music ? '♫ Sunset Lover · Petit Biscuit · Sample' : null].filter(Boolean).join(' · ')}
                  />
                </Pressable>
              </View>
              {!active.circle && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={pingMuted ? "Unmute PING" : "Mute PING"}
                  onPress={() => setPingMuted(!pingMuted)}
                  style={s.iconButton}
                >
                  <MaterialCommunityIcons
                    name={pingMuted ? "bell-off-outline" : "bell-outline"}
                    size={22}
                    color={c.muted}
                  />
                </Pressable>
              )}
            </View>
            <View style={[s.conversationTabs, { borderColor: c.line }]}>
              {["Chat", "Moments"].map((x) => (
                <Pressable
                  key={x}
                  accessibilityRole="button"
                  accessibilityState={{ selected: section === x }}
                  onPress={() => {
                    setSection(x);
                    setStickers(false);
                  }}
                  style={[
                    s.conversationTab,
                    {
                      borderBottomColor: section === x ? c.blue : "transparent",
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={
                      x === "Chat"
                        ? "message-text-outline"
                        : "image-multiple-outline"
                    }
                    size={18}
                    color={section === x ? c.blue : c.muted}
                  />
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      color: section === x ? c.blue : c.muted,
                    }}
                  >
                    {x}
                  </Text>
                </Pressable>
              ))}
            </View>
            {section === "Moments" ? (
              <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={s.momentList}>
                <Pressable accessibilityRole="button" accessibilityLabel="Create Moment" onPress={() => setCreatingMoment(true)} style={{ borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}><MaterialCommunityIcons name="pencil-outline" size={22} color={c.blue} /><Text style={{ flex: 1, color: c.muted, fontSize: 16 }}>Share a moment…</Text><MaterialCommunityIcons name="image-outline" size={22} color={c.muted} /></Pressable>
                <Text style={[s.sub, { color: c.muted }]}>
                  Only shared here, with {active.name}.
                </Text>
                {focusedMoment !== null &&
                  button("All Moments", () => setFocusedMoment(null))}
                {moments.length === 0 && (
                  <Text style={{ color: c.muted }}>
                    No Moments yet. Share a photo or a few words to start this
                    collection.
                  </Text>
                )}
                {moments.map((m, i) => (
                  <View
                    key={`${m}-${i}`}
                    style={[
                      s.moment,
                      {
                        borderColor: c.line,
                        display:
                          focusedMoment !== null && focusedMoment !== i
                            ? "none"
                            : "flex",
                      },
                    ]}
                  >
                    {demo.momentStickers[`${active.id}-${i}`] ? <Artwork artwork={demo.momentStickers[`${active.id}-${i}`]} size={210} /> : momentImage(i) ? <Pressable accessibilityRole="button" accessibilityLabel="Preview Moment image" onPress={() => setViewedPhoto({ uri: momentImage(i)!, caption: m, title: active.name })}><Image source={{ uri: momentImage(i) }} contentFit="cover" style={{ width: '100%', height: 240 }} /></Pressable> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Open Moment"
                      onPress={() => setFocusedMoment(i)}
                    >
                      <Text style={[s.momentCaption, { color: c.text }]}>
                        {m}
                      </Text>
                    </Pressable>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingLeft: 16,
                      }}
                    >
                      <Text style={[s.sub, { color: c.muted, flex: 1 }]}>
                        {demo.name} · Today
                      </Text>
                      <PopupMenu label="Moment options" actions={[{ id: 'reply', label: 'Reply in chat', icon: 'reply', onPress: () => beginMomentReply(m, i) }, { id: 'delete', label: 'Delete Moment', icon: 'trash-can-outline', destructive: true, onPress: () => deleteMoment(i) }]} />
                    </View>
                    <View
                      style={[
                        s.pills,
                        {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderColor: c.line,
                        },
                      ]}
                    >
                      {button(
                        reactions[`${active.id}-${i}`] ? "♥ 2" : "♡ 1",
                        () =>
                          setReactions((old) => ({
                            ...old,
                            [`${active.id}-${i}`]: !old[`${active.id}-${i}`],
                          })),
                      )}

                      {button("Reply", () => beginMomentReply(m, i))}
                    </View>
                  </View>
                ))}
              </ScrollView>
              </KeyboardAvoidingView>
            ) : (
              <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
              >
                <ScrollView
                  ref={chatScroll}
                  onContentSizeChange={() =>
                    { const count = (messages[active.id] ?? getSeed(active.id)).length; if (lastScrolledCount.current !== count) { lastScrolledCount.current = count; chatScroll.current?.scrollToEnd({ animated: false }); } }
                  }
                  contentContainerStyle={s.conversation}
                >
                  <Text style={[s.day, { color: c.muted }]}>Today</Text>
                  {
                    (messages[active.id] ?? getSeed(active.id)).map((m, i) => (
                    <View
                      key={i}
                      onLayout={event => recordMessageLayout(i, event.nativeEvent.layout.y)}
                      style={[
                        s.messageWrap,
                        { alignSelf: m.own ? "flex-end" : "flex-start", borderWidth: 1, borderColor: highlightedMessage === i ? c.blue : "transparent" },
                      ]}
                    >
                      {active.circle && !m.own && (
                        <Text style={[s.sub, { color: c.muted }]}>
                          {m.own
                            ? `${demo.name} · ${demo.status}`
                            : "Mum · Baking something good"}
                        </Text>
                      )}
                      <View style={{ flexDirection: m.own ? 'row-reverse' : 'row', alignItems: 'center', gap: 4 }}>
                      <View
                        style={[
                          s.bubble,
                          { flexShrink: 1 },
                          { backgroundColor: m.stickerArtwork ? "transparent" : m.own ? c.bubble : c.bg },
                        ]}
                      >
                        {m.replyContext && <ReplyCard reply={m.replyContext} onPress={() => openReply(m.replyContext!)} />}
                        {m.stickerArtwork && <Artwork artwork={m.stickerArtwork} size={170} />}
                        {m.image && !m.stickerArtwork && (
                          <Pressable accessibilityRole="button" accessibilityLabel="Preview chat image" onPress={event => { event.stopPropagation(); setViewedPhoto({ uri: m.image!, caption: m.text || undefined, title: active.name }); }}>
                            <Image
                              source={{ uri: m.image }}
                              contentFit="cover"
                              style={{
                                width: 170,
                                height: 180,
                                borderRadius: 6,
                                marginBottom: 8,
                              }}
                            />
                            {m.sticker && (
                              <Text
                                style={{
                                  position: "absolute",
                                  bottom: 16,
                                  alignSelf: "center",
                                  color: "#FFFFFF",
                                  backgroundColor: "#1B2731",
                                  padding: 6,
                                  fontWeight: "700",
                                  fontSize: 18,
                                }}
                              >
                                {m.text}
                              </Text>
                            )}
                          </Pressable>
                        )}
                        {m.reply && (
                          <Text style={{ color: c.muted, marginBottom: 8 }}>
                            ↳ {m.reply}
                          </Text>
                        )}
                        {m.moment && !m.replyContext && (
                          <Text style={{ color: c.blue, marginBottom: 6 }}>
                            ↗ Moment · Tap to open
                          </Text>
                        )}
                        {!m.stickerArtwork && !!m.text && <Text style={{ color: c.text, fontSize: 16, lineHeight: 23 }}>{m.text}</Text>}
                      </View>
                      {!m.own && <View style={{ flexDirection: 'row', flexShrink: 0 }}><Pressable accessibilityRole="button" accessibilityLabel="Reply to message" onPress={() => beginMessageReply(m, i)} style={s.iconButton}><MaterialCommunityIcons name="reply" size={20} color={c.muted} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={m.reaction ? 'Remove message reaction' : 'React to message'} accessibilityState={{ selected: !!m.reaction }} onPress={() => reactToMessage(i)} style={s.iconButton}><MaterialCommunityIcons name={m.reaction ? 'heart' : 'heart-outline'} size={18} color={m.reaction ? c.blue : c.muted} /></Pressable></View>}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: m.own ? 'flex-end' : 'flex-start', gap: 4, marginTop: m.own ? -8 : 0 }}>
                      <Text style={[s.receipt, { color: c.muted }]}>
                        {m.own
                          ? m.failed
                            ? "Not sent · Tap Retry"
                            : "16:42 · Delivered"
                          : "16:41"}
                      </Text>
                      {m.reaction && (
                        <Text style={{ color: c.blue }}>{m.reaction} 1</Text>
                      )}
                      {(m.own || m.failed) && <PopupMenu label="Message options" actions={[...(m.own ? [{ id: 'reply', label: 'Reply', icon: 'reply' as const, onPress: () => beginMessageReply(m, i) }, { id: 'react', label: m.reaction ? 'Remove reaction' : 'React', icon: 'heart-outline' as const, onPress: () => reactToMessage(i) }, { id: 'moment', label: 'Save to Moments', icon: 'image-multiple-outline' as const, onPress: () => saveMessageMoment(m) }] : []), ...(m.failed ? [{ id: 'retry', label: 'Retry message', icon: 'refresh' as const, onPress: () => retryMessage(i) }] : [])]} />}
                      </View>
                    </View>
                  ))}
                </ScrollView>
                <MediaSheet open={attachments} privateChat={!active.circle} onClose={() => setAttachments(false)} onPhoto={(image, caption) => send(caption, false, undefined, image)} onEditPhoto={photo => setPhotoDraft({ photo, destination: "chat" })} onStickers={() => { setAttachments(false); setStickers(true); }} onPing={() => send("PING!")} onBrowse={() => router.push({ pathname: "/flow", params: { view: "media", name: active.name } })} />
                <StickerPicker open={stickers} circle={active.circle ? active.name : undefined} onClose={() => setStickers(false)} onSend={message => { setMessages(old => ({ ...old, [active.id]: [...(old[active.id] ?? getSeed(active.id)), { ...message, replyContext: reply ? { ...reply, stickerArtwork: reply.stickerArtwork ? copySticker(reply.stickerArtwork, reply.stickerArtwork.pack) : undefined } : undefined }] })); setReply(null); }} />
                {reply && <View style={{ flexDirection: 'row', padding: 10, gap: 8, alignItems: 'center', borderTopWidth: .5, borderColor: c.line }}><View style={{ flex: 1 }}><ReplyCard reply={reply} /></View><Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReply(null)} style={s.iconButton}><MaterialCommunityIcons name="close" size={21} color={c.muted} /></Pressable></View>}
                <View style={[s.composer, { borderColor: c.line }]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add attachment"
                    onPress={() => { setStickers(false); setAttachments(!attachments); }}
                    style={s.iconButton}
                  >
                    <MaterialCommunityIcons
                      name="plus"
                      size={25}
                      color={c.muted}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open stickers"
                    onPress={() => { setAttachments(false); setStickers(!stickers); }}
                    style={s.iconButton}
                  >
                    <MaterialCommunityIcons
                      name="emoticon-outline"
                      size={25}
                      color={c.muted}
                    />
                  </Pressable>
                  <TextInput
                    ref={composerRef}
                    accessibilityLabel="Message"
                    placeholder="Say something…"
                    placeholderTextColor={c.muted}
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={() => send(draft)}
                    style={[s.input, { color: c.text, backgroundColor: c.bg }]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                    onPress={() => send(draft)}
                    style={[s.sendButton, { backgroundColor: c.blue }]}
                  >
                    <MaterialCommunityIcons
                      name="send"
                      size={22}
                      color={dark ? "#172027" : "#FFFFFF"}
                    />
                  </Pressable>
                </View>
              </KeyboardAvoidingView>
            )}
          </>
        ) : (
          <>
            <View style={[s.toolbar, { borderColor: c.line }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open your profile"
                onPress={() => setTab("You")}
                style={s.iconButton}
              >
                <MaterialCommunityIcons
                  name="account-circle"
                  size={30}
                  color={c.muted}
                />
              </Pressable>
              <Text style={[s.toolbarTitle, { color: c.text }]}>
                {tab === "Chats" ? "AwsemChat" : tab}
              </Text>
              <Text style={{ fontSize: 10, color: c.muted, marginRight: 8 }}>
                DEMO
              </Text>
              {tab === "Chats" && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Search conversations"
                  onPress={() => setSearchOpen(!searchOpen)}
                  style={s.iconButton}
                >
                  <MaterialCommunityIcons
                    name="magnify"
                    size={25}
                    color={c.text}
                  />
                </Pressable>
              )}
              <PopupMenu label="App options" icon="dots-vertical" actions={[{ id: 'settings', label: 'Settings', icon: 'cog-outline', onPress: () => router.push({ pathname: '/flow', params: { view: 'settings' } }) }, { id: 'requests', label: 'Friend requests', icon: 'account-clock-outline', onPress: () => router.push({ pathname: '/flow', params: { view: 'requests' } }) }]} />
            </View>
            {tab === "Chats" ? (
              <>
                <View style={[s.filters, { borderColor: c.line }]}>
                  {["All", "Private", "Circles"].map((x) => (
                    <Pressable
                      key={x}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filter === x }}
                      onPress={() => setFilter(x)}
                      style={[
                        s.filter,
                        {
                          backgroundColor: filter === x ? c.bubble : c.surface,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: filter === x ? c.blue : c.muted,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {x}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                {searchOpen && (
                  <TextInput
                    autoFocus
                    accessibilityLabel="Search conversations"
                    placeholder="Search name or conversation"
                    placeholderTextColor={c.muted}
                    value={query}
                    onChangeText={setQuery}
                    style={[s.search, { color: c.text, backgroundColor: c.bg }]}
                  />
                )}
                <FlatList
                  data={chats.filter(
                    (x) =>
                      !demo.chatPreferences?.[x.id]?.archived && (filter === "All" ||
                        (filter === "Circles" ? x.circle : !x.circle)) &&
                      x.name.toLowerCase().includes(query.toLowerCase()),
                  ).sort((a, b) => Number(!!demo.chatPreferences?.[b.id]?.pinned) - Number(!!demo.chatPreferences?.[a.id]?.pinned))}
                  keyExtractor={(x) => x.id}
                  ListEmptyComponent={
                    <Text style={[s.empty, { color: c.muted }]}>
                      No matching conversations. Try another name.
                    </Text>
                  }
                  renderItem={({ item }) => (
                      <PopupMenu label={`${item.name} chat options`} icon="dots-vertical" actions={[
                        { id: 'pin', label: demo.chatPreferences?.[item.id]?.pinned ? 'Unpin chat' : 'Pin chat', icon: 'pin-outline', onPress: () => changeChatPreference(item.id, 'pinned') },
                        { id: 'mute', label: demo.chatPreferences?.[item.id]?.muted ? 'Unmute chat' : 'Mute chat', icon: 'bell-off-outline', onPress: () => changeChatPreference(item.id, 'muted') },
                        { id: 'archive', label: 'Archive chat', icon: 'archive-outline', onPress: () => changeChatPreference(item.id, 'archived') },
                      ]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${item.name}`}
                      onPress={() => {
                        setActive(item);
                        setSection("Chat");
                      }}
                      style={[s.row, { borderColor: c.line, width: "100%" }]}
                    >
                      <View style={[s.avatar, { backgroundColor: item.color }]}>
                        <Image
                          source={{
                            uri:
                              item.avatar ||
                              (item.circle
                                ? "https://i.pravatar.cc/120?img=32"
                                : "https://i.pravatar.cc/120?img=12"),
                          }}
                          contentFit="cover"
                          style={{ width: 54, height: 54, borderRadius: 9 }}
                        />
                        {item.circle && (
                          <View
                            style={{
                              position: "absolute",
                              bottom: -2,
                              right: -2,
                              backgroundColor: c.surface,
                              borderRadius: 12,
                              padding: 3,
                            }}
                          >
                            <MaterialCommunityIcons
                              name="account-multiple"
                              size={14}
                              color={c.muted}
                            />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1, gap: 5 }}>
                        <View style={s.rowTop}>
                          <Text style={[s.name, { color: c.text }]}>
                            {item.name}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                            {demo.chatPreferences?.[item.id]?.pinned && <MaterialCommunityIcons accessibilityLabel="Pinned chat" name="pin" size={14} color={c.muted} />}
                            {demo.chatPreferences?.[item.id]?.muted && <MaterialCommunityIcons accessibilityLabel="Muted chat" name="bell-off-outline" size={15} color={c.muted} />}
                            <Text style={[s.sub, { color: c.muted }]}>{item.time}</Text>
                          </View>
                        </View>
                        <Text
                          numberOfLines={1}
                          style={[s.sub, { color: c.muted }]}
                        >
                          {item.status}
                        </Text>
                        <View style={s.rowTop}>
                          <Text
                            numberOfLines={1}
                            style={{ color: c.text, flex: 1 }}
                          >
                            {item.preview}
                          </Text>
                          {item.unread > 0 && (
                            <View
                              style={[s.count, { backgroundColor: c.blue }]}
                            >
                              <Text
                                style={{
                                  color: dark ? "#172027" : "#FFFFFF",
                                  fontWeight: "700",
                                }}
                              >
                                {item.unread}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                    </Pressable>
                    </PopupMenu>
                  )}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Start a conversation"
                  onPress={() =>
                    router.push({
                      pathname: "/flow",
                      params: { view: "new-chat" },
                    })
                  }
                  style={[s.fab, { backgroundColor: c.blue }]}
                >
                  <MaterialCommunityIcons
                    name="message-plus"
                    size={27}
                    color={dark ? "#172027" : "#FFFFFF"}
                  />
                </Pressable>
              </>
            ) : tab === "Friends" ? (
              Platform.OS !== "web" ? <NativeFriends /> : <ScrollView contentContainerStyle={{ paddingHorizontal: s.row.paddingHorizontal, paddingVertical: 12, gap: 10 }}>
                {menuRow("Friend requests", "account-clock-outline", () =>
                  router.push({
                    pathname: "/flow",
                    params: { view: "requests" },
                  }),
                )}
                {menuRow(
                  "Create a Circle",
                  "account-multiple-plus-outline",
                  () =>
                    router.push({
                      pathname: "/flow",
                      params: { view: "circle" },
                    }),
                )}
                <Text style={[s.name, { color: c.text }]}>
                  Add someone by PIN
                </Text>
                <TextInput
                  accessibilityLabel="Friend PIN"
                  value={pin}
                  onChangeText={setPin}
                  placeholder="Enter their PIN"
                  placeholderTextColor={c.muted}
                  autoCapitalize="characters"
                  style={[s.input, { backgroundColor: c.bg, color: c.text }]}
                />
                {button(
                  "Send friend request",
                  () => {
                    if (!pin.trim()) return setNotice("Enter a PIN first.");
                    updateDemo({
                      outgoing: [
                        ...new Set([...demo.outgoing, pin.toUpperCase()]),
                      ],
                    });
                    setNotice(
                      "Friend request sent in demo. Chat opens after acceptance.",
                    );
                    setPin("");
                  },
                  true,
                )}
                {demo.outgoing.map((request) => (
                  <Text key={request} style={{ color: c.muted }}>
                    {request} · Request pending
                  </Text>
                ))}
                <TextInput accessibilityLabel="Search friends" placeholder="Search friends" placeholderTextColor={c.muted} value={friendQuery} onChangeText={setFriendQuery} style={[s.input, { flex: undefined, color: c.text, backgroundColor: c.bg }]} />
                {!chats.some(x => !x.circle && x.name.toLowerCase().includes(friendQuery.trim().toLowerCase())) && <Text style={{ color: c.muted, paddingVertical: 12 }}>No friends match your search.</Text>}
                {chats
                  .filter((x) => !x.circle && x.name.toLowerCase().includes(friendQuery.trim().toLowerCase()))
                  .map((x) => (
                    <Pressable
                      key={x.id}
                      accessibilityRole="button"
                      onPress={() => {
                        setActive(x);
                        setSection("Chat");
                      }}
                      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line }}
                    >
                      <View style={[s.avatar, { width: 44, height: 44, borderRadius: 7, backgroundColor: x.color }]}>
                        <Image
                          source={{
                            uri: x.avatar || "https://i.pravatar.cc/120?img=12",
                          }}
                          style={{ width: 44, height: 44, borderRadius: 7 }}
                        />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{x.name}</Text><Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>{x.status}</Text></View>
                    </Pressable>
                  ))}
              </ScrollView>
            ) : (
              <ScrollView contentContainerStyle={s.settings}>
                <View
                  style={{ alignItems: "center", paddingVertical: 16, gap: 10 }}
                >
                  <Image
                    source={{
                      uri: demo.avatar ?? "https://i.pravatar.cc/160?img=11",
                    }}
                    style={{ width: 88, height: 88, borderRadius: 14 }}
                  />
                  <Text
                    style={{ fontSize: 23, fontWeight: "600", color: c.text }}
                  >
                    {demo.name}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 14 }}>
                    {demo.status}
                  </Text>
                  <Text style={{ color: c.muted, fontSize: 12 }}>
                    PIN · AW5EM42
                  </Text>
                </View>
                {menuRow("Settings & profile", "cog-outline", () =>
                  router.push({
                    pathname: "/flow",
                    params: { view: "settings" },
                  }),
                )}
                {menuRow("Appearance", "palette-outline", () =>
                  router.push({
                    pathname: "/flow",
                    params: { view: "appearance" },
                  }),
                )}
                {menuRow("Your PIN", "qrcode", () =>
                  router.push({ pathname: "/flow", params: { view: "pin" } }),
                )}
                {menuRow("Your stickers", "sticker-emoji", () =>
                  router.push({
                    pathname: "/stickers",
                    params: { mode: "library" },
                  }),
                )}
              </ScrollView>
            )}
            <View
              style={[
                s.nav,
                { borderColor: c.line, backgroundColor: c.surface },
              ]}
            >
              {["Chats", "Friends", "You"].map((x) => (
                <Pressable
                  key={x}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === x }}
                  onPress={() => {
                    setTab(x);
                  }}
                  accessibilityLabel={x}
                  style={s.navItem}
                >
                  <MaterialCommunityIcons
                    name={
                      x === "Chats"
                        ? "message-text"
                        : x === "Friends"
                          ? "account-multiple"
                          : "account-circle"
                    }
                    size={25}
                    color={tab === x ? c.blue : c.muted}
                  />
                  <Text
                    style={{
                      color: tab === x ? c.blue : c.muted,
                      fontSize: 11,
                      fontWeight: tab === x ? "600" : "400",
                    }}
                  >
                    {x}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
      {active && <Modal visible={creatingMoment && !photoDraft} animationType="slide" onRequestClose={() => setCreatingMoment(false)}><SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
        <View style={[s.composer, { borderColor: c.line }]}><Pressable accessibilityRole="button" accessibilityLabel="Close Moment composer" onPress={() => setCreatingMoment(false)} style={s.iconButton}><MaterialCommunityIcons name="close" size={24} color={c.text} /></Pressable><Text style={{ flex: 1, fontSize: 20, fontWeight: '600', color: c.text }}>Create Moment</Text><Pressable accessibilityRole="button" accessibilityLabel="Post Moment" disabled={!momentDraft.trim()} accessibilityState={{ disabled: !momentDraft.trim() }} onPress={() => { setMoments([...moments, momentDraft.trim()]); setMomentDraft(''); setCreatingMoment(false); setNotice('Moment shared.'); }} style={{ padding: 12, opacity: momentDraft.trim() ? 1 : .4 }}><Text style={{ color: c.blue, fontWeight: '600', fontSize: 16 }}>Post</Text></Pressable></View>
        <Text style={{ padding: 20, color: c.muted }}>Only shared with {active.name}</Text><TextInput autoFocus multiline accessibilityLabel="New Moment caption" placeholder="What would you like to share?" placeholderTextColor={c.muted} value={momentDraft} onChangeText={setMomentDraft} style={{ padding: 20, color: c.text, fontSize: 20, minHeight: 180, textAlignVertical: 'top' }} /><Pressable accessibilityRole="button" accessibilityLabel="Add photo Moment" onPress={addMomentPhoto} style={{ padding: 20, flexDirection: 'row', gap: 12, alignItems: 'center', borderTopWidth: 1, borderColor: c.line }}><MaterialCommunityIcons name="image-outline" size={24} color={c.blue} /><Text style={{ color: c.text, fontSize: 16 }}>Add photo</Text></Pressable>
      </SafeAreaView></Modal>}
      {active && photoDraft && <PhotoEditor key={photoDraft.photo.uri} photo={photoDraft.photo} initialCaption={photoDraft.destination === "moment" ? momentDraft : ""} sendLabel={photoDraft.destination === 'moment' ? 'Share Moment' : 'Send photo'} onClose={() => setPhotoDraft(null)} onSend={(uri, caption) => { if (photoDraft.destination === 'chat') send(caption, false, undefined, uri); else { updateDemo({ moments: { ...demo.moments, [active.id]: [...moments, caption] }, momentImages: { ...demo.momentImages, [`${active.id}-${moments.length}`]: uri } }); setMomentDraft(''); setCreatingMoment(false); setNotice('Moment shared.'); } setPhotoDraft(null); }} />}
      {viewedPhoto && <PhotoViewer photo={viewedPhoto} onClose={() => setViewedPhoto(null)} />}
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  conversationTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  conversationTab: {
    flex: 1,
    minHeight: 46,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: 2,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 58,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  toolbar: {
    height: 62,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarTitle: { flex: 1, fontSize: 20, fontWeight: "600", marginLeft: 8 },
  iconButton: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  filters: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filter: {
    paddingHorizontal: 22,
    height: 32,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  fab: {
    position: "absolute",
    bottom: 84,
    right: 22,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 3px 7px #00000030",
    elevation: 4,
  },
  navItem: {
    flex: 1,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  safe: { flex: 1 },
  app: { flex: 1, width: "100%", maxWidth: 600, alignSelf: "center" },
  demo: { padding: 10, alignItems: "center" },
  header: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
  },
  titleBlock: { flex: 1, gap: 5 },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3 },
  sub: { fontSize: 13, lineHeight: 19 },
  pills: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexWrap: "wrap",
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  search: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 6,
    minHeight: 48,
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  rowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center",
  },
  name: { fontSize: 16, fontWeight: "600" },
  count: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: { padding: 20, textAlign: "center", fontSize: 12 },
  nav: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  back: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  conversation: { padding: 14, gap: 14, flexGrow: 1 },
  day: { textAlign: "center", fontSize: 12, marginBottom: 10 },
  messageWrap: { maxWidth: "100%", gap: 4 },
  bubble: { padding: 11, borderRadius: 12 },
  receipt: { fontSize: 11, textAlign: "right" },
  composer: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
  },
  input: { minHeight: 48, padding: 12, borderRadius: 6, flex: 1, fontSize: 16 },
  stickerTray: { paddingBottom: 10 },
  settings: { padding: 20, gap: 18 },
  momentList: { padding: 18, gap: 18 },
  moment: { borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  album: {
    minHeight: 210,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
    padding: 0,
  },
  albumIcon: { fontSize: 60 },
  momentCaption: { fontSize: 20, fontWeight: "600", padding: 16 },
  empty: { padding: 30, textAlign: "center" },
});
