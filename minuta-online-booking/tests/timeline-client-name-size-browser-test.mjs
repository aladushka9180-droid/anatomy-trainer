import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const css = readFileSync(new URL('../provider-schedule-type.css', import.meta.url), 'utf8');
const sizeRule = 'font-size:calc(clamp(11px,1.05vw,15px) + 1px)!important;';
assert.ok(css.includes(sizeRule));
const markup = `<html><body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="default">
<div id="dashboard" data-active-view="bookings"><div id="providerBookings" class="timeline-view">
<button class="timeline-booking" data-open-booking="test" style="display:grid;width:min(88vw,846px);height:80px;padding:8px">
<span class="timeline-booking-time">17:00–18:00</span><span class="timeline-booking-copy">
<span class="timeline-booking-client-row"><small class="timeline-booking-client">
<span class="timeline-mobile-time">17:00–18:00 · </span><span class="timeline-client-name">Светлана</span><span class="timeline-client-phone"> · +7 (900) 000-00-00</span>
</small></span><strong><span class="timeline-service-title">Массаж спины</span></strong></span></button>
</div></div></body></html>`;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  for (const width of [320, 360, 390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent(markup);
    await page.addStyleTag({ content:css.replace(sizeRule, '') });
    const before = await page.evaluate(() => Object.fromEntries(['.timeline-client-name','.timeline-client-phone','.timeline-mobile-time','.timeline-service-title'].map(selector => [selector, getComputedStyle(document.querySelector(selector)).fontSize])));
    await page.addStyleTag({ content:css });
    const after = await page.evaluate(() => {
      const select = selector => document.querySelector(selector);
      const row = select('.timeline-booking-client');
      return { fonts:Object.fromEntries(['.timeline-client-name','.timeline-client-phone','.timeline-mobile-time','.timeline-service-title'].map(selector => [selector, getComputedStyle(select(selector)).fontSize])),
        rowScroll:row.scrollWidth, rowWidth:row.clientWidth, whiteSpace:getComputedStyle(row).whiteSpace,
        pageScroll:document.documentElement.scrollWidth, pageWidth:document.documentElement.clientWidth };
    });
    assert.equal(parseFloat(after.fonts['.timeline-client-name']) - parseFloat(before['.timeline-client-name']), 1, `${width}px: only name +1px`);
    for (const selector of ['.timeline-client-phone','.timeline-mobile-time','.timeline-service-title'])
      assert.equal(after.fonts[selector], before[selector], `${width}px: ${selector} unchanged`);
    assert.equal(after.whiteSpace, 'nowrap');
    assert.ok(after.pageScroll <= after.pageWidth, `${width}px: no page overflow`);
    await page.close();
  }
  console.log('client name +1px responsive type check passed');
} finally { await browser.close(); }
