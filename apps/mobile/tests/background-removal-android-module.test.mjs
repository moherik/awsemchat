import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const appRoot = new URL('../', import.meta.url);

test('native sticker background removal uses the installed cross-platform Expo module', async () => {
  const [packageText, adapter] = await Promise.all([
    readFile(new URL('package.json', appRoot), 'utf8'),
    readFile(new URL('src/features/stickers/background-removal.ts', appRoot), 'utf8'),
  ]);

  const app = JSON.parse(packageText);
  assert.ok(app.dependencies['@rbayuokt/expo-background-removal']);
  assert.match(adapter, /const module = requireOptionalNativeModule/);
  assert.match(adapter, /'ExpoBackgroundRemoval'/);
  assert.match(adapter, /cropToSubject: false/);
});
