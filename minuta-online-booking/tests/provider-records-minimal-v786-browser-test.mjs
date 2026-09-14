import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_RECORDS_V785_OUTPUT || '';
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
    const dateStrip = document.querySelector('#dateStrip');
    dateStrip.innerHTML = [
      ['Пн', '12', 'сент.'],
      ['Вт', '13', 'сент.'],
      ['Сегодня', '14', 'сент.'],
      ['Чт', '15', 'сент.'],
      ['Пт', '16', 'сент.']
    ].map(([weekday, day, month], index) => `<button type="button" class="${index === 2 ? 'active is-today' : ''}" aria-label="${weekday}, ${day} сентября"><span>${weekday}</span><strong>${day}</strong><small>${month}</small></button>`).join('');
    document.querySelector('.date-strip-frame').dataset.shiftCount = '0';
    document.querySelectorAll('.date-strip-shift').forEach(button => button.addEventListener('click', () => {
      const frame = button.closest('.date-strip-frame');
      frame.dataset.shiftCount = String(Number(frame.dataset.shiftCount) + Number(button.dataset.dateShift));
    }));
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
      <article class="provider-booking status-confirmed color-auto client-new">
        <button class="provider-booking-open" type="button" aria-label="Массаж спины. Открыть подробности">
          <span class="booking-time-column"><strong>09:00<small>до 10:00</small></strong><span>Вт, 4 авг.</span></span>
          <span class="booking-main"><span class="provider-booking-top"><h3>Массаж спины + ШВЗ — углублённый</h3></span>
          <span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Екатерина.</strong></span><span class="provider-booking-phone">+7 (951) 207-44-60</span></span>
          <span class="provider-booking-signals"><span class="booking-status">Подтверждена</span><span class="booking-client-visit is-new">Новый · 1-й визит</span></span></span><span class="provider-booking-chevron">›</span>
        </button>
      </article>
      <article class="provider-booking status-confirmed color-auto client-vip client-regular">
        <button class="provider-booking-open" type="button" aria-label="Общий массаж с обеих сторон. Открыть подробности">
          <span class="booking-time-column"><strong>10:00<small>до 11:30</small></strong><span>Сб, 26 сент.</span></span>
          <span class="booking-main"><span class="provider-booking-top"><h3>Общий массаж с обеих сторон</h3></span>
          <span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Евгения Белышева</strong><span class="client-badges with-labels"><span class="client-badge badge-vip"><span class="client-badge-label">VIP</span></span></span></span><span class="provider-booking-phone">+7 950 831-03-38</span></span>
          <span class="provider-booking-signals"><span class="booking-status">Подтверждена</span><span class="booking-client-visit is-regular">Постоянный · 4-й визит</span><span class="booking-series-badge">Серия · визит 3 из 3</span></span></span><span class="provider-booking-chevron">›</span>
        </button>
      </article>
      <article class="provider-booking status-confirmed color-auto is-imported-history">
        <button class="provider-booking-open" type="button" aria-label="Общий массаж задней поверхности. Открыть подробности">
          <span class="booking-time-column"><strong>10:30<small>до 11:30</small></strong><span>Вт, 4 авг.</span></span>
          <span class="booking-main"><span class="provider-booking-top"><h3>Общий массаж задней поверхности. Проминающий интенсивный или расслабляющий нежный</h3></span>
          <span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>Артур</strong></span><span class="provider-booking-phone">7 912 768-07-83</span></span>
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
    const themes = [...fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8').matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
    for (const theme of themes) {
      await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
      const strip = await page.evaluate(() => {
        const frame = document.querySelector('.date-strip-frame').getBoundingClientRect();
        const left = document.querySelector('.date-strip-shift[data-date-shift="-7"]');
        const right = document.querySelector('.date-strip-shift[data-date-shift="7"]');
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftMark = getComputedStyle(left, '::before');
        const rightMark = getComputedStyle(right, '::before');
        const dates = [...document.querySelectorAll('#dateStrip>button')];
        const firstRect = dates[0].getBoundingClientRect();
        const lastRect = dates.at(-1).getBoundingClientRect();
        const firstCopy = dates[0].querySelector('span').getBoundingClientRect();
        const lastCopy = dates.at(-1).querySelector('span').getBoundingClientRect();
        return {
          frameContained:frame.left >= -.5 && frame.right <= innerWidth + .5,
          arrowTargets:[leftRect.width, leftRect.height, rightRect.width, rightRect.height],
          markSizes:[parseFloat(leftMark.width), parseFloat(leftMark.height), parseFloat(rightMark.width), parseFloat(rightMark.height)],
          dateWidths:dates.map(date => date.getBoundingClientRect().width),
          copyClear:firstCopy.left >= leftRect.right - .5 && lastCopy.right <= rightRect.left + .5,
          datesContained:firstRect.left >= frame.left && lastRect.right <= frame.right,
          overflow:document.documentElement.scrollWidth > innerWidth + 1,
          labelsFit:dates.every(date => [...date.children].every(child => child.scrollWidth <= child.clientWidth + 1))
        };
      });
      assert.equal(strip.frameContained && strip.datesContained && !strip.overflow, true, `${width}px ${theme} date strip escapes: ${JSON.stringify(strip)}`);
      assert.ok(strip.arrowTargets.every(size => size >= 44), `${width}px ${theme} date arrow target is below 44px: ${JSON.stringify(strip)}`);
      assert.ok(strip.markSizes.every(size => size >= 9 && size <= 12), `${width}px ${theme} chevron is not compact: ${JSON.stringify(strip)}`);
      assert.ok(strip.dateWidths.every(size => size >= 44), `${width}px ${theme} dates are too narrow: ${JSON.stringify(strip)}`);
      assert.equal(strip.copyClear && strip.labelsFit, true, `${width}px ${theme} date text collides or clips: ${JSON.stringify(strip)}`);
    }
    await page.evaluate(() => { document.body.dataset.providerTheme = 'cocoa-pearl'; });
    await page.locator('.date-strip-shift[data-date-shift="-7"]').click();
    await page.locator('.date-strip-shift[data-date-shift="7"]').click();
    assert.equal(await page.locator('.date-strip-frame').getAttribute('data-shift-count'), '0', `${width}px date arrows do not preserve back/forward navigation`);
    await page.evaluate(() => { document.querySelector('.date-strip-shift[data-date-shift="-7"]').disabled = true; });
    const disabledOpacity = await page.locator('.date-strip-shift[data-date-shift="-7"]').evaluate(element => parseFloat(getComputedStyle(element).opacity));
    assert.ok(disabledOpacity <= .35, `${width}px disabled date arrow is not visibly muted`);
    await page.evaluate(() => { document.querySelector('.date-strip-shift[data-date-shift="-7"]').disabled = false; });
    const cards = await page.evaluate(() => {
      const first = document.querySelector('.provider-booking-open');
      const imported = document.querySelector('.is-imported-history .provider-booking-open');
      const vipCard = document.querySelector('.client-vip .provider-booking-open');
      const title = imported.querySelector('h3');
      const titleStyle = getComputedStyle(title);
      const nameRow = vipCard.querySelector('.booking-client-name-row').getBoundingClientRect();
      const vip = vipCard.querySelector('.client-badges').getBoundingClientRect();
      const phone = imported.querySelector('.provider-booking-phone');
      const block = document.querySelector('.is-schedule-block .provider-booking-open');
      const overlaps = [];
      document.querySelectorAll('.provider-booking:not(.is-schedule-block) .provider-booking-open').forEach((card, cardIndex) => {
        const cardRect = card.getBoundingClientRect();
        const elements = [...card.querySelectorAll('.provider-booking-phone,.booking-status,.booking-client-visit,.booking-series-badge,.client-badges')]
          .filter(element => element.getBoundingClientRect().width > 0)
          .map(element => ({ className:element.className, rect:element.getBoundingClientRect() }));
        elements.forEach(({ className, rect }) => {
          if (rect.left < cardRect.left - .5 || rect.right > cardRect.right + .5 || rect.top < cardRect.top - .5 || rect.bottom > cardRect.bottom + .5) {
            overlaps.push(`card ${cardIndex} ${className} escapes`);
          }
        });
        for (let left = 0; left < elements.length; left += 1) {
          for (let right = left + 1; right < elements.length; right += 1) {
            const a = elements[left].rect;
            const b = elements[right].rect;
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5) {
              overlaps.push(`card ${cardIndex} ${elements[left].className} overlaps ${elements[right].className}`);
            }
          }
        }
      });
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        cardHeights:[...document.querySelectorAll('.provider-booking:not(.is-schedule-block) .provider-booking-open')].map(card => card.getBoundingClientRect().height),
        blockHeight:block.getBoundingClientRect().height,
        titleLines:title.getBoundingClientRect().height / parseFloat(titleStyle.lineHeight),
        fullAccessibleTitle:imported.getAttribute('aria-label').includes('Общий массаж задней поверхности'),
        vipRightGap:nameRow.right - vip.right,
        phoneVisible:phone.getBoundingClientRect().width > 0,
        phoneFits:phone.scrollWidth <= phone.clientWidth + 1,
        overlaps,
        statuses:[...document.querySelectorAll('.booking-status')].map(status => status.textContent.trim()),
        visitTexts:[...document.querySelectorAll('.booking-client-visit')].map(visit => visit.textContent.trim()),
        seriesText:document.querySelector('.booking-series-badge')?.textContent.trim(),
        breakText:block.textContent.replace(/\s+/g, ' ').trim()
      };
    });
    assert.equal(cards.overflow, false, `${width}px cards overflow horizontally: ${JSON.stringify(cards)}`);
    assert.ok(cards.cardHeights.every(height => height >= 72 && height <= 158), `${width}px record card height is outside the adaptive range: ${JSON.stringify(cards)}`);
    assert.ok(cards.blockHeight >= 64 && cards.blockHeight <= 82, `${width}px break card is not compact: ${JSON.stringify(cards)}`);
    assert.ok(cards.titleLines <= 3.05, `${width}px long title exceeds three visible lines: ${JSON.stringify(cards)}`);
    assert.equal(cards.fullAccessibleTitle, true, `${width}px compact title lost its accessible full text`);
    assert.ok(cards.vipRightGap <= 1, `${width}px VIP badge is not aligned right: ${JSON.stringify(cards)}`);
    assert.equal(cards.phoneVisible && cards.phoneFits, true, `${width}px phone is missing or clipped: ${JSON.stringify(cards)}`);
    assert.deepEqual(cards.overlaps, [], `${width}px record metadata intersects or escapes: ${JSON.stringify(cards)}`);
    assert.deepEqual(cards.statuses.slice(0, 3), ['Подтверждена', 'Подтверждена', 'Импортировано']);
    assert.deepEqual(cards.visitTexts, ['Новый · 1-й визит', 'Постоянный · 4-й визит']);
    assert.equal(cards.seriesText, 'Серия · визит 3 из 3');
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
  console.log('PrimeTime Pro record metadata and mobile navigation v786: PASS at 390/760');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
