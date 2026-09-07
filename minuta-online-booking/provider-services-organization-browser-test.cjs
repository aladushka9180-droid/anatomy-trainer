// Read-only fixture for the real provider HTML/CSS. Requires Playwright in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
const output = process.env.MINUTA_SERVICES_ORG_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  response.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport:{ width:760, height:950 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/provider.html');
    await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerLayout = 'bento';
      document.body.dataset.providerTheme = 'midnight';
      document.querySelector('#serviceManageList').innerHTML = `
        <article class="managed-service">
          <button class="service-info service-edit-target" type="button" data-edit-service="service-a" aria-label="Изменить услугу">
            <div><strong>Сверхдлинноеназваниеуслугибезединогопробеладляпроверкибезопасногопереносанателефоне</strong><small>90 мин · 4 500 ₽</small></div>
          </button>
          <div class="manage-actions">
            <button class="service-visibility-toggle" type="button" data-toggle-service="service-a" data-active="true" aria-label="Скрыть услугу от клиентов"><i aria-hidden="true"></i><span>Доступна</span></button>
            <details class="service-more"><summary aria-label="Другие действия"><svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-more"></use></svg></summary><div><button class="danger" type="button"><span>Удалить</span></button></div></details>
          </div>
        </article>`;
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationWorkspace').hidden = false;
    });

    for (const width of [390, 760]) {
      await page.setViewportSize({ width, height:950 });
      for (const panel of ['services','organization']) {
        const result = await page.evaluate(async panelName => {
          document.querySelectorAll('.provider-view').forEach(element => { element.hidden = element.dataset.providerPanel !== panelName; });
          await new Promise(requestAnimationFrame);
          if (panelName === 'services') {
            const card = document.querySelector('.managed-service').getBoundingClientRect();
            const catalog = document.querySelector('.service-catalog').getBoundingClientRect();
            const toggle = document.querySelector('.service-visibility-toggle');
            const more = document.querySelector('.service-more>summary');
            const name = document.querySelector('.service-info strong');
            const infoRect = document.querySelector('.service-info').getBoundingClientRect();
            const actionsRect = document.querySelector('.managed-service .manage-actions').getBoundingClientRect();
            return {
              overflow:document.documentElement.scrollWidth > innerWidth + 2,
              cardInside:card.left >= -1 && card.right <= innerWidth + 1,
              catalogHeight:catalog.height,
              toggleHeight:toggle.getBoundingClientRect().height,
              moreWidth:more.getBoundingClientRect().width,
              moreHeight:more.getBoundingClientRect().height,
              labelVisible:getComputedStyle(toggle.querySelector('span')).display !== 'none',
              nameFits:name.scrollWidth <= name.clientWidth + 1,
              oneRow:Math.min(infoRect.bottom, actionsRect.bottom) - Math.max(infoRect.top, actionsRect.top) > 0
            };
          }
          const selectorHolder = document.querySelector('.organization-section-selector');
          const selector = document.querySelector('#organizationSectionSelect');
          const nav = document.querySelector('#organizationSectionNav');
          const rect = selectorHolder.getBoundingClientRect();
          return {
            overflow:document.documentElement.scrollWidth > innerWidth + 2,
            holderVisible:getComputedStyle(selectorHolder).display !== 'none',
            navHidden:getComputedStyle(nav).display === 'none',
            selectHeight:selector.getBoundingClientRect().height,
            holderInside:rect.left >= -1 && rect.right <= innerWidth + 1
          };
        }, panel);
        assert.equal(result.overflow, false, `${width}px/${panel}: горизонтальное переполнение`);
        if (panel === 'services') {
          assert.equal(result.cardInside, true, `${width}px: карточка услуги вышла за экран`);
          assert.ok(result.catalogHeight < 220, `${width}px: каталог сохраняет лишнюю минимальную высоту`);
          assert.ok(result.toggleHeight >= 44, `${width}px: переключатель видимости меньше 44px`);
          assert.ok(result.moreWidth >= 44 && result.moreHeight >= 44, `${width}px: меню услуги меньше 44px`);
          assert.equal(result.labelVisible, true, `${width}px: видимая подпись состояния скрыта`);
          assert.equal(result.nameFits, true, `${width}px: длинное название не переносится`);
          assert.equal(result.oneRow, true, `${width}px: действия услуги без необходимости ушли на вторую строку`);
        } else {
          assert.equal(result.holderVisible, true, `${width}px: мобильный selector организации скрыт`);
          assert.equal(result.navHidden, true, `${width}px: горизонтальные вкладки организации остались`);
          assert.ok(result.selectHeight >= 44, `${width}px: select организации меньше 44px`);
          assert.equal(result.holderInside, true, `${width}px: selector организации вышел за экран`);
        }
        if (output) await page.screenshot({ path:path.join(output, `${panel}-midnight-bento-${width}.png`), fullPage:false });
      }
    }

    await page.setViewportSize({ width:1440, height:950 });
    const desktop = await page.evaluate(() => {
      document.querySelectorAll('.provider-view').forEach(element => { element.hidden = element.dataset.providerPanel !== 'organization'; });
      return {
        selectorHidden:getComputedStyle(document.querySelector('.organization-section-selector')).display === 'none',
        navVisible:getComputedStyle(document.querySelector('#organizationSectionNav')).display !== 'none'
      };
    });
    assert.deepEqual(desktop, { selectorHidden:true, navVisible:true }, 'Desktop-вкладки организации не сохранены');
    console.log('provider services + organization browser test passed: midnight/bento 390/760px');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
