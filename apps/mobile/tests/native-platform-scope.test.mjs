import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));

test('Expo and package scripts only target native platforms', () => {
  const appConfig = readJSON('app.json').expo;
  const pkg = readJSON('package.json');
  const lock = readJSON('package-lock.json');
  assert.deepEqual(appConfig.platforms, ['ios', 'android']);
  assert.equal('web' in appConfig, false);
  assert.equal('web' in pkg.scripts, false);
  assert.equal('demo:preview' in pkg.scripts, false);
  assert.equal('test:unit' in pkg.scripts, true);
  for (const name of ['react-dom', 'react-native-web', '@types/react-dom']) {
    assert.equal(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name], undefined, `${name} is a web-only dependency`);
    assert.equal(lock.packages[''].dependencies?.[name] ?? lock.packages[''].devDependencies?.[name], undefined, `${name} remains in the package lock root`);
  }
});

test('browser demo preview artifacts are removed', () => {
  assert.equal(existsSync(path.join(root, 'scripts/preview.mjs')), false);
  assert.equal(existsSync(path.resolve(root, '../../docs/technical/demo-preview.png')), false);
});

test('mobile source has no web-specific modules or demo app modules', () => {
  const sourceRoot = path.join(root, 'src');
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files.push(path.relative(root, file));
    }
  };
  visit(sourceRoot);
  assert.deepEqual(files.filter(file => /\.web\.[^.]+$/.test(file)), []);
  for (const file of [
    'src/features/chat-app.tsx', 'src/features/demo-store.ts', 'src/features/sample-data.ts',
    'src/features/gif-picker.tsx', 'src/features/stickers/picker.tsx', 'src/features/media-sheet.tsx',
    'src/features/popup-menu.tsx',
  ]) assert.equal(existsSync(path.join(root, file)), false, `${file} should be removed`);
});
