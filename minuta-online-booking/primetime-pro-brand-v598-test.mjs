import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (name, encoding = 'utf8') => readFileSync(join(root, name), encoding);
const readProject = (name, encoding = 'utf8') => readFileSync(join(projectRoot, name), encoding);
const provider = read('provider.html');
const manifest = JSON.parse(read('provider.webmanifest'));

assert.match(provider, /<title>PrimeTime Pro — кабинет исполнителя<\/title>/);
assert.match(provider, /apple-mobile-web-app-title" content="PrimeTime"/);
assert.match(provider, /<span class="provider-boot-mark"[^>]*>PT<\/span>/);
assert.match(provider, /<span class="brand-mark">PT<\/span><span><strong>PrimeTime Pro<\/strong>/);
assert.match(provider, /rel="icon" href="provider-icon\.svg\?v=664"/);
assert.match(provider, /property="og:image" content="[^"]+\/provider-og\.png\?v=664"/);
assert.match(provider, /name="twitter:image" content="[^"]+\/provider-og\.png\?v=664"/);
assert.equal(manifest.name, 'PrimeTime Pro — кабинет');
assert.equal(manifest.short_name, 'PrimeTime');
assert.deepEqual(manifest.icons.map(icon => icon.src), [
  'provider-icon-192.png?v=664',
  'provider-icon-512.png?v=664',
  'provider-icon-maskable-512.png?v=664',
]);

const publicBrandFiles = [
  '404.html', 'offline.html', 'privacy.html', 'terms.html', 'speech-test.html',
  'provider.html', 'provider.webmanifest', 'provider.js', 'data-governance.js',
  'free-slots-share.js', 'retention-management.js', 'voice-assistant.js', 'notify-health-failure.mjs', 'production-health-check.mjs',
  'help/index.html', 'help/category.html', 'help/article.html', 'help/help.js',
  'help/category.js', 'help/article.js', 'help/help-data.js',
  'help/tools/capture-guide-screenshots.mjs',
  'supabase/functions/assistant-understand/index.ts',
  'supabase/functions/telegram-client-notify/index.ts',
];
for (const file of publicBrandFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /(?<![A-Za-z0-9_])Minuta(?![A-Za-z0-9_])/u, `${file}: осталось старое публичное имя Minuta`);
  assert.doesNotMatch(source, /«Минута»|>Минута<|— Минута|Минута ·/u, `${file}: осталось старое публичное имя Минута`);
}

for (const file of ['help/index.html', 'help/category.html', 'help/article.html']) {
  const source = read(file);
  assert.match(source, /PrimeTime Pro/);
  assert.match(source, /help-brand-mark">PT<\/span>/);
}
assert.match(read('help/help-data.js'), /Интерфейс PrimeTime Pro/);
assert.match(read('help/tools/capture-guide-screenshots.mjs'), /Интерфейс PrimeTime Pro · учебные данные/);
assert.match(read('help/tools/capture-guide-screenshots.mjs'), /PrimeTime Pro · наглядно по шагам/);
assert.match(read('help/tools/capture-guide-screenshots.mjs'), /primetime-pro\.online\/book\/demo/);
assert.doesNotMatch(read('help/tools/capture-guide-screenshots.mjs'), /minuta\.online/);

for (const file of ['provider-icon-192.png', 'provider-icon-512.png', 'provider-icon-maskable-512.png', 'provider-og.png']) {
  assert.ok(statSync(join(root, file)).size > 3000, `${file}: иконка не сформирована`);
}
assert.match(read('provider-icon.svg'), /<path[^>]+fill="#f6fbf7"/);
assert.match(read('provider-icon-maskable.svg'), /<path[^>]+fill="#f6fbf7"/);
assert.match(read('data-governance.js'), /primetime-pro-bookings-/);
assert.match(read('data-governance.js'), /primetime-pro-backup-/);
assert.match(read('free-slots-share.js'), /primetime-pro-booking-qr\.png/);
assert.match(read('voice-assistant.js'), /праймтайм\(\?:\\s\+про\)\?/);
assert.match(read('voice-assistant.js'), /primetime\(\?:\\s\+pro\)\?/);
assert.match(read('provider.js'), /ОТЧЁТ PRIMETIME PRO/);

const rootNotFound = readProject('404.html');
assert.match(rootNotFound, /Страница не найдена — PrimeTime Pro/);
assert.match(rootNotFound, /textContent = 'PT'/);
assert.doesNotMatch(rootNotFound, /(?<![A-Za-z0-9_])Minuta(?![A-Za-z0-9_])/u);

assert.match(read('index.html'), /<strong>Массаж в Ижевске<\/strong>/, 'название бизнеса клиента нельзя заменять брендом платформы');
assert.match(read('my-bookings.js'), /minuta-client-session-v1/, 'ключ действующей клиентской сессии должен сохраниться');
assert.match(read('theme-catalog.js'), /window\.MinutaThemeCatalog/, 'совместимый внутренний API должен сохраниться');
assert.match(read('app.js'), /book_minuta_appointment/, 'совместимый RPC должен сохраниться');

const worker = read('sw.js');
assert.match(worker, /CACHE_PREFIX\}v664/);
assert.match(worker, /provider\.webmanifest\?v=664/);
assert.match(worker, /provider-icon\.svg/);
assert.match(worker, /provider-og\.png/);
assert.match(provider, /provider\.js\?v=664/);

console.log(`PrimeTime Pro brand v664: PASS (${publicBrandFiles.length} public text surfaces)`);
