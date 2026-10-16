import Icon from "@expo/vector-icons/MaterialCommunityIcons";
import { SafeAreaView } from 'react-native-safe-area-context';
import { nativeFlowUnavailableMessage, resolveNativeFlow } from './native-flow-routes';
import { View, Text, Pressable } from "react-native";
import AuthenticationScreen from './auth/screen';
import { NativeFriendRequests } from './social/friends-screen';
import { NativeCircles } from './social/circles-screen';
import { NativeCircleCreation } from './social/circle-creation-screen';
import { NativeCircleDetails } from './social/circle-details-screen';
import { NativeSavedCircleUpdates } from './social/saved-circle-updates-screen';
import { NativeCircleInvite } from './social/circle-invite-screen';
import BackupScreen from './backup/screen';
import { NativeArchivedChats } from './messages/native-chat-list';
import { NativeSharedMedia } from './messages/native-shared-media';
import { NativeAppearanceScreen } from './native-appearance-screen';
import { NativeNewConversation } from './messages/native-new-conversation';
import { NativePrivateProfile, NativeSettings } from './social/private-profile-screen';
import { CircleStickerLibrary } from './stickers/circle-library';
import { PersonalStickerLibrary } from './stickers/personal-library';
import { NativeConversationDetails } from './messages/conversation-details-screen';
import { NativePrivacyScreen } from './social/privacy-screen';
import { NativeNowPlayingScreen } from './now-playing/screen';
import { NativeConversationReport } from './reports/screen';
import { NativeNotificationsScreen } from './notifications/screen';
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { usePalette } from "./ui";
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
type FlowParams = { view: string; name?: string; circle?: string; peer?: string };

export default function Flows() {
  const params = useLocalSearchParams<FlowParams>();
  const screen = params.view ?? "settings";
  return <NativeFlows screen={screen} params={params} />;
}

function NativeFlows({ screen, params }: { screen: string; params: FlowParams }) {
  const route = resolveNativeFlow(screen);
  switch (route) {
    case 'authentication': return <AuthenticationScreen />;
    case 'friend-requests': return <NativeFriendRequests />;
    case 'new-conversation': return <NativeNewConversation />;
    case 'profile': return <NativePrivateProfile />;
    case 'profile-home': return <NativePrivateProfile mode="home" />;
    case 'settings': return <NativeSettings />;
    case 'privacy': return <NativePrivacyScreen />;
    case 'now-playing': return <NativeNowPlayingScreen />;
    case 'notifications': return <NativeNotificationsScreen />;
    case 'appearance': return <NativeAppearanceScreen />;
    case 'shared-media': return <NativeSharedMedia peer={params.peer} circle={params.circle} />;
    case 'conversation-details': return <NativeConversationDetails peer={params.peer ?? ''} />;
    case 'saved-circle-updates': return <NativeSavedCircleUpdates />;
    case 'circles': return <NativeCircles />;
    case 'circle-creation': return <NativeCircleCreation />;
    case 'circle-details': return <NativeCircleDetails circleId={params.circle ?? ''} />;
    case 'circle-invite': return <NativeCircleInvite circleId={params.circle ?? ''} />;
    case 'circle-invitations': return <NativeCircles invitations />;
    case 'group-stickers': return <CircleStickerLibrary circleId={params.circle ?? ''} />;
    case 'conversation-report': return <NativeConversationReport peer={params.peer ?? ''} />;
    case 'personal-stickers': return <PersonalStickerLibrary />;
    case 'sticker-maker': return <Redirect href={{ pathname: '/stickers', params: { mode: 'maker', ...(params.circle ? { circle: params.circle } : {}) } }}/>;
    case 'backup': return <BackupScreen />;
    case 'archived-chats': return <NativeArchivedChats />;
    default: return <NativeUnavailableFlow screen={screen} />;
  }
}

function NativeUnavailableFlow({ screen }: { screen: string }) {
  const c = usePalette();
  const title = titles[screen] ?? 'AwsemChat';
  return <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }}>
    <View style={{ minHeight: 60, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 0.5, borderColor: c.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Icon name="arrow-left" size={24} color={c.text} /></Pressable>
      <Text style={{ color: c.text, fontSize: 20, fontWeight: '600', marginLeft: 14 }}>{title}</Text>
    </View>
    <View style={{ flex: 1, padding: 22, justifyContent: 'center', gap: 10 }}>
      <Text style={{ color: c.text, fontSize: 17, fontWeight: '600' }}>{title} isn’t available in AwsemChat yet.</Text>
      <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22 }}>{nativeFlowUnavailableMessage(screen)}</Text>
    </View>
  </SafeAreaView>;
}
