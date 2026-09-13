import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('provider.html');
const worker = read('sw.js');
const css = read('provider-theme-backgrounds-tema1.css');

for (const asset of ['provider-cobalt-forge-bg-v1.webp', 'provider-petrol-steel-bg-v1.webp']) {
  const size = fs.statSync(path.join(root, asset)).size;
  assert.ok(size > 100_000 && size < 500_000, `${asset} must be a production-sized WebP texture`);
  assert.match(css, new RegExp(asset.replaceAll('.', '\\.')));
}

assert.match(css, /data-provider-theme="cobalt-forge"[\s\S]*provider-cobalt-forge-bg-v1\.webp/);
assert.match(css, /data-provider-theme="petrol-steel"[\s\S]*provider-petrol-steel-bg-v1\.webp/);
assert.match(css, /background-size:cover!important/);
assert.match(css, /prefers-reduced-data:reduce/);
assert.match(html, /provider-theme-backgrounds-tema1\.css\?v=736/);
assert.doesNotMatch(html, /provider-theme-metal-backgrounds\.css/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v736`/);
assert.match(worker, /\.\/provider-theme-backgrounds-tema1\.css\?v=736/);

console.log('Provider metal backgrounds v736: PASS');
