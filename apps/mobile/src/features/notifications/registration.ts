type Permissions = Readonly<{ granted: boolean }>;
type NotificationPort = {
  setNotificationChannelAsync?(channelId: string, options: { name: string; importance: number; vibrationPattern: number[]; lightColor: string }): Promise<unknown>;
  getPermissionsAsync(): Promise<Permissions>;
  requestPermissionsAsync(): Promise<Permissions>;
  getExpoPushTokenAsync(options: { projectId: string }): Promise<{ data: string }>;
};

export function createPushRegistration(ports: {
  platform: string;
  projectId?: string;
  physicalDevice: boolean;
  notifications: NotificationPort;
  mutedConversations?(): Promise<readonly string[]>;
  api: { register(token: string, mutedConversations?: readonly string[]): Promise<void>; unregister(): Promise<void> };
}) {
  return Object.freeze({
    async enable() {
      if (!ports.physicalDevice && ports.platform !== 'android') throw new Error('PHYSICAL_DEVICE_REQUIRED');
      const projectId = ports.projectId?.trim();
      if (!projectId) throw new Error('EXPO_PROJECT_NOT_CONFIGURED');
      if (ports.platform === 'android') {
        if (!ports.notifications.setNotificationChannelAsync) throw new Error('NOTIFICATIONS_UNAVAILABLE');
        await ports.notifications.setNotificationChannelAsync('messages', {
          name: 'Messages', importance: 4, vibrationPattern: [0, 250, 250, 250], lightColor: '#006BB6',
        });
      }
      let permission = await ports.notifications.getPermissionsAsync();
      if (!permission.granted) permission = await ports.notifications.requestPermissionsAsync();
      if (!permission.granted) return false;
      const result = await ports.notifications.getExpoPushTokenAsync({ projectId });
      const token = typeof result.data === 'string' ? result.data.trim() : '';
      if (!/^ExpoPushToken\[[A-Za-z0-9._:-]{1,240}\]$/.test(token)) throw new Error('INVALID_PUSH_TOKEN');
      const muted = await ports.mutedConversations?.() ?? [];
      await ports.api.register(token, muted);
      return true;
    },
    async disable() {
      await ports.api.unregister();
    },
  });
}
