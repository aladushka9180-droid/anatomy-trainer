import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'styles.css'), 'utf8');
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Playwright Chromium is unavailable');

const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
    <body class="provider-body" data-provider-theme="warm" data-provider-layout="bento">
      <button class="timeline-booking status-new client-vip" data-open-booking="fixture" data-mobile-timeline-top="62" style="position:relative;width:280px;height:132px">
        <span class="timeline-booking-copy">
          <span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span>
          <strong>Общий массаж с обеих сторон<span class="timeline-service-duration"> · 90 мин</span></strong>
          <span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:30 · </span><span class="timeline-client-name">Евгения Белышева</span><span class="timeline-client-phone">79508319339</span><span class="timeline-client-visit-wrap"> · <span class="timeline-client-visit is-regular">Постоянный клиент</span></span></small></span>
        </span>
        <span class="timeline-booking-status">Новая</span>
        <span class="timeline-drag-handle" aria-hidden="true"></span>
      </button>
      <button class="timeline-booking status-confirmed timeline-tight title-wrap-regression" data-open-booking="title-wrap" data-mobile-timeline-top="62" style="position:relative;width:calc(100vw - 88px);height:66px;margin-top:16px">
        <span class="timeline-booking-copy">
          <strong><span class="timeline-service-core">Массаж спины + ШВЗ</span><span class="timeline-service-variant"> —&nbsp;углублённый</span> <span class="timeline-service-duration">· 60 мин</span></strong>
          <span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">15:00–16:00 · </span><span class="timeline-client-name">Якимов Кирилл</span></small></span>
        </span>
        <span class="timeline-drag-handle" aria-hidden="true"></span>
      </button>
      <div class="timeline-booking status-block" data-mobile-timeline-top="128" style="position:relative;width:calc(100vw - 88px);height:66px;margin-top:16px">
        <span class="timeline-booking-copy"><strong>Ⅱ Перерыв</strong></span>
      </div>
    </body></html>`);

  for (const width of [360, 390, 420, 760]) {
    await page.setViewportSize({ width, height:844 });
    const layout = await page.locator('.timeline-booking').first().evaluate(card => {
      const copy = card.querySelector('.timeline-booking-copy');
      const title = card.querySelector('strong');
      const badge = card.querySelector('.client-badges');
      const client = card.querySelector('.timeline-booking-client-row');
      const handle = card.querySelector('.timeline-drag-handle');
      const rect = element => element.getBoundingClientRect();
      return {
        cardWidth:rect(card).width,
        copyWidth:rect(copy).width,
        titleWidth:rect(title).width,
        badgeFloat:getComputedStyle(badge).float,
        badgeWidth:rect(badge).width,
        titlePaddingRight:getComputedStyle(title).paddingRight,
        copyPaddingRight:Number.parseFloat(getComputedStyle(copy).paddingRight),
        handleDisplay:getComputedStyle(handle).display,
        handleTouchAction:getComputedStyle(handle).touchAction,
        handleRect:rect(handle).toJSON(),
        cardRect:rect(card).toJSON(),
        clientClear:getComputedStyle(client).clear,
        phoneDisplay:getComputedStyle(card.querySelector('.timeline-client-phone')).display,
        visitDisplay:getComputedStyle(card.querySelector('.timeline-client-visit-wrap')).display,
        statusDisplay:getComputedStyle(card.querySelector('.timeline-booking-status')).display,
        horizontalOverflow:card.scrollWidth > card.clientWidth
      };
    });
    assert.equal(layout.badgeFloat, 'right', `VIP is not floated at ${width}px`);
    assert.ok(layout.badgeWidth <= 72, `VIP is wider than 72px at ${width}px`);
    assert.equal(layout.titlePaddingRight, '0px', `Title keeps a dead right column at ${width}px`);
    assert.ok(Math.abs(layout.titleWidth - (layout.copyWidth - layout.copyPaddingRight)) < 1, `Title does not use the space left by the handle at ${width}px`);
    assert.equal(layout.copyPaddingRight, 20, `Copy does not reserve a safe gap before the mobile drag handle at ${width}px`);
    assert.equal(layout.handleDisplay, 'flex', `Drag handle is not visible at ${width}px`);
    assert.equal(layout.handleTouchAction, 'none', `Drag handle cannot keep a touch gesture at ${width}px`);
    assert.ok(layout.handleRect.right <= layout.cardRect.right + .5 && layout.handleRect.left >= layout.cardRect.left, `Drag handle escapes the card at ${width}px`);
    assert.equal(layout.clientClear, 'both', `Client row is not full-width below VIP at ${width}px`);
    assert.equal(layout.phoneDisplay, 'none', `Phone clutters the timeline at ${width}px`);
    assert.equal(layout.visitDisplay, 'none', `Visit label protrudes below the card at ${width}px`);
    assert.equal(layout.statusDisplay, 'none', `Status protrudes below the card at ${width}px`);
    assert.equal(layout.horizontalOverflow, false, `Card overflows horizontally at ${width}px`);
    const titleWrap = await page.locator('.title-wrap-regression').evaluate(card => {
      const core = card.querySelector('.timeline-service-core');
      const variant = card.querySelector('.timeline-service-variant');
      const duration = card.querySelector('.timeline-service-duration');
      const title = card.querySelector('strong');
      return {
        fontSize:Number.parseFloat(getComputedStyle(title).fontSize),
        coreTop:core.getBoundingClientRect().top,
        coreWidth:core.getBoundingClientRect().width,
        variantTop:variant.getBoundingClientRect().top,
        variantWidth:variant.getBoundingClientRect().width,
        durationTop:duration.getBoundingClientRect().top,
        durationWidth:duration.getBoundingClientRect().width,
        titleWidth:title.getBoundingClientRect().width,
        clientRight:card.querySelector('.timeline-booking-client').getBoundingClientRect().right,
        handleLeft:card.querySelector('.timeline-drag-handle').getBoundingClientRect().left,
        clientText:card.querySelector('.timeline-booking-client').innerText,
        clientOverflow:card.querySelector('.timeline-booking-client').scrollWidth > card.querySelector('.timeline-booking-client').clientWidth,
        overflow:card.scrollWidth > card.clientWidth,
      };
    });
    const expectedTitleFontSize = width <= 420 ? Math.min(11, Math.max(10.5, width * .027)) : 12;
    assert.ok(Math.abs(titleWrap.fontSize - expectedTitleFontSize) < .03, `Only narrow phones should adaptively reduce the service title at ${width}px`);
    assert.ok(Math.abs(titleWrap.variantTop - titleWrap.coreTop) <= 1, `Service variant wraps away from the dash at ${width}px`);
    assert.ok(Math.abs(titleWrap.durationTop - titleWrap.variantTop) <= 6, `Duration wraps despite enough room beside the service title at ${width}px`);
    assert.equal(titleWrap.clientText, '15:00–16:00 · Якимов Кирилл', `Client row text changed at ${width}px`);
    assert.equal(titleWrap.clientOverflow, false, `Client row truncates despite the free space before the handle at ${width}px`);
    assert.ok(titleWrap.clientRight <= titleWrap.handleLeft + .5, `Client row reaches under the drag handle at ${width}px`);
    assert.equal(titleWrap.overflow, false, `Balanced title overflows at ${width}px`);
    assert.equal(await page.locator('.timeline-booking.status-block strong').evaluate(title => Number.parseFloat(getComputedStyle(title).fontSize)), 12, `Break title size changed at ${width}px`);
    if (process.env.MINUTA_VISUAL_DIR) {
      mkdirSync(process.env.MINUTA_VISUAL_DIR, { recursive:true });
      for (const theme of ['warm', 'midnight']) {
        await page.locator('body').evaluate((body, value) => { body.dataset.providerTheme = value; }, theme);
        await page.screenshot({ path:join(process.env.MINUTA_VISUAL_DIR, `mobile-timeline-${theme}-${width}.png`), fullPage:true });
      }
      await page.locator('body').evaluate(body => { body.dataset.providerTheme = 'warm'; });
    }
  }
  await page.setViewportSize({ width:1440, height:900 });
  assert.equal(await page.locator('.timeline-drag-handle').first().evaluate(handle => getComputedStyle(handle).display), 'none', 'Mobile drag handle must stay hidden on desktop');
  if (process.env.MINUTA_VISUAL_DIR) {
    for (const theme of ['warm', 'midnight']) {
      await page.locator('body').evaluate((body, value) => { body.dataset.providerTheme = value; }, theme);
      await page.screenshot({ path:join(process.env.MINUTA_VISUAL_DIR, `mobile-timeline-${theme}-1440.png`), fullPage:true });
    }
  }
} finally {
  await browser.close();
}

console.log('mobile timeline minimal browser test: ok');
