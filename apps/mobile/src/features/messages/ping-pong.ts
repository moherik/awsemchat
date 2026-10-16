export type PingMessage = Readonly<{ version: 1; type: 'awsem-ping' }>;
export type PongMessage = Readonly<{ version: 1; type: 'awsem-pong'; pingOperation: string }>;

const ping: PingMessage = Object.freeze({ version: 1, type: 'awsem-ping' });
const operationPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function encodePing(): string {
  return JSON.stringify(ping);
}

export function decodePing(value: string): PingMessage | undefined {
  if (typeof value !== 'string' || value.length > 128) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const fields = parsed as Record<string, unknown>;
    if (Object.keys(fields).sort().join(',') !== 'type,version' || fields.version !== 1 || fields.type !== 'awsem-ping') return undefined;
    return ping;
  } catch { return undefined; }
}

export function encodePong(pingOperation: string): string {
  if (!operationPattern.test(pingOperation)) throw new Error('INVALID_PING');
  return JSON.stringify({ version: 1, type: 'awsem-pong', pingOperation } satisfies PongMessage);
}

export function decodePong(value: string): PongMessage | undefined {
  if (typeof value !== 'string' || value.length > 256) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const fields = parsed as Record<string, unknown>;
    if (Object.keys(fields).sort().join(',') !== 'pingOperation,type,version' || fields.version !== 1 || fields.type !== 'awsem-pong' || typeof fields.pingOperation !== 'string' || !operationPattern.test(fields.pingOperation)) return undefined;
    return Object.freeze({ version: 1, type: 'awsem-pong', pingOperation: fields.pingOperation });
  } catch { return undefined; }
}

export function createPingAlertGate(cooldownMs = 5_000) {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) throw new Error('INVALID_INPUT');
  const lastAlert = new Map<string, number>();
  return Object.freeze({
    shouldAlert(conversation: string, now: number): boolean {
      if (!/^private:[A-Za-z0-9._:-]{1,128}$/.test(conversation) || !Number.isSafeInteger(now) || now < 0) return false;
      const previous = lastAlert.get(conversation);
      if (previous !== undefined && now - previous < cooldownMs) return false;
      lastAlert.set(conversation, now);
      return true;
    },
  });
}
