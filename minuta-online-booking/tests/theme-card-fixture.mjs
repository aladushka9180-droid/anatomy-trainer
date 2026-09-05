import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export const themes = ['sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi','midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter','celadon','snow-leopard'];
export const layouts = ['linear','soft','capsule','editorial','bento','split'];
const marks = ['', 'active', 'client-vip', 'client-favorite', 'client-attention', 'client-vip active', 'client-favorite active', 'client-attention active', 'client-favorite client-vip client-attention'];
const labels = ['Обычный клиент','Выбранный клиент','VIP-клиент','Избранный клиент','Требует внимания','Выбранный VIP','Выбранный избранный','Выбранный с вниманием','Несколько меток'];
const icon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 6 5 5 4-7 4 7 5-5-2 14H5Z"/></svg>';
const badge = mark => mark.includes('client-') ? `<span class="client-badges with-labels"><span class="client-badge badge-${mark.includes('vip') ? 'vip' : mark.includes('attention') ? 'attention' : 'favorite'}">${mark.includes('vip') ? icon : mark.includes('attention') ? '!' : '♥'}</span></span>` : '';

async function fixture(url) {
  const theme = themes.includes(url.searchParams.get('theme')) ? url.searchParams.get('theme') : 'botanical';
  const layout = layouts.includes(url.searchParams.get('layout')) ? url.searchParams.get('layout') : 'soft';
  const html = await readFile(path.join(root, 'provider.html'), 'utf8');
  // Always load the actual production cascade, including future finishing layers.
  const links = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)].map(match => `<link rel="stylesheet" href="/assets/${match[1]}">`).join('\n') + '<style>*,*::before,*::after{transition:none!important;animation:none!important}.fixture>h2,.fixture>.view-description{background:var(--theme-surface)}</style>';
  const clients = marks.map((mark, i) => `<button type="button" class="client-list-item ${mark}" data-card="client-${i}"><span class="client-list-avatar">А</span><span class="client-list-main"><span class="client-list-name-row"><strong>${labels[i]}</strong>${badge(mark)}</span><small>+7 (900) 000-00-00</small><i>Нет будущих записей</i></span><b>3</b></button>`).join('');
  const bookings = marks.filter(mark => !mark.includes('active')).map((mark, i) => `<article class="provider-booking status-confirmed color-sage ${mark}" data-card="booking-${i}"><button class="provider-booking-open" type="button"><span class="booking-time-column"><strong>11:00<small>до 12:30</small></strong><span>5 сентября</span></span><span class="booking-main"><span class="provider-booking-top"><h3>Массаж всего тела</h3><span class="booking-status">Подтверждена</span></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Анна — тестовый клиент</strong>${badge(mark)}</span><span class="provider-booking-phone">+7 (900) 000-00-00</span></span><span class="provider-booking-signals"><span class="provider-booking-note-full"><b>Заметка:</b> Проверка оформления</span></span></span><span class="provider-booking-chevron">›</span></button></article>`).join('');
  const timeline = marks.filter(mark => !mark.includes('active')).map((mark, i) => `<button type="button" class="timeline-booking status-confirmed color-sage ${mark}" data-card="timeline-${i}" data-booking-duration="90" style="position:relative;inset:auto;width:100%;height:190px;margin:8px 0"><span class="timeline-booking-time"><b>11:00</b><small>–12:30</small></span><span class="timeline-booking-copy"><strong>Массаж всего тела</strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:30 · </span><span class="timeline-client-name">Анна — тестовый клиент</span><span class="timeline-client-phone">+7 (900) 000-00-00</span></small></span>${badge(mark)}<small class="timeline-booking-note">Проверка оформления</small></span><span class="timeline-booking-status">Подтверждена</span></button>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Тест карточек — без данных клиентов</title>${links}<style>.fixture{max-width:1100px;margin:0 auto;padding:16px}.fixture-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.fixture .clients-list{max-height:none;overflow:visible}.fixture .client-list-item{width:100%}.fixture .provider-view{display:block}.fixture h2{font-size:22px}@media(max-width:760px){.fixture-columns{grid-template-columns:1fr}}</style></head><body class="provider-body" data-provider-theme="${theme}" data-provider-layout="${layout}" data-provider-text-scale="default"><main class="fixture"><h2>Проверка оформления карточек</h2><p class="view-description" data-secondary>Только искусственные данные. Клиенты и записи не изменяются.</p><nav class="provider-section-nav"><button type="button" data-secondary>Клиенты</button><button type="button" class="active">Записи</button></nav><div class="fixture-columns"><section class="clients-directory"><div class="client-search"><input aria-label="Поиск клиента" placeholder="Имя или телефон"></div><div class="clients-list">${clients}</div></section><section class="provider-view"><div class="provider-bookings schedule-list">${bookings}</div><div class="provider-bookings timeline-view">${timeline}</div></section></div></main></body></html>`;
}

