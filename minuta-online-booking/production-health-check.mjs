import assert from 'node:assert/strict';

try {
const configuredBaseUrl = process.env.MINUTA_BASE_URL || 'https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/';
const baseUrl = new URL(configuredBaseUrl.endsWith('/') ? configuredBaseUrl : `${configuredBaseUrl}/`);
const timeoutMs = Number(process.env.MINUTA_HEALTH_TIMEOUT_MS || 12000);
const expectedVersion = process.env.MINUTA_EXPECT_VERSION;

assert.ok(Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 60000, 'MINUTA_HEALTH_TIMEOUT_MS должен быть от 1000 до 60000');
assert.ok(!expectedVersion || /^\d+$/.test(expectedVersion), 'MINUTA_EXPECT_VERSION должна быть целым номером версии');

function isoDateInSamara(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Samara',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offsetDays));
  return date.toISOString().slice(0, 10);
}

async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { redirect: 'follow', ...options, signal: controller.signal });
    const elapsed = Math.round(performance.now() - started);
    return { response, elapsed };
  } catch (error) {
    throw new Error(`${url}: ${error?.name === 'AbortError' ? `тайм-аут ${timeoutMs}мс` : (error?.message || 'ошибка сети')}`);
  } finally {
    clearTimeout(timer);
  }
}

async function checkedFetch(url, options = {}) {
  const { response, elapsed } = await timedFetch(url, options);
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`${url}: ${response.status} ${response.statusText}: ${body}`);
  }
  return { response, elapsed };
}

function sameOriginAssets(html, pageUrl) {
  const assets = new Set();
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = new URL(match[1], pageUrl);
    if (url.origin === baseUrl.origin && /\.(?:css|js|svg|png|webmanifest)(?:\?|$)/.test(url.href)) assets.add(url.href);
  }
  return [...assets];
}

