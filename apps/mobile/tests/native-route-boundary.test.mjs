import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = file => readFileSync(path.join(root, file), 'utf8');

test('production routes resolve directly to native screens', () => {
  const home = source('src/app/index.tsx');
  const chat = source('src/app/chat.tsx');
  const flows = source('src/features/flows.tsx');
  const stickers = source('src/features/stickers/screen.tsx');
  assert.match(home, /NativeHome/);
  assert.doesNotMatch(home, /DemoChatApp|app-home-policy|Platform\.OS/);
  assert.match(chat, /ProductionChat/);
  assert.doesNotMatch(chat, /AwsemChat|chat-route-policy|Platform\.OS/);
  assert.match(flows, /NativeFlows/);
  assert.doesNotMatch(flows, /DemoFlows|useDemo|Platform\.OS === ['"]web['"]/);
  assert.match(stickers, /NativeStickerScreen/);
  assert.doesNotMatch(stickers, /WebStickerScreen|DemoState|useDemo|updateDemo|Platform\.OS/);
});

test('web sessions do not bypass native authentication', () => {
  const policy = source('src/features/auth/session-route-policy.ts');
  assert.doesNotMatch(policy, /platform === ['"]web['"]|Platform\.OS === ['"]web['"]/);
});
