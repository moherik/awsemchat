import { router } from 'expo-router';
import { Action, Copy, Page } from '../ui';

export function NativePrivacyScreen() {
  return (
    <Page title="Privacy & safety" compact>
      <Copy>Your phone number is private; friends connect with your PIN.</Copy>
      <Copy>AwsemChat does not show online, typing, or read indicators.</Copy>
      <Copy muted>
        New chats start after a friend request is accepted. You can block a
        contact at any time. To verify a friend, open their conversation details.
      </Copy>
      <Action label="Blocked contacts" onPress={() => router.push('/blocked')} />
      <Action label="Find a friend to verify" onPress={() => router.push('/?tab=Friends')} />
    </Page>
  );
}
