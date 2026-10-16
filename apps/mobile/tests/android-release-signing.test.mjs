import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = path.join(project, 'plugins/with-android-release-signing.js');
const require = createRequire(import.meta.url);
const generatedGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;

test('Expo prebuild installs release signing without a debug-key fallback', async () => {
  const appConfig = JSON.parse(await readFile(path.join(project, 'app.json'), 'utf8'));
  assert.ok(appConfig.expo.plugins.includes('./plugins/with-android-release-signing'));
  await access(pluginPath);

  const { applyReleaseSigning } = require(pluginPath);
  const transformed = applyReleaseSigning(generatedGradle);
  assert.match(transformed, /AWSEMCHAT_ANDROID_RELEASE_STORE_FILE/);
  assert.match(transformed, /AWSEMCHAT_ANDROID_RELEASE_STORE_PASSWORD/);
  assert.match(transformed, /AWSEMCHAT_ANDROID_RELEASE_KEY_ALIAS/);
  assert.match(transformed, /AWSEMCHAT_ANDROID_RELEASE_KEY_PASSWORD/);
  assert.match(transformed, /Missing Android release signing configuration/);
  assert.match(transformed, /release\s*\{[\s\S]*?signingConfig signingConfigs\.release/);
  assert.match(transformed, /debug\s*\{\s*signingConfig signingConfigs\.debug/);
  assert.equal(applyReleaseSigning(transformed), transformed);
});
