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
        <link rel="stylesheet" href="/settings-smart-search.css">
        <style>*{box-sizing:border-box}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}label{display:block;margin-top:16px}input{height:49px;margin-top:8px}</style>
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
              <section class="mobile-more-group">
                <button type="button" data-provider-view="bookings"><strong>Записи</strong><small>Лента времени и визиты</small></button>
                <button type="button" data-provider-view="clients"><strong>Клиенты</strong><small>История, контакты и заметки</small></button>
                <button type="button" data-provider-view="waitlist"><strong>Лист ожидания</strong><small>Заявки клиентов на занятые даты</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="schedule"><strong>Рабочие часы</strong><small>Доступность, перерывы и выходные</small></button>
                <button type="button" data-provider-view="services"><strong>Услуги</strong><small>Цены и длительность</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="analytics"><strong>Статистика</strong><small>Доход, визиты и показатели</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="settings"><strong>Настройки кабинета</strong><small>Стиль, правила и пароль</small></button>
                <a class="mobile-help-shortcut" href="#help"><strong>База знаний</strong><small>Инструкции по разделам</small></a>
              </section>
            </div>
          </section>
          <script>document.addEventListener('click', event => { const view = event.target.closest('[data-provider-view]'); if (view) document.body.dataset.openedView = view.dataset.providerView; const tab = event.target.closest('[data-section-target]'); if (tab) document.body.dataset.tabClicks = String(Number(document.body.dataset.tabClicks) + 1); });</script>
          <script src="/settings-smart-search.js"></script>
        </body>`);
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!['settings-smart-search.js', 'settings-smart-search.css', 'settings-nav-scroll.js', 'settings-nav-scroll.css'].includes(name)) {
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
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.goto(fixture.url);

  const search = page.locator('#cabinetSectionsSearchInput');
  await assert.doesNotReject(() => search.waitFor({ state:'visible' }));

  const alignment = await page.locator('.cabinet-sections-search .settings-search-field').evaluate(field => {
    const center = element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; };
    const label = field.querySelector('label');
    const input = field.querySelector('input');
    return {
      field:center(field),
      label:center(label),
      input:center(input),
      searchIcon:center(field.querySelector(':scope > .ui-icon')),
      voice:center(field.querySelector('.settings-search-voice')),
      labelMargin:getComputedStyle(label).margin,
      inputMargin:getComputedStyle(input).margin
    };
  });
  assert.ok(Math.abs(alignment.input - alignment.field) <= 1, `Поле поиска смещено относительно центра контейнера: ${JSON.stringify(alignment)}`);
  assert.ok(Math.abs(alignment.searchIcon - alignment.field) <= 1, `Иконка поиска смещена относительно центра контейнера: ${JSON.stringify(alignment)}`);
  assert.ok(Math.abs(alignment.voice - alignment.field) <= 1, `Иконка микрофона смещена относительно центра контейнера: ${JSON.stringify(alignment)}`);

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    await search.fill('Лист');
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Лист ожидания/);
    const layout = await page.locator('.cabinet-sections-search').evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left:box.left, right:box.right, viewport:window.innerWidth, pageWidth:document.documentElement.scrollWidth };
    });
    assert.ok(layout.left >= 0 && layout.right <= layout.viewport, `Поиск вышел за экран на ширине ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.pageWidth <= layout.viewport, `Появился горизонтальный скролл на ширине ${width}: ${JSON.stringify(layout)}`);
  }

  await search.fill('клиетны');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Клиенты/);

  await search.fill('rkbytyns');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Клиенты/);

  for (const query of ['Лист', 'лист ожыдания', 'очередь', 'kbcn j;blfybz']) {
    await search.fill(query);
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Лист ожидания/, `Не найден лист ожидания по запросу: ${query}`);
  }

  for (const query of ['статисика', 'пасматреть дохот']) {
    await search.fill(query);
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Статистика/, `Не найдена статистика по запросу: ${query}`);
  }

  await search.fill('добавить услугу');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Услуги/);

  await search.fill('лист ажыданя');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Лист ожидания/);
  assert.match(await page.locator('.cabinet-sections-search .settings-search-status').innerText(), /Возможно, вы искали/);

  await search.fill('абракадабра');
  assert.equal(await page.locator('#cabinetSectionsSearchResults button').count(), 0, 'Поиск не должен предлагать случайный раздел');

  await search.fill('посмотреть доход');
  assert.match(await page.locator('#cabinetSectionsSearchResults').innerText(), /Статистика/);
  await page.locator('#cabinetSectionsSearchResults button', { hasText:'Статистика' }).click();
  assert.equal(await page.locator('body').getAttribute('data-opened-view'), 'analytics');

  await page.setViewportSize({ width:390, height:844 });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${fixture.url}settings-nav-scroll.css"><style>.provider-section-nav{display:flex;width:260px;overflow-x:auto;gap:8px}.provider-section-nav button{flex:0 0 112px}</style><body class="provider-body" data-tab-clicks="0"><main data-provider-panel="settings"><nav class="provider-section-nav"><button class="active" data-section-target="one">Оформление</button><button data-section-target="two">Уведомления</button><button data-section-target="three">Приложение</button><button data-section-target="four">Безопасность</button></nav></main><script>document.addEventListener('click',event=>{if(event.target.closest('[data-section-target]'))document.body.dataset.tabClicks=String(Number(document.body.dataset.tabClicks)+1)})</script><script src="${fixture.url}settings-nav-scroll.js"></script>`);
  await page.waitForSelector('.settings-section-picker select');
  assert.equal(await page.locator('.settings-section-picker option').count(), 4, 'Список не показывает все разделы');
  await page.locator('.settings-section-picker select').selectOption('three');
  assert.equal(await page.locator('body').getAttribute('data-tab-clicks'), '1', 'Выбор не открыл нужный раздел');
  console.log('Settings and sections search browser regression: OK');
} finally {
  await browser.close();
  await new Promise(resolve => fixture.server.close(resolve));
}
