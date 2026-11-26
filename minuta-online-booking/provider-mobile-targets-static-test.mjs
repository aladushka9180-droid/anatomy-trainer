import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');

const referenceCss = read('provider-reference-screens.css');
const ux = read('provider-ux.css');
const styles = read('styles.css');
const html = read('provider.html');

function rule(source, selector, label) {
  const line = source.split(/\r?\n/).find(entry => entry.includes(selector));
  assert.ok(line, `Нет правила для ${label}`);
  return line;
}

function px(line, property, label) {
  const value = new RegExp(`${property}:(\\d+(?:\\.\\d+)?)px`).exec(line);
  assert.ok(value, `У ${label} не задан ${property}`);
  return Number(value[1]);
}

const toggle = rule(referenceCss, '.auth-password-visibility{', 'кнопки показа пароля');
assert.ok(px(toggle, 'width', 'кнопки показа пароля') >= 44, 'Кнопка показа пароля уже 44 px');
assert.ok(px(toggle, 'height', 'кнопки показа пароля') >= 44, 'Кнопка показа пароля ниже 44 px');
const inputRule = rule(referenceCss, '.auth-input-wrap input{', 'поля пароля');
assert.ok(px(inputRule, 'padding', 'поля пароля') >= 46, 'Поле пароля не оставляет место под цель 44 px');

const preview = rule(styles, '.settings-help-link,.settings-client-preview-link {', 'ссылей предпросмотра');
assert.ok(preview.includes('font-size:12px'), 'Шрифт ссылки предпросмотра меньше 12 px');
const mobileLinks = rule(styles, '.settings-help-link,.settings-client-preview-link { min-height', 'мобильных ссылей предпросмотра');
assert.ok(px(mobileLinks, 'min-height', 'мобильных ссылей предпросмотра') >= 44, 'Ссылка предпросмотра ниже 44 px на мобильном');

const quickStartStrong = rule(styles, '.settings-quick-start-list strong {', 'заголовков шагов');
assert.ok(px(quickStartStrong, 'font-size', 'заголовков шагов') >= 12, 'Заголовок шага меньше 12 px');
const quickStartSmall = rule(styles, '.settings-quick-start-list small {', 'пояснений шагов');
assert.ok(px(quickStartSmall, 'font-size', 'пояснений шагов') >= 12, 'Пояснение шага меньше 12 px');
const quickStartHead = rule(styles, '.settings-quick-start-head p {', 'описания первоначальной настройки');
assert.ok(px(quickStartHead, 'font-size', 'описания первоначальной настройки') >= 12, 'Описание первоначальной настройки меньше 12 px');

const uxSmallText = ux.split(/\r?\n/).find(entry => entry.includes('font-size:max(12px'));
assert.ok(uxSmallText, 'Понизительный текст в provider-ux.css остался ниже 12 px');
assert.ok(!/font-size:max\(11px/.test(ux), 'В provider-ux.css остался порога 11 px для пояснений');

const mobileToggle = rule(styles, '.report-smart-actions .report-actions-toggle { display:block', 'кнопки «Ещё»');
assert.ok(px(mobileToggle, 'min-height', 'кнопки «Ещё»') >= 44, 'Кнопка «Ещё» ниже 44 px на мобильном');

assert.ok(html.includes('provider-reference-screens.css?v='), 'provider.html не ссылается на стили экранов входа');
const sw = read('sw.js');
const cacheVersion = /CACHE = `\$\{CACHE_PREFIX\}v(\d+)`/.exec(sw)[1];
assert.ok(sw.includes(`precache-ready-v${cacheVersion}`), 'Метка precache не совпадает с версией кэша');

for (const asset of ['styles.css', 'provider-ux.css', 'provider-reference-screens.css']) {
  const htmlVersion = new RegExp(`href="${asset}\\?v=(\\d+)"`).exec(html)?.[1];
  assert.ok(htmlVersion, `${asset} не подключён в provider.html`);
  const workerVersion = new RegExp(`'./${asset}\\?v=(\\d+)'`).exec(sw)?.[1];
  assert.ok(workerVersion, `${asset} не попал в precache service worker`);
  assert.equal(htmlVersion, workerVersion, `${asset}: версия в HTML не совпадает с precache`);
}

for (const script of ['provider.js', 'primetime-handoff.js']) {
  const scriptVersion = new RegExp(`src="${script}\\?v=(\\d+)"`).exec(html)?.[1];
  assert.equal(scriptVersion, cacheVersion, `${script}: версия в HTML не совпадает с кэшем v${cacheVersion}`);
}

console.log('Мобильные цели и текст настроек согласованы.');
