import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pages = ['index.html', 'provider.html', 'booking.html', 'privacy.html'];
const version = '39';

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /Content-Security-Policy/, `${page}: нет политики безопасности`);
  assert.doesNotMatch(html, /v=38/, `${page}: осталась старая версия ресурсов`);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"#]*)?"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:)/.test(reference)) continue;
    assert.ok(existsSync(join(root, reference)), `${page}: отсутствует ${reference}`);
  }
}

for (const page of ['index.html', 'provider.html', 'booking.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /@supabase\/supabase-js@2\.112\.4/, `${page}: SDK Supabase не закреплён`);
  assert.match(html, /integrity="sha384-/, `${page}: нет контроля целостности SDK`);
  assert.match(html, new RegExp(`reliability\\.js\\?v=${version}`), `${page}: не подключён слой надёжности`);
}

const provider = readFileSync(join(root, 'provider.js'), 'utf8');
assert.match(provider, /postgres_changes/, 'Кабинет не подписан на изменения записей');
assert.match(provider, /saveProviderCache\('bookings'/, 'Записи не сохраняются для офлайн-просмотра');
assert.match(provider, /setInterval\(\(\) =>/, 'Нет резервной периодической синхронизации');

const worker = readFileSync(join(root, 'sw.js'), 'utf8');
assert.match(worker, new RegExp(`massage-izhevsk-v${version}`), 'Версия Service Worker не совпадает');
for (const asset of ['styles.css', 'config.js', 'reliability.js', 'app.js', 'provider.js', 'booking.js']) {
  assert.match(worker, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`), `Service Worker не кэширует ${asset}`);
}
assert.match(worker, /event\.request\.mode === 'navigate'/, 'Навигация не отделена от статических ресурсов');

console.log('minuta-online-booking smoke test: OK');
