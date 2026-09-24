import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const scheduleStyles = readFileSync(new URL('../provider-schedule-minimal.css', import.meta.url), 'utf8');
const desktopStyles = readFileSync(new URL('../provider-schedule-desktop-reference.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.goto('about:blank');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.margin = '0';
      document.body.style.setProperty('--theme-surface', '#ffffff');
      document.body.style.setProperty('--theme-surface-alt', '#ffe8f0');
      document.body.style.setProperty('--theme-line', '#e8d5de');
      document.body.style.setProperty('--theme-ink', '#302a30');
      document.body.style.setProperty('--theme-muted', '#706971');
      document.body.style.setProperty('--theme-accent', '#ca3b77');
      document.body.style.setProperty('--theme-accent-contrast', '#ffffff');
      const dashboard = document.createElement('main');
      dashboard.id = 'dashboard';
      dashboard.className = 'provider-app';
      dashboard.dataset.activeView = 'bookings';
      dashboard.style.maxWidth = '960px';
      dashboard.style.margin = '20px auto';
      dashboard.style.padding = '0 12px';
      dashboard.append(document.importNode(parsed.querySelector('.schedule-card'), true));
      document.body.append(dashboard);
      dashboard.querySelector('.booking-filters').hidden = true;
      dashboard.querySelector('#selectedDateTitle .selected-date-title-mobile').textContent = 'Четверг';
      dashboard.querySelector('#selectedDateSummary').textContent = '3 записи · 4 перерыва';
      dashboard.querySelector('#dateStrip').innerHTML = Array.from({ length:7 }, (_, i) =>
        `<button type="button" class="${i === 3 ? 'active' : ''}"><span>чт</span><strong>${i + 21}</strong><small>сент</small></button>`).join('');
      dashboard.querySelector('#providerBookings').innerHTML = '<div class="timeline-view"><div class="day-timeline"><div class="timeline-hours">10:00</div><div class="timeline-stage"></div></div></div>';
      window.toolbarClicks = [];
      dashboard.querySelectorAll('[data-journal-mode]').forEach(button =>
        button.addEventListener('click', () => window.toolbarClicks.push(button.dataset.journalMode)));
    }, html);
    await page.addStyleTag({ content:styles });
    await page.addStyleTag({ content:scheduleStyles });
    await page.addStyleTag({ content:desktopStyles });

    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const strip = document.querySelector('.date-strip-frame');
      const toolbar = document.querySelector('.schedule-toolbar');
      const title = document.querySelector('#selectedDateTitle');
      const buttons = [...document.querySelectorAll('.journal-mode-toggle button')];
      return {
        stripGap:Math.round(rect('.schedule-toolbar').top - rect('.date-strip-frame').bottom),
        toolbarHeight:Math.round(rect('.schedule-toolbar').height),
        titleTop:Math.round(title.getBoundingClientRect().top - toolbar.getBoundingClientRect().top),
        buttons:buttons.map(button => ({ width:Math.round(button.getBoundingClientRect().width), height:Math.round(button.getBoundingClientRect().height) })),
        outerFill:getComputedStyle(document.querySelector('.journal-mode-toggle'), '::before').height,
        activeFill:getComputedStyle(buttons[0], '::before').height,
        activeBackground:getComputedStyle(buttons[0]).backgroundColor,
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        firstHourTop:Math.round(rect('.timeline-hours').top)
      };
    });
    assert.equal(geometry.overflow, false, `${width}px horizontal overflow`);
    if (width <= 760) {
      assert.equal(geometry.stripGap, 2, `${width}px strip gap`);
      assert.equal(geometry.toolbarHeight, 48, `${width}px day header height`);
      assert.ok(geometry.titleTop >= 8, `${width}px day title too close to border: ${geometry.titleTop}px`);
      assert.deepEqual(geometry.buttons, [{ width:44, height:44 }, { width:44, height:44 }], `${width}px touch targets`);
      assert.equal(geometry.outerFill, '36px', `${width}px toggle background`);
      assert.equal(geometry.activeFill, '32px', `${width}px active fill`);
      assert.equal(geometry.activeBackground, 'rgba(0, 0, 0, 0)', `${width}px active button still fills the full touch area`);
      for (const mode of ['timeline', 'list']) await page.locator(`[data-journal-mode="${mode}"]`).click();
      assert.deepEqual(await page.evaluate(() => window.toolbarClicks), ['timeline', 'list'], `${width}px toggle clicks`);
    } else {
      assert.notEqual(geometry.toolbarHeight, 48, 'desktop day header changed');
      assert.equal(geometry.outerFill, 'auto', 'desktop received mobile toggle fill');
    }
    if (process.env.MINUTA_DAY_TOOLBAR_SCREENSHOT_DIR) {
      await page.screenshot({ path:`${process.env.MINUTA_DAY_TOOLBAR_SCREENSHOT_DIR}/day-toolbar-${width}.png` });
    }
    if (width <= 760) {
      const otherModes = await page.evaluate(() => {
        const day = document.querySelector('[data-calendar-view="day"]');
        const toggle = document.querySelector('.journal-mode-toggle');
        day.classList.remove('active');
        return ['week', 'month'].map(mode => {
          const button = document.querySelector(`[data-calendar-view="${mode}"]`);
          button.classList.add('active');
          const result = { mode, fill:getComputedStyle(toggle, '::before').height };
          button.classList.remove('active');
          return result;
        });
      });
      assert.deepEqual(otherModes, [{ mode:'week', fill:'auto' }, { mode:'month', fill:'auto' }], `${width}px non-day views changed`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('mobile day toolbar v909: PASS');
