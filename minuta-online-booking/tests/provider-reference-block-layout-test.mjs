import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = readFileSync(path.join(root, 'provider.js'), 'utf8');
assert.match(source, /title\.textContent = 'Занять время';/);
const start = source.indexOf('function layoutNewBookingBlockFields()');
const end = source.indexOf('\nfunction ', start + 1);
assert.ok(start >= 0);
const layout = source.slice(start, end);
const html = readFileSync(path.join(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, channel:'chrome' });
try {
  for (const theme of ['sage', 'pink-porcelain']) for (const width of [390, 760, 1024, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:844 }, bypassCSP:true });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'provider.fixture.invalid') return route.abort();
      if (url.pathname === '/provider.html') return route.fulfill({ contentType:'text/html', body:html });
      const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!filename.startsWith(root + path.sep)) return route.abort();
      try { return route.fulfill({ body:readFileSync(filename), contentType:filename.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); }
      catch { return route.abort(); }
    });
    await page.goto('https://provider.fixture.invalid/provider.html');
    await page.addScriptTag({ content:`const $=s=>document.querySelector(s); let newBookingMode='block'; ${layout}
      document.documentElement.classList.remove('provider-booting','requires-top-level');
      document.body.dataset.providerTheme='${theme}';
      document.body.dataset.providerLayout='soft'; $('#dashboard').hidden=${width<761}; $('#dashboard').dataset.activeView='bookings';
      $('#providerBoot').hidden=true; $('#bookingSheet').hidden=false;
      $('#bookingSheet').classList.add('new-booking-sheet'); document.body.classList.add('booking-sheet-open');
      $('#bookingSheetContent').innerHTML='<h2>Занять время</h2><form class="new-booking-form" data-mode="block"><div class="new-booking-layout"><section class="new-booking-section"><div class="new-booking-section-title"><strong>Название</strong></div><details id="newBookingBlockFields" open><summary>Название</summary><label><input></label></details><label id="newBookingBlockDurationField">Длительность<select><option>60 мин</option></select></label><div id="newBookingDurationField"></div><details id="newBookingAdvanced"><summary>Дополнительно</summary></details></section><section class="new-booking-section new-booking-date-time-section"><div class="new-booking-section-title"><strong>Когда</strong></div><div id="newBookingDateTimeEditor" class="new-booking-date-time-editor"><label class="new-booking-date-field"><span class="sr-only">Дата</span><input type="date"></label><div role="group"><button>12:30</button></div></div></section></div><div class="booking-sheet-submit-bar"><button class="primary">Занять время</button></div></form>';
      layoutNewBookingBlockFields();` });
    const result = await page.evaluate(() => {
      const a = document.querySelector('#newBookingBlockDurationField').getBoundingClientRect();
      const b = document.querySelector('.new-booking-date-field').getBoundingClientRect();
      return { sameRow:Math.abs(a.y-b.y)<8 && b.x>a.x,
        caption:document.querySelector('.new-booking-date-field .sr-only').textContent,
        moved:document.querySelector('#newBookingAdvanced').parentElement.classList.contains('new-booking-date-time-section'),
        accent:getComputedStyle(document.querySelector('.booking-sheet-submit-bar .primary')).backgroundColor,
        token:getComputedStyle(document.body).getPropertyValue('--theme-accent').trim(),
        overflow:document.documentElement.scrollWidth>innerWidth };
    });
    assert.equal(result.sameRow, width<=760, JSON.stringify({theme,width,result}));
    assert.equal(result.caption, width<=760?'Когда':'Дата');
    assert.equal(result.moved, width<=760);
    const rgb = await page.evaluate(() => { const e=document.createElement('span'); e.style.color='var(--theme-accent)'; document.body.append(e); const color=getComputedStyle(e).color; e.remove(); return color; });
    assert.equal(result.accent, rgb, JSON.stringify({theme,width,result}));
    if (width >= 761) {
      const controls = await page.evaluate(() => {
        const group=document.querySelector('.date-navigation .calendar-view-toggle');
        const today=document.querySelector('.date-navigation .date-today-button');
        const picker=document.querySelector('.date-navigation .schedule-date-picker');
        const buttons=[...group.querySelectorAll('button')];
        return { gap:getComputedStyle(group).gap, radius:getComputedStyle(buttons[0]).borderRadius,
          active:getComputedStyle(buttons[0]).backgroundColor, todayWidth:today.getBoundingClientRect().width,
          groupHeight:group.getBoundingClientRect().height, todayHeight:today.getBoundingClientRect().height,
          groupRight:group.getBoundingClientRect().right,todayX:today.getBoundingClientRect().x,
          todayRight:today.getBoundingClientRect().right,pickerX:picker.getBoundingClientRect().x };
      });
      assert.equal(controls.gap, '0px', JSON.stringify({theme,width,controls}));
      assert.equal(controls.radius, '0px');
      assert.ok(controls.todayWidth >= 150);
      assert.ok(Math.abs(controls.groupHeight-controls.todayHeight)<2);
      assert.ok(controls.todayX >= controls.groupRight + 6, JSON.stringify({theme,width,controls}));
      assert.ok(controls.pickerX >= controls.todayRight + 4, JSON.stringify({theme,width,controls}));
    }
    if (process.env.MINUTA_REFERENCE_SCREENSHOTS) {
      mkdirSync(process.env.MINUTA_REFERENCE_SCREENSHOTS, { recursive:true });
      await page.screenshot({ path:path.join(process.env.MINUTA_REFERENCE_SCREENSHOTS, `block-${theme}-${width}.png`), fullPage:true });
    }
    await page.close();
  }
  console.log('Block editor and calendar controls: Sage/Pink 390/760/1024/1440 passed');
} finally { await browser.close(); }
