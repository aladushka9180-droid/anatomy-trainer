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
assert.match(families, /\.provider-theme-option\[class\*="theme-"\]:not\(:is\(\.theme-snow-leopard,\.theme-pearl-zebra,\.theme-concrete-signal,\.theme-luxury,\.theme-cocoa-pearl\)\) \.theme-swatch/);
const approvedBackgrounds = new Map([
  ['snow-leopard', [['provider-snow-leopard-desktop-v2.webp', 20_000], ['provider-snow-leopard-mobile-v2.webp', 20_000]]],
  ['pearl-zebra', [['provider-pearl-zebra-desktop-v3.webp', 180_000], ['provider-pearl-zebra-mobile-v3.webp', 180_000]]],
  ['concrete-signal', [['provider-concrete-signal-desktop-v1.webp', 900_000], ['provider-concrete-signal-mobile-v1.webp', 900_000]]],
  ['luxury', [['provider-luxury-premium-desktop-v1.webp', 180_000], ['provider-luxury-premium-mobile-v1.webp', 180_000]]],
  ['cocoa-pearl', [['provider-cocoa-pearl-desktop-v1.webp', 150_000], ['provider-cocoa-pearl-mobile-v1.webp', 150_000]]],
]);
assert.doesNotMatch(approved, /generated_images|\.codex/i, 'Фон темы не должен зависеть от временного каталога генерации');
for (const [theme, assets] of approvedBackgrounds) {
  for (const [asset, minSize] of assets) {
    assert.match(approved, new RegExp(asset.replaceAll('.', '\\.')));
    assert.ok(fs.statSync(new URL(`./${asset}`, import.meta.url)).size > minSize, `${theme}: фон потерял качество`);
  }
}
assert.match(catalog, /defineTheme\('luxury', 'Люкс \/ Премиум', 'Матовый обсидиан и мягкое сияние шампанского'/);
assert.match(catalog, /defineTheme\('pearl-zebra', 'Ivory Flow', 'Тёплая слоновая кость и мягкие дымчато-тауповые волны'/);
assert.match(catalog, /defineTheme\('cocoa-pearl', 'Cocoa Pearl', 'Тёмный какао, живая минеральная фактура и мягкий перламутровый свет'/);
assert.match(catalog, /defineTheme\('concrete-signal', 'Concrete Signal', 'Холодный светлый бетон и чёткий красный акцент'/);
assert.match(provider, /theme-catalog\.js\?v=749/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v749`/);
assert.match(worker, /\.\/theme-catalog\.js\?v=749/);

const neutralScheduleRules = schedule.match(/background-image:none!important/g) || [];
assert.ok(neutralScheduleRules.length >= 2, 'Фоновый узор темы не должен попадать в записи и перерывы');

console.log('Theme background patterns v749: PASS');
