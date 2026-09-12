import assert from 'node:assert/strict';
import fs from 'node:fs';

const catalog = fs.readFileSync(new URL('./theme-catalog.js', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const schedule = fs.readFileSync(new URL('./provider-schedule-minimal.css', import.meta.url), 'utf8');
const signature = fs.readFileSync(new URL('./provider-themes-signature.css', import.meta.url), 'utf8');
const families = fs.readFileSync(new URL('./provider-theme-families.css', import.meta.url), 'utf8');
const approved = fs.readFileSync(new URL('./provider-theme-backgrounds-tema1.css', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

assert.match(catalog, /defineTheme\('oled-mono',[\s\S]*?pattern:'repeating-linear-gradient\(135deg,rgba\(255,255,255,\.024\) 0 1px,transparent 1px 18px,rgba\(255,255,255,\.012\) 18px 23px,transparent 23px 42px\),linear-gradient\(145deg,#000000,#070707 58%,#010101\)'/);
assert.match(catalog, /defineTheme\('volt-graphite',[\s\S]*?pattern:'repeating-linear-gradient\(135deg,rgba\(166,192,68,\.035\) 0 1px,transparent 1px 4px,rgba\(118,132,144,\.035\) 4px 5px,transparent 5px 26px\),radial-gradient\(circle at 84% 2%,rgba\(166,192,68,\.12\),transparent 34%\),linear-gradient\(145deg,#0e1115,#1c2228 58%,#12161a\)'/);
assert.match(signature, /data-provider-theme="oled-mono"[\s\S]*?--atmosphere-background:repeating-linear-gradient\(135deg,rgba\(255,255,255,\.024\) 0 1px,transparent 1px 18px,rgba\(255,255,255,\.012\) 18px 23px,transparent 23px 42px\)/);
assert.match(signature, /data-provider-theme="volt-graphite"[\s\S]*?--atmosphere-background:repeating-linear-gradient\(135deg,rgba\(166,192,68,\.035\) 0 1px,transparent 1px 4px,rgba\(118,132,144,\.035\) 4px 5px,transparent 5px 26px\)/);
assert.match(signature, /\.theme-oled-mono \.theme-swatch \{ background-image:repeating-linear-gradient/);
assert.match(signature, /\.theme-volt-graphite \.theme-swatch \{ background-image:repeating-linear-gradient/);
assert.match(families, /data-provider-theme="oled-mono"[\s\S]*?--theme-canvas-texture:radial-gradient/);
assert.doesNotMatch(families.match(/data-provider-theme="oled-mono"[\s\S]*?\n\}/)?.[0] || '', /repeating-linear-gradient/);
assert.match(families, /--theme-circuit-mask:url\("data:image\/svg\+xml/);
assert.match(families, /--theme-constellation-mask:url\("data:image\/svg\+xml/);
assert.match(families, /--theme-facets-mask:url\("data:image\/svg\+xml/);
assert.match(families, /data-provider-theme="volt-graphite"[\s\S]*?--theme-canvas-mask:var\(--theme-circuit-mask\)/);
assert.match(families, /data-provider-theme="midnight"[\s\S]*?--theme-canvas-mask:var\(--theme-constellation-mask\)/);
assert.match(families, /data-provider-theme="azure-lagoon"[\s\S]*?--theme-canvas-mask:var\(--theme-facets-mask\)/);
assert.doesNotMatch(families.match(/data-provider-theme="azure-lagoon"[\s\S]*?\n\}/)?.[0] || '', /repeating-radial-gradient/);
assert.match(families, /\.provider-theme-option\[class\*="theme-"\]:not\(:is\(\.theme-snow-leopard,\.theme-pearl-zebra\)\) \.theme-swatch/);
for (const theme of ['snow-leopard', 'pearl-zebra']) {
  assert.match(approved, new RegExp(`provider-${theme}-desktop-v2\\.webp`));
  assert.match(approved, new RegExp(`provider-${theme}-mobile-v2\\.webp`));
}
assert.match(provider, /theme-catalog\.js\?v=735/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v735`/);
assert.match(worker, /\.\/theme-catalog\.js\?v=735/);

const neutralScheduleRules = schedule.match(/background-image:none!important/g) || [];
assert.ok(neutralScheduleRules.length >= 2, 'Фоновый узор темы не должен попадать в записи и перерывы');

console.log('Theme background patterns v735: PASS');
