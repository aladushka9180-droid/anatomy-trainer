import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('./provider-theme-families.css', import.meta.url), 'utf8');

assert.match(html, /<small class="provider-product-signature" aria-label="PrimeTime Pro"><span class="provider-product-name">PrimeTime<\/span><span class="provider-product-tier">Pro<\/span><\/small>/);
assert.doesNotMatch(html, /class="brand provider-brand"[^\n]*<small>PrimeTime Pro<\/small>/, 'Старая одноцветная подпись осталась в карточке бизнеса');

const signature = css.match(/\.provider-product-signature\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(signature, /font-size:12px;/, 'Подпись осталась слишком мелкой');
assert.match(signature, /letter-spacing:-\.015em!important;/, 'У подписи осталось разреженное написание');
assert.match(signature, /text-transform:none!important;/, 'Подпись всё ещё принудительно набрана капсом');
assert.match(signature, /white-space:nowrap;/, 'PrimeTime Pro может разорваться на две строки');

const productName = css.match(/\.provider-product-name\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const productTier = css.match(/\.provider-product-tier\s*\{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(productName, /--theme-ink/, 'PrimeTime не связан с основным цветом текста темы');
assert.match(productName, /--theme-muted/, 'PrimeTime конкурирует с названием бизнеса');
assert.match(productTier, /--theme-accent/, 'Pro не получает акцент текущей темы');
assert.match(productTier, /--theme-ink/, 'Акцент Pro не получает страховку контраста');
assert.match(productTier, /font-weight:900;/, 'Pro недостаточно отделён начертанием');

console.log('Provider brand signature: PASS');
