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
      <button class="timeline-booking status-new client-vip" data-mobile-timeline-top="62" style="position:relative;width:280px;height:132px">
        <span class="timeline-booking-copy">
          <span class="client-badges with-labels"><span class="client-badge badge-vip"><span>VIP</span></span></span>
          <strong>Общий массаж с обеих сторон<span class="timeline-service-duration"> · 90 мин</span></strong>
          <span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:30 · </span><span class="timeline-client-name">Евгения Белышева</span><span class="timeline-client-phone">79508319339</span><span class="timeline-client-visit-wrap"> · <span class="timeline-client-visit is-regular">Постоянный клиент</span></span></small></span>
        </span>
        <span class="timeline-booking-status">Новая</span>
      </button>
    </body></html>`);

  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height:844 });
    const layout = await page.locator('.timeline-booking').evaluate(card => {
      const copy = card.querySelector('.timeline-booking-copy');
      const title = card.querySelector('strong');
      const badge = card.querySelector('.client-badges');
      const client = card.querySelector('.timeline-booking-client-row');
      const rect = element => element.getBoundingClientRect();
      return {
        cardWidth:rect(card).width,
        copyWidth:rect(copy).width,
        titleWidth:rect(title).width,
        badgeFloat:getComputedStyle(badge).float,
        badgeWidth:rect(badge).width,
        titlePaddingRight:getComputedStyle(title).paddingRight,
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
    assert.ok(Math.abs(layout.titleWidth - layout.copyWidth) < 1, `Title does not regain full width at ${width}px`);
    assert.equal(layout.clientClear, 'both', `Client row is not full-width below VIP at ${width}px`);
    assert.equal(layout.phoneDisplay, 'none', `Phone clutters the timeline at ${width}px`);
    assert.equal(layout.visitDisplay, 'none', `Visit label protrudes below the card at ${width}px`);
    assert.equal(layout.statusDisplay, 'none', `Status protrudes below the card at ${width}px`);
    assert.equal(layout.horizontalOverflow, false, `Card overflows horizontally at ${width}px`);
    if (process.env.MINUTA_VISUAL_DIR) {
      mkdirSync(process.env.MINUTA_VISUAL_DIR, { recursive:true });
      await page.screenshot({ path:join(process.env.MINUTA_VISUAL_DIR, `mobile-timeline-${width}.png`), fullPage:true });
    }
  }
} finally {
  await browser.close();
}

console.log('mobile timeline minimal browser test: ok');
