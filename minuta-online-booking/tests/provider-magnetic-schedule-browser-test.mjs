import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_MAGNETIC_SCHEDULE_OUTPUT || '';
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
    content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 }, reducedMotion:'no-preference' });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting','requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    document.body.dataset.providerTheme = 'sage';
    document.body.dataset.providerLayout = 'soft';
    document.querySelectorAll('.provider-view').forEach(view => {
      const active = view.dataset.providerPanel === 'bookings';
      view.hidden = !active;
      view.classList.toggle('active', active);
    });
    const holder = document.querySelector('#providerBookings');
    holder.className = 'provider-bookings timeline-view';
    holder.innerHTML = `<div class="day-timeline" style="--timeline-height:760px;--half-hour-offset:38px">
      <div class="timeline-hours"><span class="timeline-hour" style="top:0">09:00</span><span class="timeline-hour" style="top:76px">10:00</span><span class="timeline-hour" style="top:152px">11:00</span></div>
      <div class="timeline-stage is-magnetic-target" data-timeline-start="540" data-timeline-end="1140" style="height:760px">
        <i class="timeline-grid-line" style="top:0"></i><i class="timeline-grid-line" style="top:76px"></i>
        <span class="timeline-now-marker" style="top:114px"><time>10:30</time></span>
        <button class="timeline-booking status-confirmed color-sage is-current-booking is-dragging is-magnetized" data-open-booking="fixture" data-timeline-movable style="top:228px;height:72px" aria-describedby="timelineMoveInstruction" aria-keyshortcuts="Shift+ArrowUp Shift+ArrowDown">
          <span class="timeline-booking-time"><b>11:00</b><small>–12:00</small></span><span class="timeline-booking-copy"><strong>Массаж спины <span class="timeline-service-duration">· 60 мин</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client">Анна</small></span></span><span class="timeline-drag-handle" aria-hidden="true"></span>
        </button>
        <button class="timeline-booking status-new color-sage is-next-booking" style="top:304px;height:72px"><span class="timeline-booking-time"><b>13:00</b><small>–14:00</small></span><span class="timeline-booking-copy"><strong>Уход за лицом · 60 мин</strong></span></button>
        <span class="timeline-drag-preview is-magnetized" style="top:228px;height:72px" aria-hidden="true"></span>
        <span class="timeline-drag-label is-magnetized" style="top:176px"><strong>12:00–13:00</strong><small>Подходит · 60 мин · 2 500 ₽ остаётся в графике</small></span>
      </div>
    </div>`;
    const undo = document.querySelector('#timelineBookingUndo');
    undo.hidden = false;
    undo.classList.add('is-active');
    document.querySelector('#timelineBookingUndoMessage').textContent = 'Запись перенесена: 11:00 → 12:00';
    document.querySelector('#timelineBookingUndoCountdown').textContent = 'Отмена доступна ещё 10 сек.';
  });

  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width,height:1000 });
    await page.waitForTimeout(80);
    const result = await page.evaluate(() => {
      const card = document.querySelector('.timeline-booking[data-timeline-movable]');
      const handle = document.querySelector('.timeline-drag-handle');
      const label = document.querySelector('.timeline-drag-label');
      const preview = document.querySelector('.timeline-drag-preview');
      const undo = document.querySelector('#timelineBookingUndo');
      const rect = element => element.getBoundingClientRect();
      const handleStyle = getComputedStyle(handle);
      return {
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        cardVisible:rect(card).width > 0 && rect(card).height > 0,
        handleDisplay:handleStyle.display,
        handleWidth:rect(handle).width,
        handleHeight:rect(handle).height,
        labelInside:rect(label).left >= 0 && rect(label).right <= innerWidth,
        previewInside:rect(preview).left >= 0 && rect(preview).right <= innerWidth,
        undoInside:rect(undo).left >= 0 && rect(undo).right <= innerWidth && rect(undo).bottom <= innerHeight,
        undoButtonHeight:rect(document.querySelector('#timelineBookingUndoButton')).height,
        currentShadow:getComputedStyle(card).boxShadow,
        nextShadow:getComputedStyle(document.querySelector('.is-next-booking')).boxShadow,
        instruction:card.getAttribute('aria-describedby'),
        shortcuts:card.getAttribute('aria-keyshortcuts')
      };
    });
    assert.equal(result.overflow, false, `${width}px: horizontal overflow`);
    assert.equal(result.cardVisible, true, `${width}px: dragged card is not visible`);
    assert.equal(result.labelInside, true, `${width}px: magnetic label left viewport`);
    assert.equal(result.previewInside, true, `${width}px: slot preview left viewport`);
    assert.equal(result.undoInside, true, `${width}px: undo control left viewport`);
    assert.notEqual(result.currentShadow, 'none', `${width}px: current booking has no calm emphasis`);
    assert.notEqual(result.nextShadow, 'none', `${width}px: next booking has no emphasis`);
    assert.equal(result.instruction, 'timelineMoveInstruction');
    assert.match(result.shortcuts, /Shift\+ArrowUp/);
    if (width <= 760) {
      assert.notEqual(result.handleDisplay, 'none', `${width}px: touch handle is hidden`);
      assert.ok(result.handleWidth >= 44 && result.handleHeight >= 44, `${width}px: touch handle is smaller than 44px`);
      assert.ok(result.undoButtonHeight >= 44, `${width}px: undo button is smaller than 44px`);
    } else {
      assert.equal(result.handleDisplay, 'none', 'desktop drag handle must stay visually quiet');
    }
    if (output) await page.screenshot({ path:path.join(output, `magnetic-schedule-${width}.png`), fullPage:true });
  }

  await page.emulateMedia({ reducedMotion:'reduce' });
  const reduced = await page.evaluate(() => ({
    marker:getComputedStyle(document.querySelector('.timeline-now-marker')).animationName,
    current:getComputedStyle(document.querySelector('.is-current-booking'),'::after').animationName
  }));
  assert.equal(reduced.marker, 'none', 'current-time animation must honor reduced motion');
  assert.equal(reduced.current, 'none', 'current booking animation must honor reduced motion');
  console.log('PrimeTime Pro magnetic schedule browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
