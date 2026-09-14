import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_RECORDS_V781_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    content = content.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'cocoa-pearl';
    document.body.dataset.providerLayout = 'capsule';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'bookings';
      view.classList.toggle('active', view.dataset.providerPanel === 'bookings');
    });
    document.querySelector('.provider-mobile-create').hidden = true;
    const filters = document.querySelector('.booking-filters');
    filters.hidden = false;
    filters.addEventListener('click', event => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      filters.querySelectorAll('[data-filter]').forEach(item => item.classList.toggle('active', item === button));
      document.querySelector('#providerBookings').dataset.recordsFilter = button.dataset.filter;
    });
    const bookings = document.querySelector('#providerBookings');
    bookings.className = 'provider-bookings schedule-list';
    bookings.dataset.recordsFilter = 'day';
    bookings.innerHTML = `
      <article class="provider-booking status-confirmed color-auto is-imported-history client-vip">
        <button class="provider-booking-open" type="button" aria-label="Общий массаж задней поверхности. Открыть подробности">
          <span class="booking-time-column"><strong>10:30<small>до 11:30</small></strong><span>Вт, 4 авг.</span></span>
          <span class="booking-main"><span class="provider-booking-top"><h3>Общий массаж задней поверхности. Проминающий интенсивный или расслабляющий нежный</h3></span>
          <span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Евгения Белышева</strong><span class="client-badges with-labels"><span class="client-badge badge-vip"><span class="client-badge-label">VIP</span></span></span></span><span class="provider-booking-phone">+7 912 000-00-00</span><span class="booking-client-visit">Новый · 1-й визит</span></span>
          <span class="provider-booking-signals"><span class="booking-status">Импортировано</span></span></span><span class="provider-booking-chevron">›</span>
        </button>
      </article>
      <article class="provider-booking status-block color-auto is-schedule-block">
        <button class="provider-booking-open" type="button" aria-label="Перерыв, с 12:30 до 13:30. Открыть подробности">
          <span class="booking-time-column"><strong>12:30<small>до 13:30</small></strong><span>Вт, 4 авг.</span></span>
          <span class="booking-main"><span class="provider-booking-top"><h3>Перерыв</h3></span><span class="provider-booking-client-line"><span class="booking-break-origin">Ручной</span></span><span class="provider-booking-signals"></span></span><span class="provider-booking-chevron">›</span>
        </button>
      </article>`;
  });

  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height:900 });
    for (const filter of ['day', 'upcoming', 'all']) {
      await page.locator(`[data-filter="${filter}"]`).click();
      assert.equal(await page.locator('#providerBookings').getAttribute('data-records-filter'), filter, `${width}px ${filter} filter click failed`);
    }
    const cards = await page.evaluate(() => {
      const first = document.querySelector('.provider-booking-open');
      const title = first.querySelector('h3');
      const titleStyle = getComputedStyle(title);
      const nameRow = first.querySelector('.booking-client-name-row').getBoundingClientRect();
      const vip = first.querySelector('.client-badges').getBoundingClientRect();
      const phone = first.querySelector('.provider-booking-phone');
      const block = document.querySelector('.is-schedule-block .provider-booking-open');
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        cardHeight:first.getBoundingClientRect().height,
        blockHeight:block.getBoundingClientRect().height,
        titleLines:title.getBoundingClientRect().height / parseFloat(titleStyle.lineHeight),
        fullAccessibleTitle:first.getAttribute('aria-label').includes('Общий массаж задней поверхности'),
        vipRightGap:nameRow.right - vip.right,
        phoneVisible:phone.getBoundingClientRect().width > 0,
        phoneFits:phone.scrollWidth <= phone.clientWidth + 1,
        breakText:block.textContent.replace(/\s+/g, ' ').trim()
      };
    });
    assert.equal(cards.overflow, false, `${width}px cards overflow horizontally: ${JSON.stringify(cards)}`);
    assert.ok(cards.cardHeight >= 72 && cards.cardHeight <= 118, `${width}px long record card is not compact: ${JSON.stringify(cards)}`);
    assert.ok(cards.blockHeight >= 64 && cards.blockHeight <= 82, `${width}px break card is not compact: ${JSON.stringify(cards)}`);
    assert.ok(cards.titleLines <= 2.05, `${width}px long title exceeds two visible lines: ${JSON.stringify(cards)}`);
    assert.equal(cards.fullAccessibleTitle, true, `${width}px compact title lost its accessible full text`);
    assert.ok(cards.vipRightGap <= 1, `${width}px VIP badge is not aligned right: ${JSON.stringify(cards)}`);
    assert.equal(cards.phoneVisible && cards.phoneFits, true, `${width}px phone is missing or clipped: ${JSON.stringify(cards)}`);
    assert.match(cards.breakText, /Перерыв.*Ручной/);
    assert.doesNotMatch(cards.breakText, /Занятое время|60 мин/);

    for (const layout of ['capsule', 'linear', 'soft', 'bento']) {
      await page.evaluate(value => { document.body.dataset.providerLayout = value; }, layout);
      await page.waitForTimeout(220);
      const buttons = page.locator('.provider-mobile-nav>button');
      for (let index = 0; index < await buttons.count(); index += 1) {
        await page.evaluate(activeIndex => {
          document.querySelectorAll('.provider-mobile-nav>button').forEach((button, buttonIndex) => button.classList.toggle('active', activeIndex === buttonIndex));
          const badge = document.querySelector('.mobile-nav-badge');
          badge.hidden = false;
          badge.textContent = '4';
        }, index);
        await buttons.nth(index).click();
        const nav = await page.evaluate(activeIndex => {
          const panel = document.querySelector('.provider-mobile-nav').getBoundingClientRect();
          const active = document.querySelectorAll('.provider-mobile-nav>button')[activeIndex];
          const rect = active.getBoundingClientRect();
          const style = getComputedStyle(active);
          const panelStyle = getComputedStyle(document.querySelector('.provider-mobile-nav'));
          const badge = document.querySelector('.mobile-nav-badge').getBoundingClientRect();
          return {
            panelRadius:parseFloat(panelStyle.borderTopLeftRadius),
            activeRadius:parseFloat(style.borderTopLeftRadius),
            activeHeight:rect.height,
            topInset:rect.top - panel.top,
            bottomInset:panel.bottom - rect.bottom,
            leftContained:rect.left >= panel.left,
            rightContained:rect.right <= panel.right,
            labelsFit:[...document.querySelectorAll('.provider-mobile-nav>button>span:not(.ui-icon)')].every(label => label.scrollWidth <= label.clientWidth + 1),
            badgeContained:badge.left >= panel.left && badge.right <= panel.right && badge.top >= panel.top && badge.bottom <= panel.bottom,
            overflow:document.documentElement.scrollWidth > innerWidth + 1
          };
        }, index);
        assert.equal(nav.overflow, false, `${width}px ${layout} nav overflows: ${JSON.stringify(nav)}`);
        assert.ok(nav.activeHeight >= 44, `${width}px ${layout} nav target is too small`);
        assert.ok(nav.topInset >= 2 && nav.bottomInset >= 2, `${width}px ${layout} active item touches its frame: ${JSON.stringify(nav)}`);
        assert.equal(nav.leftContained && nav.rightContained && nav.badgeContained, true, `${width}px ${layout} first/last/badge escapes nav: ${JSON.stringify(nav)}`);
        assert.equal(nav.labelsFit, true, `${width}px ${layout} nav label is clipped`);
        if (layout === 'capsule') assert.ok(nav.panelRadius >= 20 && nav.activeRadius >= 20, `${width}px capsule geometry is not round: ${JSON.stringify(nav)}`);
        if (layout === 'linear') assert.ok(nav.panelRadius <= 1 && nav.activeRadius <= 1, `${width}px linear geometry is unexpectedly round: ${JSON.stringify(nav)}`);
      }
      await buttons.first().click();
      await page.keyboard.press('Tab');
      const keyboardFocus = await page.evaluate(() => {
        const focused = document.activeElement;
        return {
          insideNav:focused?.matches?.('.provider-mobile-nav>button') || false,
          outline:focused ? getComputedStyle(focused).outlineStyle : 'none'
        };
      });
      assert.equal(keyboardFocus.insideNav && keyboardFocus.outline === 'solid', true, `${width}px ${layout} keyboard focus is not visible: ${JSON.stringify(keyboardFocus)}`);
      if (output) await page.screenshot({ path:path.join(output, `records-${layout}-${width}.png`), fullPage:false });
    }
  }
  console.log('PrimeTime Pro record cards and mobile navigation v781: PASS at 390/760');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
