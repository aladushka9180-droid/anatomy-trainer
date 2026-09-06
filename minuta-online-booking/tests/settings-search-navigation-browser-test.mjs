import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = fileURLToPath(new URL('../', import.meta.url));

async function startFixture() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
        <body class="provider-body" data-provider-theme="sage" data-provider-layout="soft" data-opened-view="" data-tab-clicks="0">
          <section data-provider-panel="settings" hidden>
            <nav class="provider-section-nav" aria-label="Навигация по настройкам">
              <button class="active" type="button" data-section-target="appearanceSettingsCard">Внешний вид</button>
              <button type="button" data-section-target="bookingRulesCard">Онлайн-запись</button>
              <button type="button" data-section-target="accountSettingsCard">Безопасность</button>
              <button type="button" data-section-target="installAppCard">Приложение</button>
            </nav>
            <section id="appearanceSettingsCard"><h3>Оформление</h3></section>
            <section id="bookingRulesCard"><h3>Правила записи</h3></section>
            <section id="accountSettingsCard"><h3>Пароль</h3></section>
            <section id="installAppCard"><h3>Установить приложение</h3></section>
          </section>
          <section data-provider-panel="more">
            <p class="mobile-more-intro">Выберите нужный раздел.</p>
            <div class="mobile-more-grid">
              <button type="button" data-provider-view="settings"><strong>Настройки кабинета</strong><small>Стиль, правила и пароль</small></button>
              <button type="button" data-provider-view="bookings"><strong>Записи</strong><small>Лента времени и визиты</small></button>
              <button type="button" data-provider-view="clients"><strong>Клиенты</strong><small>История, контакты и заметки</small></button>
              <button type="button" data-provider-view="schedule"><strong>Рабочие часы</strong><small>Доступность, перерывы и выходные</small></button>
              <button type="button" data-provider-view="services"><strong>Услуги</strong><small>Цены и длительность</small></button>
              <button type="button" data-provider-view="analytics"><strong>Статистика</strong><small>Доход, визиты и показатели</small></button>
              <a class="mobile-help-shortcut" href="#help"><strong>База знаний</strong><small>Инструкции по разделам</small></a>
            </div>
          </section>
          <script>document.addEventListener('click', event => { const view = event.target.closest('[data-provider-view]'); if (view) document.body.dataset.openedView = view.dataset.providerView; const tab = event.target.closest('[data-section-target]'); if (tab) document.body.dataset.tabClicks = String(Number(document.body.dataset.tabClicks) + 1); });</script>
          <script src="/settings-smart-search.js"></script>
        </body>`);
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!['settings-smart-search.js', 'settings-nav-scroll.js', 'settings-nav-scroll.css'].includes(name)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await readFile(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url:`http://127.0.0.1:${server.address().port}/` };
}

const fixture = await startFixture();
const browser = await chromium.launch({
  headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
});
try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(fixture.url);

  const search = page.locator('#cabinetSectionsSearchInput');
  await assert.doesNotReject(() => search.waitFor({ state:'visible' }));

  await search.fill('клиетны');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Клиенты/);

  await search.fill('rkbytyns');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Клиенты/);

  await search.fill('посмотреть доход');
  assert.match(await page.locator('#cabinetSectionsSearchResults').innerText(), /Статистика/);
  await page.locator('#cabinetSectionsSearchResults button', { hasText:'Статистика' }).click();
  assert.equal(await page.locator('body').getAttribute('data-opened-view'), 'analytics');

  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${fixture.url}settings-nav-scroll.css"><style>.provider-section-nav{display:flex;width:260px;overflow-x:auto;gap:8px}.provider-section-nav button{flex:0 0 112px}</style><body class="provider-body" data-tab-clicks="0"><main data-provider-panel="settings"><nav class="provider-section-nav"><button class="active" data-section-target="one">Оформление</button><button data-section-target="two">Уведомления</button><button data-section-target="three">Приложение</button><button data-section-target="four">Безопасность</button></nav></main><script>document.addEventListener('click',event=>{if(event.target.closest('[data-section-target]'))document.body.dataset.tabClicks=String(Number(document.body.dataset.tabClicks)+1)})</script><script src="${fixture.url}settings-nav-scroll.js"></script>`);
  await page.waitForFunction(() => {
    const next = document.querySelector('.settings-nav-scroll-arrow.is-next');
    return next && !next.hidden;
  });
  const before = await page.locator('.provider-section-nav').evaluate(nav => ({ scrollLeft:nav.scrollLeft, active:nav.querySelector('.active')?.dataset.sectionTarget }));
  await page.locator('.settings-nav-scroll-arrow.is-next').click();
  await page.waitForFunction(previous => document.querySelector('.provider-section-nav').scrollLeft > previous, before.scrollLeft);
  const after = await page.locator('.provider-section-nav').evaluate(nav => ({ scrollLeft:nav.scrollLeft, active:nav.querySelector('.active')?.dataset.sectionTarget }));
  assert.ok(after.scrollLeft > before.scrollLeft, 'Стрелка не сдвинула ленту вкладок');
  assert.equal(after.active, before.active, 'Стрелка переключила активный раздел');
  assert.equal(await page.locator('body').getAttribute('data-tab-clicks'), '0', 'Стрелка вызвала нажатие вкладки');
  console.log('Settings and sections search browser regression: OK');
} finally {
  await browser.close();
  await new Promise(resolve => fixture.server.close(resolve));
}