function cacheBustedVersions(html) {
  return [...html.matchAll(/(?:src|href)="[^"#?]+\?v=([^"&#]+)(?:#[^"]*)?"/g)].map(match => match[1]);
}

const timings = [];
const pages = ['index.html', 'provider.html', 'booking.html', 'my-bookings.html'];
const assetUrls = new Set();

for (const page of pages) {
  const pageUrl = new URL(page, baseUrl);
  const { response, elapsed } = await checkedFetch(pageUrl);
  const html = await response.text();
  assert.ok(/Content-Security-Policy/.test(html), `${page}: отсутствует CSP`);
  assert.ok(/vendor\/supabase-2\.112\.4\.min\.js/.test(html), `${page}: отсутствует закреплённый Supabase SDK`);
  if (expectedVersion) {
    const versions = cacheBustedVersions(html);
    assert.ok(versions.length > 0, `${page}: не найдены версии статических ресурсов`);
    assert.ok(versions.every(version => version === expectedVersion), `${page}: ожидалась версия ${expectedVersion}, найдены ${[...new Set(versions)].join(', ')}`);
  }
  for (const asset of sameOriginAssets(html, pageUrl)) assetUrls.add(asset);
  timings.push(`${page} ${elapsed}мс`);
}

await Promise.all([...assetUrls].map(assetUrl => checkedFetch(assetUrl)));

// API проверяется по конфигурации, реально опубликованной на сайте, а не по локальной копии.
const configResult = await checkedFetch(new URL('config.js', baseUrl));
const configSource = await configResult.response.text();
const supabaseUrl = configSource.match(/supabaseUrl:\s*['"]([^'"]+)['"]/)?.[1];
const supabaseKey = configSource.match(/supabaseKey:\s*['"]([^'"]+)['"]/)?.[1];
assert.ok(supabaseUrl && supabaseKey, 'Не удалось прочитать публичную конфигурацию Supabase с рабочего сайта');

const workerResult = await checkedFetch(new URL('sw.js', baseUrl));
const workerSource = await workerResult.response.text();
if (expectedVersion) {
  assert.ok(workerSource.includes(`\${CACHE_PREFIX}v${expectedVersion}`), `sw.js: не найден кэш версии ${expectedVersion}`);
  assert.ok(workerSource.includes(`?v=${expectedVersion}`), `sw.js: ресурсы не переведены на версию ${expectedVersion}`);
}

const apiHeaders = {
  apikey: supabaseKey,
  authorization: `Bearer ${supabaseKey}`,
  'content-type': 'application/json'
};
const authResult = await checkedFetch(new URL('/auth/v1/health', supabaseUrl), { headers: { apikey: supabaseKey } });
const authHealth = await authResult.response.json();
assert.ok(authHealth?.name === 'GoTrue', 'Сервис авторизации Supabase не подтвердил готовность');

const servicesUrl = new URL('/rest/v1/services?select=id&active=eq.true&limit=1', supabaseUrl);
const servicesResult = await checkedFetch(servicesUrl, { headers: apiHeaders });
const services = await servicesResult.response.json();
assert.ok(Array.isArray(services) && services[0]?.id, 'Supabase не вернул ни одной активной услуги');

const portfolioResult = await checkedFetch(new URL('/rest/v1/portfolio_items?select=id&published=eq.true&limit=1', supabaseUrl), { headers: apiHeaders });
const portfolio = await portfolioResult.response.json();
assert.ok(Array.isArray(portfolio), 'Таблица публичного портфолио недоступна');

const portfolioPhotosResult = await checkedFetch(new URL('/rest/v1/portfolio_photos?select=id&limit=1', supabaseUrl), { headers: apiHeaders });
const portfolioPhotos = await portfolioPhotosResult.response.json();
assert.ok(Array.isArray(portfolioPhotos), 'Таблица фотографий портфолио недоступна');

const slotsResult = await checkedFetch(new URL('/rest/v1/rpc/get_available_slots', supabaseUrl), {
  method: 'POST',
  headers: apiHeaders,
  body: JSON.stringify({
    p_service: services[0].id,
    p_start: isoDateInSamara(),
    p_end: isoDateInSamara(14)
  })
});
const slots = await slotsResult.response.json();
assert.ok(Array.isArray(slots), 'RPC свободных окон вернул ответ неожиданного формата');

const managementResult = await checkedFetch(new URL('/rest/v1/rpc/get_booking_management', supabaseUrl), {
  method: 'POST',
  headers: apiHeaders,
  body: JSON.stringify({ p_token: crypto.randomUUID() })
});
const management = await managementResult.response.json();
assert.ok(Array.isArray(management), 'RPC управления записью вернул ответ неожиданного формата');

const reviewsResult = await checkedFetch(new URL('/rest/v1/rpc/get_public_booking_reviews', supabaseUrl), {
  method: 'POST', headers: apiHeaders, body: '{}'
});
const reviews = await reviewsResult.response.json();
assert.ok(Array.isArray(reviews), 'RPC публичных отзывов вернул ответ неожиданного формата');

const clientBookingsV2Result = await checkedFetch(new URL('/rest/v1/rpc/get_client_bookings_v2', supabaseUrl), {
  method: 'POST', headers: apiHeaders, body: JSON.stringify({ p_session_token: 'health-check-invalid-session' })
});
const clientBookingsV2 = await clientBookingsV2Result.response.json();
assert.ok(Array.isArray(clientBookingsV2), 'RPC повторной записи вернул ответ неожиданного формата');

if (process.env.MINUTA_EXPECT_IDEMPOTENCY === '1') {
  // Заведомо невалидный UUID отклоняется PostgREST при приведении типа до вызова SQL-функции.
  // Так проверяется наличие шестипараметровой сигнатуры v43 без запуска функции и без записи в БД.
  const probeResult = await timedFetch(new URL('/rest/v1/rpc/book_appointment', supabaseUrl), {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify({
      p_request_id: 'minuta-health-check-invalid-uuid',
      p_service: services[0].id,
      p_date: isoDateInSamara(14),
      p_time: '00:00:00',
      p_client_name: 'Проверка мониторинга',
      p_client_phone: '+7 999 000-00-00'
    })
  });
  const probe = await probeResult.response.json().catch(() => null);
  assert.equal(probeResult.response.status, 400, `Проверка идемпотентной RPC вернула HTTP ${probeResult.response.status}`);
  assert.doesNotMatch(probe?.code || '', /^PGRST202$/, 'Идемпотентная RPC версии 43 не найдена');
  assert.match(probe?.message || '', /invalid input syntax for type uuid/i, 'Идемпотентная RPC версии 43 не подтвердила UUID-параметр');
}

console.log(`Minuta production health: OK; ${timings.join(', ')}; assets ${assetUrls.size}; config ${configResult.elapsed}мс; worker ${workerResult.elapsed}мс; auth ${authResult.elapsed}мс; services ${servicesResult.elapsed}мс; portfolio ${portfolioResult.elapsed}мс; photos ${portfolioPhotosResult.elapsed}мс; slots ${slotsResult.elapsed}мс; management ${managementResult.elapsed}мс; reviews ${reviewsResult.elapsed}мс; client-v2 ${clientBookingsV2Result.elapsed}мс`);
} catch (error) {
  console.error(`Minuta production health: FAIL; ${error?.message || error}`);
  process.exitCode = 1;
}
