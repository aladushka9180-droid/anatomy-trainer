import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('provider.html');
const worker = read('sw.js');
const css = read('provider-theme-backgrounds-tema1.css');

const assets = [
  ['provider-cobalt-forge-desktop-v2.webp', 900_000, 1_800_000],
  ['provider-petrol-steel-desktop-v2.webp', 900_000, 1_800_000],
  ['provider-cobalt-forge-mobile-v2.webp', 450_000, 1_300_000],
  ['provider-petrol-steel-mobile-v2.webp', 450_000, 1_300_000],
];

for (const [asset, minSize, maxSize] of assets) {
  const size = fs.statSync(path.join(root, asset)).size;
  assert.ok(size > minSize && size < maxSize, `${asset} must retain high-detail production quality`);
  assert.match(css, new RegExp(asset.replaceAll('.', '\\.')));
}

assert.match(css, /data-provider-theme="cobalt-forge"[\s\S]*::after[\s\S]*provider-cobalt-forge-desktop-v2\.webp/);
assert.match(css, /data-provider-theme="petrol-steel"[\s\S]*::after[\s\S]*provider-petrol-steel-desktop-v2\.webp/);
assert.match(css, /position:fixed/);
assert.match(css, /background-size:cover/);
assert.match(css, /max-width:760px[\s\S]*provider-cobalt-forge-mobile-v2\.webp/);
assert.match(css, /max-width:760px[\s\S]*provider-petrol-steel-mobile-v2\.webp/);
assert.match(css, /prefers-reduced-data:reduce/);
assert.match(html, /provider-theme-backgrounds-tema1\.css\?v=737/);
assert.doesNotMatch(html, /provider-theme-metal-backgrounds\.css/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v737`/);
assert.match(worker, /\.\/provider-theme-backgrounds-tema1\.css\?v=737/);

console.log('Provider metal backgrounds v737: PASS');
