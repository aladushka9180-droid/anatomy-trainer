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
        <body class="provider-body" data-provider-theme="sage" data-provider-layout="soft" data-opened-view="more" data-opened-dialog="" data-side-effects="0" data-tab-clicks="0">
          <button id="fixtureMore" type="button" data-provider-view="more" style="position:fixed;right:0;bottom:0">Разделы</button>
          <section data-provider-panel="settings" hidden>
            <nav class="provider-section-nav" aria-label="Навигация по настройкам">
              <button class="active" type="button" data-section-target="appearanceSettingsCard">Внешний вид</button>
              <button type="button" data-section-target="bookingRulesCard">Онлайн-запись</button>
              <button type="button" data-section-target="clientAppearanceSettingsCard">Страница для клиентов</button>
              <button type="button" data-section-target="accountSettingsCard">Безопасность</button>
              <button type="button" data-section-target="installAppCard">Приложение</button>
            </nav>
            <section id="appearanceSettingsCard"><h3>Оформление</h3></section>
            <section id="bookingRulesCard"><h3>Правила записи</h3></section>
            <section id="clientAppearanceSettingsCard"><h3 id="clientAppearanceTitle">Оформление клиентской страницы</h3><button id="openBookingWidgets" type="button">Ссылки и виджет</button></section>
            <section id="accountSettingsCard"><h3>Пароль</h3></section>
            <section id="installAppCard"><h3>Установить приложение</h3></section>
          </section>
          <section data-provider-panel="bookings" hidden><h2>Расписание</h2><button id="newBookingButton" type="button">Новая запись</button></section>
          <section data-provider-panel="clients" hidden><h2>Клиенты</h2></section>
          <section data-provider-panel="notifications" hidden><h2>Уведомления</h2></section>
          <section data-provider-panel="schedule" hidden><h2>Рабочие часы</h2></section>
          <section data-provider-panel="services" hidden><h2>Мои услуги</h2><button type="button" data-open-service-creator>Добавить услугу</button></section>
          <section data-provider-panel="analytics" hidden><h2>Статистика</h2><button type="button" data-report-view="money">Деньги</button><h3 id="moneyDashboardTitle">Финансовый результат</h3></section>
          <section data-provider-panel="organization" hidden><h2>Организация</h2><nav class="provider-section-nav"><button data-section-target="organizationPeopleSection">Люди и филиалы</button></nav><section id="organizationPeopleSection"><h3>Команда и адреса</h3></section></section>
          <section data-provider-panel="portfolio" hidden><h2>Портфолио</h2></section>
          <section data-provider-panel="waitlist" hidden><h2>Лист ожидания</h2></section>
          <section data-provider-panel="feedback-inbox" hidden><h2>Обращения</h2></section>
          <section data-provider-panel="more">
            <p class="mobile-more-intro">Выберите нужный раздел.</p>
            <div class="mobile-more-grid">
              <section class="mobile-more-group">
                <button type="button" data-provider-view="feedback-inbox"><strong>Обращения</strong><small>Ошибки и предложения команды</small></button>
                <button type="button" data-provider-view="bookings"><strong>Записи</strong><small>Лента времени и визиты</small></button>
                <button type="button" data-provider-view="clients"><strong>Клиенты</strong><small>История, контакты и заметки</small></button>
                <button type="button" data-provider-view="notifications"><strong>Уведомления</strong><small>Сообщения клиентам и шаблоны</small></button>
                <button type="button" data-provider-view="waitlist"><strong>Лист ожидания</strong><small>Заявки клиентов на занятые даты</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="schedule"><strong>Рабочие часы</strong><small>Доступность, перерывы и выходные</small></button>
                <button type="button" data-provider-view="services"><strong>Услуги</strong><small>Цены и длительность</small></button>
                <button type="button" data-provider-view="organization"><strong>Организация</strong><small>Команда, филиалы и ресурсы</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="analytics"><strong>Статистика</strong><small>Доход, визиты и показатели</small></button>
                <button type="button" data-provider-view="portfolio"><strong>Портфолио</strong><small>Фото работ и примеры</small></button>
              </section>
              <section class="mobile-more-group">
                <button type="button" data-provider-view="settings"><strong>Настройки кабинета</strong><small>Стиль, правила и пароль</small></button>
                <a class="mobile-help-shortcut" href="#help"><strong>База знаний</strong><small>Инструкции по разделам</small></a>
              </section>
            </div>
            <button type="button" data-open-product-feedback hidden><strong>Обратная связь</strong></button>
          </section>
          <button id="shareProviderClientPage" type="button">Поделиться ссылкой для записи</button>
          <div class="booking-sheet" id="bookingSheet" hidden><section role="dialog"><div id="bookingSheetContent"><input id="newBookingName"></div></section></div>
          <dialog id="serviceCreatorDialog"><h2 id="serviceCreatorTitle">Новая услуга</h2><input id="serviceName"></dialog>
          <dialog id="bookingWidgetsDialog"><h2 id="bookingWidgetsTitle">Ссылки и виджет</h2><textarea id="bookingWidgetOutput" readonly></textarea></dialog>
          <dialog id="productFeedbackDialog"><h2 id="productFeedbackTitle">Помощь и обратная связь</h2><textarea id="productFeedbackMessage"></textarea></dialog>
          <script>document.addEventListener('click', event => {
            const view = event.target.closest('[data-provider-view]');
            if (view) {
              document.body.dataset.openedView = view.dataset.providerView;
              document.querySelectorAll('[data-provider-panel]').forEach(panel => { panel.hidden = panel.dataset.providerPanel !== view.dataset.providerView; });
            }
            const tab = event.target.closest('[data-section-target]');
            if (tab) document.body.dataset.tabClicks = String(Number(document.body.dataset.tabClicks) + 1);
            if (event.target.closest('#newBookingButton')) { document.querySelector('#bookingSheet').hidden = false; document.body.dataset.openedDialog = 'booking'; }
            if (event.target.closest('[data-open-service-creator]')) { document.querySelector('#serviceCreatorDialog').showModal(); document.body.dataset.openedDialog = 'service'; }
            if (event.target.closest('#openBookingWidgets')) { document.querySelector('#bookingWidgetsDialog').showModal(); document.body.dataset.openedDialog = 'links'; }
            if (event.target.closest('[data-report-view="money"]')) document.body.dataset.reportView = 'money';
          });</script>
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
  assert.equal(await search.getAttribute('placeholder'), 'Найти раздел', 'Поиск по разделам должен использовать короткую мобильную подсказку');
  assert.equal(await page.locator('.cabinet-sections-search .settings-search-status').innerText(), 'Поиск работает на устройстве по названию или задаче.', 'Подсказка должна объяснять локальную обработку');
  assert.equal(await page.locator('.cabinet-sections-search .settings-search-voice').count(), 0, 'Навигационный запрос не должен уходить во внешнее распознавание речи');

  const registryContract = await page.evaluate(() => {
    const api = window.MinutaSettingsSearch;
    const ids = api.cabinetRegistry.map(record => record.id);
    const missing = api.cabinetRegistry.flatMap(record => {
      const problems = [];
      if (!document.querySelector(`[data-provider-panel="${record.view}"]`)) problems.push(`${record.id}:view`);
      if (record.target && !document.querySelector(record.target)) problems.push(`${record.id}:target`);
      if (record.availabilityTarget && !document.querySelector(record.availabilityTarget)) problems.push(`${record.id}:availability`);
      if (record.sectionTarget && !document.querySelector(`[data-provider-panel="${record.view}"] [data-section-target="${record.sectionTarget}"]`)) problems.push(`${record.id}:section`);
      if (record.focus && !record.focus.split(',').some(selector => document.querySelector(selector.trim()))) problems.push(`${record.id}:focus`);
      return problems;
    });
    const unsafe = api.cabinetRegistry.filter(record => /submit|save|delete|send|refund/i.test(record.target || '')).map(record => record.id);
    return { version:api.cabinetRegistryVersion, ids, missing, unsafe };
  });
  assert.equal(registryContract.version, 1, 'Версия реестра должна быть явной');
  assert.equal(new Set(registryContract.ids).size, registryContract.ids.length, 'ID поискового реестра не должны повторяться');
  assert.deepEqual(registryContract.missing, [], `Все назначения должны разрешаться в актуальном DOM: ${registryContract.missing.join(', ')}`);
  assert.deepEqual(registryContract.unsafe, [], 'Поиск не должен напрямую запускать сохранение, удаление, отправку или возврат');
  assert.equal(await page.evaluate(() => window.MinutaSettingsSearch.normalize('  Ёлка—ОНЛАЙН  ')), 'елка онлайн', 'Нормализация должна учитывать ё/е, регистр и дефисы');

  await search.focus();
  assert.equal(await page.locator('#cabinetSectionsSearchResults button').count(), 3, 'Пустой поиск должен показывать спокойные реальные примеры');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Новая запись/);
  await search.fill('он');
  assert.equal(await page.locator('#cabinetSectionsSearchResults button').count(), 0, 'Короткий запрос не должен создавать хаотичный список');
  assert.equal(await search.getAttribute('aria-expanded'), 'false');

  const alignment = await page.locator('.cabinet-sections-search .settings-search-field').evaluate(field => {
    const center = element => { const box = element.getBoundingClientRect(); return box.top + box.height / 2; };
    const label = field.querySelector('label');
    const input = field.querySelector('input');
    return {
      field:center(field),
      label:center(label),
      input:center(input),
      searchIcon:center(field.querySelector(':scope > .ui-icon')),
      labelMargin:getComputedStyle(label).margin,
      inputMargin:getComputedStyle(input).margin
    };
  });
  assert.ok(Math.abs(alignment.input - alignment.field) <= 1, `Поле поиска смещено относительно центра контейнера: ${JSON.stringify(alignment)}`);
  assert.ok(Math.abs(alignment.searchIcon - alignment.field) <= 1, `Иконка поиска смещена относительно центра контейнера: ${JSON.stringify(alignment)}`);

  const visualModes = [{ theme:'sage', layout:'soft' }, { theme:'graphite', layout:'linear' }, { theme:'noir-suede', layout:'editorial' }];
  for (const [modeIndex, width] of [390, 760, 1440].entries()) {
    const mode = visualModes[modeIndex];
    await page.locator('body').evaluate((body, value) => { body.dataset.providerTheme = value.theme; body.dataset.providerLayout = value.layout; }, mode);
    await page.setViewportSize({ width, height:900 });
    await search.fill('Лист');
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Лист ожидания/);
    const layout = await page.locator('.cabinet-sections-search').evaluate(element => {
      const box = element.getBoundingClientRect();
      const clear = element.querySelector('.settings-search-clear').getBoundingClientRect();
      const input = element.querySelector('input').getBoundingClientRect();
      const result = element.querySelector('.settings-search-results button').getBoundingClientRect();
      return { left:box.left, right:box.right, viewport:window.innerWidth, pageWidth:document.documentElement.scrollWidth, clear:{ width:clear.width, height:clear.height }, inputHeight:input.height, resultHeight:result.height };
    });
    assert.ok(layout.left >= 0 && layout.right <= layout.viewport, `Поиск вышел за экран на ширине ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.pageWidth <= layout.viewport, `Появился горизонтальный скролл на ширине ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.clear.width >= 44 && layout.clear.height >= 44 && layout.inputHeight >= 44 && layout.resultHeight >= 44, `Цели касания меньше 44 px на ширине ${width}: ${JSON.stringify(layout)}`);
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
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Добавить услугу/);

  for (const query of ['онлайн', 'онлайн запись', 'онлайн-запись', 'онлаин запись', 'ссылка для записи', 'страница записи', 'запись клиента']) {
    await search.fill(query);
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Онлайн-запись · (Ссылки и виджет|Страница для клиентов)/, `Не найден экран онлайн-записи по запросу: ${query}`);
  }
  await search.fill('ссылка для записи');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Онлайн-запись · Ссылки и виджет/, 'Запрос ссылки должен предпочитать готовый экран ссылки');

  for (const [query, expected] of [['расписание', 'Записи'], ['рабочие часы', 'Рабочие часы'], ['клиенты', 'Клиенты'], ['уведомления', 'Уведомления'], ['доставка', 'Уведомления'], ['доход', 'Деньги'], ['сотрудники', 'Люди и филиалы'], ['адрес', 'Люди и филиалы'], ['темы', 'Оформление'], ['поддержка', 'База знаний']]) {
    await search.fill(query);
    assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), new RegExp(expected), `Не найден актуальный маршрут по запросу: ${query}`);
  }

  await search.fill('лист ажыданя');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Лист ожидания/);
  assert.match(await page.locator('.cabinet-sections-search .settings-search-status').innerText(), /Возможно, вы искали/);

  await search.fill('абракадабра');
  assert.equal(await page.locator('#cabinetSectionsSearchResults button').count(), 3, 'При отсутствии совпадений должны оставаться только реальные примеры');
  assert.equal(await search.getAttribute('aria-activedescendant'), null, 'Случайный пример не должен выбираться для Enter');
  await search.press('Enter');
  assert.equal(await page.locator('body').getAttribute('data-opened-dialog'), '', 'Enter на бессмысленном запросе не должен открывать действие');

  await search.fill('онлайн');
  const firstOnlineId = await search.getAttribute('aria-activedescendant');
  await search.press('ArrowDown');
  assert.notEqual(await search.getAttribute('aria-activedescendant'), firstOnlineId, 'ArrowDown должен перемещать выбор');
  assert.match(await page.locator('.cabinet-sections-search .settings-search-status').innerText(), /Выбран.+2 из/);
  await search.press('ArrowUp');
  assert.equal(await search.getAttribute('aria-activedescendant'), firstOnlineId, 'ArrowUp должен возвращать выбор');
  await search.press('Escape');
  assert.equal(await search.getAttribute('aria-expanded'), 'false', 'Escape должен закрывать результаты');

  async function reopenSearch() {
    await page.locator('#fixtureMore').click();
    await search.waitFor({ state:'visible' });
    await search.focus();
  }

  await search.fill('ссылка для записи');
  await search.press('Enter');
  await page.locator('#bookingWidgetsDialog').waitFor({ state:'visible' });
  assert.equal(await page.locator('body').getAttribute('data-opened-view'), 'settings');
  assert.equal(await page.locator('body').getAttribute('data-opened-dialog'), 'links');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'bookingWidgetOutput', 'После перехода фокус должен попасть на готовую ссылку');
  assert.equal(await page.locator('body').getAttribute('data-side-effects'), '0', 'Открытие ссылки не должно выполнять значимое действие');
  await page.locator('#bookingWidgetsDialog').evaluate(dialog => dialog.close());
  await reopenSearch();

  await search.fill('добавить услугу');
  await search.press('Enter');
  await page.locator('#serviceCreatorDialog').waitFor({ state:'visible' });
  assert.equal(await page.locator('body').getAttribute('data-opened-dialog'), 'service');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'serviceName', 'Поиск должен открыть форму, но не сохранить услугу');
  assert.equal(await page.locator('body').getAttribute('data-side-effects'), '0');
  await page.locator('#serviceCreatorDialog').evaluate(dialog => dialog.close());
  await reopenSearch();

  await search.fill('новая запись');
  await search.press('Enter');
  await page.locator('#bookingSheet').waitFor({ state:'visible' });
  assert.equal(await page.locator('body').getAttribute('data-opened-dialog'), 'booking');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'newBookingName', 'Поиск должен открыть форму, но не создать запись');
  assert.equal(await page.locator('body').getAttribute('data-side-effects'), '0');
  await page.locator('#bookingSheet').evaluate(sheet => { sheet.hidden = true; });
  await reopenSearch();

  await search.fill('доход');
  await search.press('Enter');
  await page.waitForFunction(() => document.body.dataset.reportView === 'money');
  assert.equal(await page.locator('body').getAttribute('data-opened-view'), 'analytics');
  assert.equal(await page.locator('body').getAttribute('data-report-view'), 'money');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'moneyDashboardTitle');
  await reopenSearch();

  await page.locator('#shareProviderClientPage').evaluate(button => { button.hidden = true; button.disabled = true; });
  await search.fill('ссылка для записи');
  assert.doesNotMatch(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Ссылки и виджет/, 'Недоступная публичная ссылка не должна показываться рабочим действием');
  assert.match(await page.locator('#cabinetSectionsSearchResults button').first().innerText(), /Страница для клиентов/);

  await search.fill('посмотреть доход');
  assert.match(await page.locator('#cabinetSectionsSearchResults').innerText(), /Статистика/);
  await page.locator('#cabinetSectionsSearchResults button', { hasText:'Деньги' }).click();
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
