type NotificationResponsePort = {
  addNotificationResponseReceivedListener(listener: (response: unknown) => void): { remove(): void };
  getLastNotificationResponseAsync?(): Promise<unknown>;
  clearLastNotificationResponseAsync?(): Promise<void>;
};

function responseID(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const notification = (response as { notification?: unknown }).notification;
  if (!notification || typeof notification !== 'object') return undefined;
  const request = (notification as { request?: unknown }).request;
  if (!request || typeof request !== 'object') return undefined;
  const identifier = (request as { identifier?: unknown }).identifier;
  return typeof identifier === 'string' && identifier.length > 0 && identifier.length <= 256 ? identifier : undefined;
}

export function installNotificationNavigation(ports: NotificationResponsePort, openChats: () => void) {
  let active = true;
  const handled = new Set<string>();
  const subscription = ports.addNotificationResponseReceivedListener(handle);

  function handle(response: unknown) {
    if (!active) return;
    const identifier = responseID(response);
    if (!identifier || handled.has(identifier)) return;
    handled.add(identifier);
    if (handled.size > 32) handled.delete(handled.values().next().value!);
    try { openChats(); }
    catch {
      handled.delete(identifier);
      return;
    }
    void ports.clearLastNotificationResponseAsync?.().catch(() => {});
  }

  void ports.getLastNotificationResponseAsync?.().then(handle, () => {});
  return () => { active = false; subscription.remove(); };
}
