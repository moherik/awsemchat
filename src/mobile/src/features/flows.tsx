import Icon from "@expo/vector-icons/MaterialCommunityIcons";
import { dismissFeedback, showFeedback as setNotice } from "./feedback/snackbar";
import { PhotoViewer, type ViewedPhoto } from "./photos/viewer";
import { getSeed, sampleChats } from "./sample-data";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import { Host, Switch } from "@expo/ui";
import { useState } from "react";
import { PopupMenu } from "./popup-menu";
import { View, Text, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Page, Action, Copy, Field, rowStyles, usePalette } from "./ui";
import {
  updateDemo,
  useDemo,
  createDemoBackup,
  restoreDemoBackup,
} from "./demo-store";
const titles: Record<string, string> = {
  appearance: "Appearance",
  "new-chat": "New conversation",
  welcome: "Welcome to AwsemChat",
  phone: "Your phone number",
  verify: "Verify your number",
  profile: "Your profile",
  settings: "Settings",
  archived: "Archived chats",
  privacy: "Privacy & safety",
  backup: "Backup & restore",
  restore: "Restore your chats",
  music: "Now Playing",
  requests: "Friend requests",
  pin: "Your PIN",
  circle: "Create a Circle",
  members: "Circle details",
  "invite-friends": "Invite friends",
  stickers: "Your stickers",
  editor: "Create a sticker",
  report: "Report a conversation",
  notifications: "Notifications",
  security: "Conversation security",
  conversation: "Conversation details",
  media: "Shared media",
  "group-stickers": "Circle stickers & emoji",
  recovery: "Recovery key",
};
export default function Flows() {
  const { view: raw, name } = useLocalSearchParams<{
    view: string;
    name?: string;
  }>();
  const screen = raw ?? "settings";
  const demo = useDemo();
  const c = usePalette();
  const [viewedMedia, setViewedMedia] = useState<ViewedPhoto | null>(null);
  const mediaChatId = demo.circles.find(x => x.name === name)?.id ?? sampleChats.find(x => x.name === name)?.id ?? `circle-${name}`;
  const sharedPhotos = (demo.messages[mediaChatId] ?? getSeed(mediaChatId)).filter(x => x.image && !x.stickerArtwork);
  const currentCircle = demo.circles.find(x => x.name === name);
  const [description, setDescription] = useState(currentCircle?.description ?? "");
  const [input, setInput] = useState(
    screen === "profile" ? demo.name : screen === "phone" ? demo.phone : screen === "members" ? currentCircle?.name ?? "" : "",
  );
  const [status, setStatus] = useState(demo.status);
  const [friendSearch, setFriendSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  
  const [reportReason, setReportReason] = useState("");
  const [step, setStep] = useState(0);
  const [caption, setCaption] = useState("");
  const [photo, setPhoto] = useState<string | null>(
    screen === "profile" ? demo.avatar : screen === "members" ? currentCircle?.avatar ?? sampleChats.find(x => x.name === name)?.avatar ?? null : null,
  );
  const pickPhoto = async () => {
    const feedback = setNotice("Opening your photos…", 0);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled) setPhoto(result.assets[0].uri);
    } catch {
      setNotice("Could not open your photos. Try again.");
    } finally { dismissFeedback(feedback); }
  };
  const go = (next: string) =>
    router.push(next === "stickers" || next === "editor" ? { pathname: "/stickers", params: { mode: next === "editor" ? "maker" : "library", circle: name } } : { pathname: "/flow", params: { view: next, name } });
  const toggle = (name: string) =>
    setSelected((old) =>
      old.includes(name) ? old.filter((x) => x !== name) : [...old, name],
    );
  return (
    <Page title={titles[screen] ?? "AwsemChat"} compact={screen === "new-chat"}>
      {screen === "appearance" && (
        <>
          <Copy muted>Choose how AwsemChat looks on this device.</Copy>
          {(["system", "light", "dark"] as const).map((theme) => (
            <Action
              key={theme}
              label={`${demo.theme === theme ? "✓ " : ""}${theme === "system" ? "Use device theme" : theme === "light" ? "Light" : "Dark"}`}
              onPress={() => updateDemo({ theme })}
            />
          ))}
        </>
      )}
      {screen === "new-chat" && (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Create a Circle" onPress={() => go("circle")} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: c.line }}><View style={{ width: 44, height: 44, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Icon name="account-multiple-plus-outline" size={25} color={c.accent} /></View><Text style={{ flex: 1, fontSize: 16, color: c.text }}>Create a Circle</Text><Icon name="chevron-right" size={22} color={c.muted} /></Pressable>
          <Field label="Search accepted friends" value={friendSearch} onChange={setFriendSearch} />
          <Copy muted>Accepted friends</Copy>
          {!demo.friends.some((friend, i) => !demo.blocked.includes(friend) && `${friend} ${['NAYA47', 'RAKA12', 'SARI21', 'BIMA22', 'AYU23'][i] ?? ''}`.toLowerCase().includes(friendSearch.trim().toLowerCase())) && <Copy muted>No friends match your search.</Copy>}
          {demo.friends
            .filter((friend, i) => !demo.blocked.includes(friend) && `${friend} ${["NAYA47", "RAKA12", "SARI21", "BIMA22", "AYU23"][i] ?? ""}`.toLowerCase().includes(friendSearch.trim().toLowerCase()))
            .map((friend) => {
              const chat = sampleChats.find(item => item.name === friend);
              const friendIndex = demo.friends.indexOf(friend);
              const pin = ['NAYA47', 'RAKA12', 'SARI21', 'BIMA22', 'AYU23'][friendIndex];
              return <Pressable key={friend} accessibilityRole="button" accessibilityLabel={`Chat with ${friend}`} onPress={() => router.push({ pathname: '/chat', params: { chat: chat?.id ?? friend } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.line }}>
                {chat?.avatar ? <Image source={{ uri: chat.avatar }} style={{ width: 44, height: 44, borderRadius: 7 }} /> : <View style={{ width: 44, height: 44, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.accent, fontSize: 20 }}>{friend.charAt(0)}</Text></View>}
                <View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{friend}</Text><Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>{chat?.status ?? ({ Sari: 'Back in the garden', Bima: 'See you at the weekend', Ayu: 'A little more offline' } as Record<string, string>)[friend] ?? 'No status set'}</Text><Text style={{ color: c.muted, fontSize: 12 }}>PIN · {pin ?? 'Not available'}</Text></View>
              </Pressable>;
            })}
        </>
      )}
      {screen === "welcome" && (
        <>
          <Text
            style={{
              color: c.text,
              fontSize: 34,
              fontWeight: "700",
              lineHeight: 42,
            }}
          >
            A space for{"\n"}your people.
          </Text>
          <Copy>
            Private conversations and little moments with friends and family. At
            your own pace.
          </Copy>
          <Copy muted>
            No typing indicators. No online status. No read receipts.
          </Copy>
          <Action label="Get started" primary onPress={() => go("phone")} />
          <Action
            label="Explore sample conversations"
            onPress={() => router.replace("/")}
          />
        </>
      )}
      {screen === "phone" && (
        <>
          <Copy>
            Your number is used to sign in. Friends connect with your PIN and
            won’t see your phone number.
          </Copy>
          <Field
            label="Phone number with country code"
            value={input}
            onChange={setInput}
          />
          <Action
            label="Continue"
            primary
            onPress={() => {
              if (!/^\+\d{8,15}$/.test(input.replace(/\s/g, "")))
                setNotice(
                  "Enter a valid number, including + and country code.",
                );
              else {
                updateDemo({ phone: input });
                go("verify");
              }
            }}
          />
          <Copy muted>This demo sends no SMS.</Copy>
        </>
      )}
      {screen === "verify" && (
        <>
          <Copy>
            Enter the six-digit code for {demo.phone || "your phone"}. Demo
            code: 123456.
          </Copy>
          <Field label="Verification code" value={input} onChange={setInput} />
          <Action
            label="Verify"
            primary
            onPress={() =>
              input === "123456"
                ? go("profile")
                : setNotice(
                    "That code does not match. Try 123456 in this demo.",
                  )
            }
          />
          <Action
            label="Resend code"
            onPress={() =>
              setNotice("Demo code is still 123456. No SMS was sent.")
            }
          />
          <Action label="Change number" onPress={() => go("phone")} />
        </>
      )}
      {screen === "profile" && (
        <>
          <View
            style={{
              height: 100,
              width: 100,
              backgroundColor: c.accent,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <>
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={{ width: 100, height: 100, borderRadius: 16 }}
                />
              ) : (
                <Text style={{ fontSize: 40, color: "#FFFFFF" }}>
                  {input.charAt(0).toUpperCase() || "Y"}
                </Text>
              )}
            </>
          </View>
          <Action label="Choose profile photo" onPress={pickPhoto} />
          <Field label="Display name" value={input} onChange={setInput} />
          <Field label="Text status" value={status} onChange={setStatus} />
          <Copy muted>
            Your latest status appears below your name in Circles.
          </Copy>
          <Action
            label="Save profile"
            primary
            onPress={() => {
              if (!input.trim()) return setNotice("Add a display name.");
              updateDemo({ name: input.trim(), status, avatar: photo });
              router.replace("/");
            }}
          />
          <Action
            label="Restore an existing backup"
            onPress={() => go("restore")}
          />
        </>
      )}
      {screen === "settings" && (
        <>
          {[
            ["Edit profile", "profile"],
            ["Archived chats", "archived"],
            ["Your PIN", "pin"],
            ["Notifications", "notifications"],
            ["Privacy & safety", "privacy"],
            ["Backup & restore", "backup"],
            ["Now Playing", "music"],
            ["Personal stickers", "stickers"],
            ["Try onboarding", "welcome"],
          ].map(([label, next]) => (
            <Action key={next} label={label} onPress={() => go(next)} />
          ))}
        </>
      )}
      {screen === "archived" && (
        <>
          {!Object.values(demo.chatPreferences ?? {}).some(value => value.archived) && <Copy>No archived chats.</Copy>}
          {Object.entries(demo.chatPreferences ?? {}).filter(([, value]) => value.archived).map(([id]) => {
            const circle = demo.circles.find(value => value.id === id);
            const chat = sampleChats.find(value => value.id === id);
            const chatName = circle?.name ?? chat?.name ?? id;
            return <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Open ${chatName}`} onPress={() => router.push({ pathname: '/chat', params: { chat: id } })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{circle?.avatar || chat?.avatar ? <Image source={{ uri: circle?.avatar ?? chat?.avatar }} style={{ width: 44, height: 44 }} /> : <Text style={{ color: c.text }}>{chatName.slice(0, 1)}</Text>}</View>
                <Text style={{ color: c.text, fontSize: 16, flex: 1 }}>{chatName}</Text>
              </Pressable>
              <PopupMenu label={`${chatName} archive options`} actions={[{ id: 'unarchive', label: 'Unarchive chat', icon: 'archive-arrow-up-outline', onPress: () => { updateDemo({ chatPreferences: { ...demo.chatPreferences, [id]: { ...demo.chatPreferences?.[id], archived: false } } }); setNotice('Chat unarchived.'); } }]} />
            </View>;
          })}
        </>
      )}
      {screen === "pin" && (
        <>
          <Copy>Share this PIN with someone you want to chat with.</Copy>
          <Text
            selectable
            style={{
              fontSize: 36,
              fontWeight: "700",
              letterSpacing: 4,
              color: c.accent,
            }}
          >
            AW5EM42
          </Text>
          <Copy>
            They’ll send a friend request. You decide whether to accept.
          </Copy>
          <Action
            label="Copy PIN"
            onPress={async () => {
              try {
                await Clipboard.setStringAsync("AW5EM42");
                setNotice("PIN copied.");
              } catch {
                setNotice("Select the PIN above to copy it.");
              }
            }}
          />
        </>
      )}
      {screen === "requests" && (
        <>
          <Copy>Accept a request to open private chat.</Copy>
          {demo.requests.length === 0 && (
            <Copy muted>No pending requests. Share your PIN to connect.</Copy>
          )}
          {demo.requests.map(name => <View key={name} style={{ flexDirection: 'row', gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: c.line }}>
            <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.accent, fontSize: 22, fontWeight: '600' }}>{name.charAt(0)}</Text></View>
            <View style={{ flex: 1, gap: 8 }}><Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{name}</Text><Text style={{ color: c.muted, fontSize: 13 }}>Wants to connect · Demo request</Text><View style={{ flexDirection: 'row', gap: 8 }}>{['Accept', 'Decline'].map(action => <Pressable key={action} accessibilityRole="button" accessibilityLabel={`${action} ${name}`} onPress={() => { updateDemo({ ...(action === 'Accept' ? { friends: [...new Set([...demo.friends, name])] } : {}), requests: demo.requests.filter(x => x !== name) }); setNotice(action === 'Accept' ? `${name} added to friends.` : 'Request declined.'); }} style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 6, backgroundColor: action === 'Accept' ? c.accent : c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: action === 'Accept' ? c.surface : c.text, fontWeight: '600' }}>{action}</Text></Pressable>)}</View></View>
          </View>)}
        </>
      )}
      {screen === "circle" && (
        <>
          <Field label="Circle name" value={input} onChange={setInput} />
          <Copy>Invite accepted friends · {selected.length + 1}/20 people</Copy>
          {demo.friends.map((friend, i) => <Pressable key={friend} accessibilityRole="checkbox" accessibilityLabel={`Invite ${friend}`} accessibilityState={{ checked: selected.includes(friend) }} onPress={() => toggle(friend)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderColor: c.line }}><Image source={{ uri: sampleChats.find(x => x.name === friend)?.avatar ?? `https://i.pravatar.cc/120?img=${i + 20}` }} style={{ width: 46, height: 46, borderRadius: 7 }} /><View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 16 }}>{friend}</Text><Text style={{ color: c.muted, marginTop: 4 }}>PIN · {['NAYA47','RAKA12','SARI21','BIMA22','AYU23'][i]}</Text></View><Text style={{ color: c.accent, fontSize: 22 }}>{selected.includes(friend) ? '☑' : '☐'}</Text></Pressable>)}
          <Copy muted>
            New members can only see messages and Moments shared after they
            join.
          </Copy>
          <Action
            label="Create Circle"
            primary
            onPress={() => {
              if (!input.trim() || !selected.length)
                return setNotice(
                  "Name your Circle and select at least one friend.",
                );
              updateDemo({
                circles: [
                  ...demo.circles,
                  { id: `circle-${Date.now()}`, name: input.trim(), members: [demo.name, ...selected] },
                ],
              });
              setNotice(`${input} created. Invitations are simulated.`);
            }}
          />

        </>
      )}
      {screen === "members" && currentCircle && !currentCircle.left && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Change Circle avatar" onPress={pickPhoto} style={{ alignSelf: 'center', alignItems: 'center', gap: 10 }}>{photo ? <Image source={{ uri: photo }} style={{ width: 96, height: 96, borderRadius: 15 }} /> : <View style={{ width: 96, height: 96, borderRadius: 15, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text, fontSize: 28 }}>{input.slice(0, 2)}</Text></View>}<Text style={{ color: c.accent }}>Change photo</Text></Pressable>
        <Field label="Circle name" value={input} onChange={setInput} />
        <Field label="Description" value={description} onChange={setDescription} />
        <Action label="Save changes" primary onPress={() => { if (!input.trim()) return setNotice('Enter a Circle name.'); if (demo.circles.some(x => x !== currentCircle && x.name === input.trim())) return setNotice('A Circle already uses that name.'); updateDemo({ customEmoji: { ...demo.customEmoji, [input.trim()]: demo.customEmoji[currentCircle.name] ?? [] }, groupStickers: { ...demo.groupStickers, [input.trim()]: demo.groupStickers[currentCircle.name] ?? [] }, circles: demo.circles.map(x => x === currentCircle ? { ...x, name: input.trim(), description: description.trim(), avatar: photo } : x) }); router.setParams({ name: input.trim() }); setNotice('Circle updated.'); }} />
        <Action label="Manage Group stickers" onPress={() => router.push({ pathname: "/stickers", params: { mode: "circle", circle: name } })} />
        <Copy>Members · {currentCircle.members.length}/20</Copy>
        {currentCircle.members.map((member, i) => <View key={member} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}><View style={{ width: 40, height: 40, borderRadius: 6, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text }}>{member.slice(0, 1)}</Text></View><View style={{ flex: 1 }}><Text style={{ color: c.text, fontSize: 16 }}>{member}</Text><Text style={{ color: c.muted }}>{i === 0 ? 'Admin' : 'Member'}</Text></View>{i > 0 && <PopupMenu label={`${member} options`} actions={[{ id: 'remove', label: 'Remove member', destructive: true, onPress: () => { updateDemo({ circles: demo.circles.map(x => x === currentCircle ? { ...x, members: x.members.filter(n => n !== member) } : x) }); setNotice(`${member} removed.`); } }]} />}</View>)}
        <Action label="Invite friends" onPress={() => go('invite-friends')} />
        <Action label="Leave Circle" onPress={() => { updateDemo({ circles: demo.circles.map(x => x === currentCircle ? { ...x, left: true, members: x.members.filter(n => n !== demo.name) } : x) }); router.replace('/'); setNotice('You left the Circle.'); }} />
      </>}
      {screen === "invite-friends" && currentCircle && !currentCircle.left && <>
        <Copy>{currentCircle.name} · {currentCircle.members.length}/20 members</Copy>
        <Field label="Search friends" value={friendSearch} onChange={setFriendSearch} />
        <Copy muted>{selected.length} selected · {20 - currentCircle.members.length} spaces available</Copy>
        {demo.friends.filter(friend => !currentCircle.members.includes(friend) && friend.toLowerCase().includes(friendSearch.toLowerCase())).map(friend => <Pressable key={friend} accessibilityRole="checkbox" accessibilityLabel={`Invite ${friend}`} accessibilityState={{ checked: selected.includes(friend) }} onPress={() => { if (!selected.includes(friend) && selected.length >= 20 - currentCircle.members.length) return setNotice('You have selected all available spaces.'); toggle(friend); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12, borderBottomWidth: 1, borderColor: c.line }}><View style={{ width: 42, height: 42, borderRadius: 7, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: c.text }}>{friend.slice(0, 1)}</Text></View><Text style={{ flex: 1, color: c.text, fontSize: 16 }}>{friend}</Text><Text style={{ color: c.accent, fontSize: 22 }}>{selected.includes(friend) ? '☑' : '☐'}</Text></Pressable>)}
        {!demo.friends.some(friend => !currentCircle.members.includes(friend) && friend.toLowerCase().includes(friendSearch.toLowerCase())) && <Copy muted>{friendSearch ? 'No friends match your search.' : 'All your accepted friends are already in this Circle.'}</Copy>}
        <Action label={`Invite selected friends (${selected.length})`} primary onPress={() => { const invited = selected.filter(friend => demo.friends.includes(friend) && !currentCircle.members.includes(friend)); if (!invited.length) return setNotice('Select friends to invite.'); if (currentCircle.members.length + invited.length > 20) return setNotice('This selection exceeds the Circle limit.'); updateDemo({ circles: demo.circles.map(x => x === currentCircle ? { ...x, members: [...x.members, ...invited] } : x) }); setSelected([]); router.back(); setNotice(`${invited.length} friends added. Invitations are simulated.`); }} />
      </>}
      {screen === "notifications" && (
        <>
          <Host
            matchContents
            seedColor={c.accent}
            colorScheme={demo.theme === "system" ? undefined : demo.theme}
          >
            <Switch
              label="Message alerts"
              value={demo.notifications}
              onValueChange={(value) => updateDemo({ notifications: value })}
            />
          </Host>
          <Copy muted>
            PING alerts can be muted separately in each private chat. Silent
            mode and Do Not Disturb are respected in the connected app.
          </Copy>
        </>
      )}
      {screen === "privacy" && (
        <>
          <Copy>
            Phone numbers stay out of profiles. There are no read receipts,
            online indicators, or typing indicators.
          </Copy>
          <Action
            label="Conversation security"
            onPress={() => go("security")}
          />
          <Copy>Blocked people</Copy>
          {demo.blocked.length === 0 && <Copy muted>No blocked people.</Copy>}
          {demo.blocked.map((name) => (
            <Action
              key={name}
              label={`Unblock ${name}`}
              onPress={() =>
                updateDemo({ blocked: demo.blocked.filter((x) => x !== name) })
              }
            />
          ))}
          {demo.friends
            .filter((name) => !demo.blocked.includes(name))
            .map((name) => (
              <Action
                key={name}
                label={`Block ${name} in demo`}
                onPress={() => updateDemo({ blocked: [...demo.blocked, name] })}
              />
            ))}
          <Action label="Report a conversation" onPress={() => go("report")} />
        </>
      )}
      {screen === "report" && (
        <>
          <Copy>
            Reports share only messages you explicitly select. This demo does
            not submit anything.
          </Copy>
          {["Spam", "Harassment", "Something else"].map((reason) => (
            <Action
              key={reason}
              label={`${reportReason === reason ? "✓ " : ""}${reason}`}
              onPress={() => setReportReason(reason)}
            />
          ))}
          <Copy>Select messages to include</Copy>
          {["Sample: Hello there", "Sample: Unwanted message"].map(
            (message) => (
              <Action
                key={message}
                label={`${selected.includes(message) ? "✓ " : ""}${message}`}
                onPress={() => toggle(message)}
              />
            ),
          )}
          <Field label="Additional details" value={input} onChange={setInput} />
          <Action
            label="Review report"
            primary
            onPress={() =>
              reportReason ? setStep(1) : setNotice("Choose a reason first.")
            }
          />
          {step === 1 && (
            <>
              <Copy>
                Reason: {reportReason}. Details: {input || "None"}. Selected
                messages:{" "}
                {selected.filter((item) => item.startsWith("Sample:")).length}.
              </Copy>
              <Action
                label="Submit sample report"
                onPress={() => {
                  setNotice(
                    "Demo report recorded locally. Nothing was shared.",
                  );
                  setStep(0);
                }}
              />
            </>
          )}
        </>
      )}
      {screen === "conversation" && (
        <>
          <Copy>{name ?? "Your friend"}</Copy>
          <Action label="Shared media" onPress={() => go("media")} />
          <Action label="Verify encryption" onPress={() => go("security")} />
          <Action label="Report conversation" onPress={() => go("report")} />
          <Action
            label="Unfriend in demo"
            onPress={() => {
              if (name) {
                updateDemo({ friends: demo.friends.filter((x) => x !== name) });
                router.replace("/");
              }
            }}
          />
          <Action
            label="Block this person"
            onPress={() => {
              if (name) {
                updateDemo({ blocked: [...demo.blocked, name] });
                router.replace("/");
              }
            }}
          />
          <Copy muted>
            Blocking private chat does not remove someone from a shared Circle.
          </Copy>
        </>
      )}
      {screen === "media" && <>
        <Copy>Photos and GIFs · {sharedPhotos.length}</Copy>
        {!sharedPhotos.length && <Copy muted>No photos or GIFs shared yet. Images you send in this conversation will appear here.</Copy>}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{sharedPhotos.map((item, i) => <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Preview shared image ${i + 1}`} onPress={() => setViewedMedia({ uri: item.image!, caption: item.text || undefined, title: name ?? 'Shared media' })} style={{ width: '32%', aspectRatio: 1 }}><Image source={{ uri: item.image }} contentFit="cover" style={{ width: '100%', height: '100%', borderRadius: 4 }} /></Pressable>)}</View>
        {viewedMedia && <PhotoViewer photo={viewedMedia} onClose={() => setViewedMedia(null)} />}
      </>}
      {screen === "security" && (
        <>
          <Copy>
            The production app will encrypt messages, Moments, and media end to
            end.
          </Copy>
          <Copy muted>
            This demo uses local sample data. Encryption and identity
            verification are not connected yet.
          </Copy>
          <Action
            label="View sample verification code"
            onPress={() =>
              setNotice(
                "Sample only: 4821 7306 9914 2850. Not a real identity fingerprint.",
              )
            }
          />
        </>
      )}
      {screen === "music" && (
        <>
          <Copy>
            Let accepted friends see what you’re listening to, below your
            private chat profile.
          </Copy>
          <Copy muted>
            On Android, the connected app will request notification access to
            read active music sessions. Android grants a broad permission;
            AwsemChat will only use music metadata. No system permission is
            requested by this demo.
          </Copy>
          <Action
            label={demo.music ? "Pause demo sharing" : "Enable demo sharing"}
            primary
            onPress={() => updateDemo({ music: !demo.music })}
          />
          <Copy>
            {demo.music
              ? "Sample playing: Sunset Lover · Petit Biscuit"
              : "Sharing is paused."}
          </Copy>
        </>
      )}
      {screen === "backup" && (
        <>
          <Copy>
            Recover your conversations on a replacement phone with your separate
            recovery key.
          </Copy>
          <Copy muted>
            Provider access and encrypted archives are simulated here. No Drive
            account is connected.
          </Copy>
          <Action label="Set recovery key" onPress={() => go("recovery")} />
          <Copy>Automatic backup</Copy>
          <View style={rowStyles.row}>
            {["Off", "Daily", "Weekly"].map((schedule) => (
              <Action
                key={schedule}
                label={`${demo.schedule === schedule ? "✓ " : ""}${schedule}`}
                onPress={() => updateDemo({ schedule })}
              />
            ))}
          </View>
          <Copy>Latest sample backup: {demo.backup ?? "None yet"}</Copy>
          <Action
            label="Back up to Google Drive (demo)"
            primary
            onPress={() => {
              createDemoBackup();
              setNotice("Sample backup created. No data was uploaded.");
            }}
          />
          <Action
            label="Export local backup (demo)"
            onPress={() => {
              createDemoBackup();
              setNotice(
                "Sample local archive prepared. Real encrypted file export is not connected.",
              );
            }}
          />
          <Action label="Restore backup" onPress={() => go("restore")} />
        </>
      )}
      {screen === "recovery" && (
        <>
          <Copy>
            Your recovery key unlocks your backup. Keep it somewhere safe; phone
            verification cannot replace it.
          </Copy>
          <Field
            label="Recovery key"
            value={input}
            onChange={setInput}
            secure
          />
          <Field
            label="Confirm recovery key"
            value={caption}
            onChange={setCaption}
            secure
          />
          <Action
            label="Save demo recovery key"
            primary
            onPress={() => {
              if (input.length < 8)
                return setNotice("Use at least 8 characters for this demo.");
              if (input !== caption) return setNotice("The keys do not match.");
              updateDemo({ recoveryKey: input });
              setNotice(
                "Demo key saved for this session. This is not a production key vault.",
              );
            }}
          />
        </>
      )}
      {screen === "restore" && (
        <>
          <Copy>
            Choose a backup, then unlock it with its recovery key. Phone
            verification alone cannot unlock your history.
          </Copy>
          <Action
            label="Choose Google Drive sample"
            onPress={() => setStep(1)}
          />
          <Action label="Choose local sample" onPress={() => setStep(1)} />
          {step > 0 && (
            <>
              <Copy>Sample archive · 4 conversations · 2 Moments</Copy>
              <Field
                label="Recovery key (demo: AWSEM-DEMO)"
                value={input}
                onChange={setInput}
                secure
              />
              <Action
                label="Unlock & review"
                primary
                onPress={() =>
                  input === (demo.recoveryKey || "AWSEM-DEMO")
                    ? setStep(2)
                    : setNotice(
                        demo.recoveryKey
                          ? "That key does not unlock this sample backup."
                          : "Wrong sample key. Enter AWSEM-DEMO.",
                      )
                }
              />
            </>
          )}
          {step === 2 && (
            <>
              <Copy>
                Your sample backup is ready. This will reopen the demo
                conversations.
              </Copy>
              <Action
                label="Restore sample conversations"
                primary
                onPress={() => {
                  if (!restoreDemoBackup()) {
                    setNotice(
                      "Create a sample backup first, then restore it here.",
                    );
                    return;
                  }
                  router.replace("/");
                }}
              />
            </>
          )}
        </>
      )}
      {screen === "stickers" && (
        <>
          <Copy>Personal collection</Copy>
          {demo.stickers.map((name) => (
            <View key={name} style={rowStyles.row}>
              {demo.stickerImages[name] && (
                <Image
                  source={{ uri: demo.stickerImages[name] }}
                  style={{ width: 72, height: 72 }}
                />
              )}
              <Copy>{name}</Copy>
              <Action
                label={`Remove ${name}`}
                onPress={() =>
                  updateDemo({
                    stickers: demo.stickers.filter((x) => x !== name),
                  })
                }
              />
            </View>
          ))}
          <Action
            label="Create a sticker"
            primary
            onPress={() => go("editor")}
          />
        </>
      )}
      {screen === "editor" && (
        <>
          <Copy>Crop a photo, remove its background, and add text.</Copy>
          <View
            style={{
              minHeight: 220,
              backgroundColor: c.bg,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 8,
            }}
          >
            <>
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={{ width: 200, height: 200, borderRadius: 8 }}
                  contentFit="cover"
                />
              ) : (
                <Text style={{ fontSize: step ? 90 : 60 }}>🐻</Text>
              )}
            </>
            <Text
              style={{
                position: "absolute",
                bottom: 25,
                color: "#FFFFFF",
                backgroundColor: "#222D34",
                padding: 8,
                fontSize: 22,
                fontWeight: "700",
              }}
            >
              {caption || "Sample photo"}
            </Text>
          </View>
          <View style={rowStyles.row}>
            <Action label="Choose & crop photo" onPress={pickPhoto} />
            <Action
              label="Remove background (demo)"
              onPress={() => {
                setStep(1);
                setNotice(
                  "Sample background removed. Native image processing is not connected.",
                );
              }}
            />
          </View>
          <Field label="Sticker text" value={caption} onChange={setCaption} />
          <Action
            label="Save to personal stickers"
            primary
            onPress={() => {
              const stickerName = caption.trim() || "Bear hug";
              updateDemo({
                stickers: [
                  ...demo.stickers.filter((x) => x !== stickerName),
                  stickerName,
                ],
                stickerImages: photo
                  ? { ...demo.stickerImages, [stickerName]: photo }
                  : demo.stickerImages,
              });
              go("stickers");
            }}
          />
        </>
      )}
    </Page>
  );
}
