import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const provider = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const themes = ['nordic', 'graphite', 'lavender', 'loft', 'eco', 'hitech'];

for (const theme of themes) {
  assert.match(
    styles,
    new RegExp(`\\.provider-body\\[data-provider-theme="${theme}"\\] \\{[\\s\\S]*?--atmosphere-background:`),
    `У темы ${theme} нет атмосферного фона`
  );
  assert.match(provider, new RegExp(`value="${theme}"[\\s\\S]*?<small>[^<]+</small>`), `У темы ${theme} нет обновлённого описания`);
  assert.match(styles, new RegExp(`\\.theme-${theme} \\.theme-swatch \\{ background-image:`), `Превью темы ${theme} не показывает атмосферу`);
}

assert.match(styles, /v400: спокойная атмосферная система для остальных шести тем/, 'Общая атмосферная дизайн-система отсутствует');
assert.match(styles, /background:var\(--atmosphere-background\)!important/, 'Фоновая атмосфера не применяется к кабинету');
assert.match(styles, /\.provider-body\[data-provider-theme="eco"\] \.provider-sidebar::after,[\s\S]*?content:none!important/, 'Декоративный росток Eco не отключён');
assert.match(styles, /\.report-command-kicker i \{[\s\S]*?animation:none!important/, 'Декоративная пульсация не отключена');
assert.match(styles, /--booking-tone:#5a9878/, 'Спокойная цветовая маркировка записей отсутствует');
assert.match(styles, /data-provider-theme="hitech"[^}]*\.date-strip button\.active \{[\s\S]*?background:#4f7388!important;[\s\S]*?background-image:none!important;[\s\S]*?box-shadow:0 7px 18px rgba\(42,69,84,\.16\)!important;/, 'Активный день Hitech остался глянцевым или неоновым');
assert.ok(
  styles.lastIndexOf('.provider-body[data-provider-theme="hitech"] .date-strip button.active')
    > styles.lastIndexOf(') .date-strip button.active {'),
  'Матовый Hitech-цвет должен применяться после общего правила активного дня'
);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v401`;/, 'Кэш приложения не обновлён для атмосферных тем');
assert.match(provider, /styles\.css\?v=401/, 'Кабинет не подключает актуальные стили');

console.log('Atmospheric provider themes v400: OK');