function runner() {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Матрица оформления</title><h1>21 тема × 6 компоновок × 2 ширины</h1><p>Локальные тестовые карточки, без доступа к клиентской базе.</p><button id="run">Проверить все сочетания</button><pre id="result" role="status">Готово к проверке</pre><iframe title="Проверяемые карточки" src="/fixture" style="width:390px;height:900px;border:0"></iframe><script type="module">
import { inspectCardStates } from '/checks.mjs';
const frame = document.querySelector('iframe'), result = document.querySelector('#result');
document.querySelector('#run').addEventListener('click', async () => {
  document.querySelector('#run').disabled = true;
  result.dataset.complete = ''; const failures = []; let combinations = 0, assertions = 0, minimumContrast = 100;
  try {
    if (frame.contentDocument.readyState !== 'complete') await new Promise(resolve => frame.addEventListener('load', resolve, {once:true}));
    for (const width of [390,1440]) for (const layout of ${JSON.stringify(layouts)}) for (const theme of ${JSON.stringify(themes)}) {
      frame.style.width = width + 'px';
      frame.contentDocument.body.dataset.providerTheme = theme;
      frame.contentDocument.body.dataset.providerLayout = layout;
      // Flush style/layout and fonts in the actual iframe viewport.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await frame.contentDocument.fonts.ready;
      const report = inspectCardStates(frame.contentDocument);
      failures.push(...report.failures.map(failure => ({theme,layout,width,...failure})));
      assertions += report.assertions; minimumContrast = Math.min(minimumContrast, report.minimumContrast); combinations++;
      result.textContent = JSON.stringify({combinations,assertions,minimumContrast,failures});
    }
    result.dataset.complete = 'true'; result.dataset.passed = String(failures.length === 0);
  } catch(error) {result.textContent = String(error.stack); result.dataset.complete='true'; result.dataset.passed='false';}
  document.querySelector('#run').disabled = false;
});</script></html>`;
}

export async function startFixtureServer(port = 0) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store');
      if (url.pathname === '/fixture' || url.pathname === '/') {
        response.setHeader('Content-Type','text/html; charset=utf-8');
        response.end(url.pathname === '/fixture' ? await fixture(url) : runner()); return;
      }
      const name = url.pathname === '/checks.mjs' ? 'tests/theme-card-checks.mjs' : decodeURIComponent(url.pathname.replace(/^\/assets\//, ''));
      const target = path.resolve(root, name);
      // Only local CSS, fonts, images and this test module; never serve config/auth/DB files.
      if (!target.startsWith(root) || !/\.(css|woff2?|ttf|svg|webp|png)$/.test(target) && name !== 'tests/theme-card-checks.mjs') { response.writeHead(404).end(); return; }
      const types = {'.css':'text/css','.mjs':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.png':'image/png','.webp':'image/webp'};
      response.setHeader('Content-Type',types[path.extname(target)] || 'application/octet-stream');
      response.end(await readFile(target));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return {server, url:`http://127.0.0.1:${server.address().port}`};
}

if (process.argv.includes('--serve')) {
  const { url } = await startFixtureServer(Number(process.env.THEME_FIXTURE_PORT || 38509));
  console.log(`Theme fixture: ${url}`);
}
