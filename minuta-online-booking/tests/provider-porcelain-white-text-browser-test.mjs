import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{ width,height:900 } });
    await page.setContent(`<body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft">
      <main id="dashboard" data-active-view="bookings"><section class="schedule-card" style="width:min(100%,640px);margin:auto">
        <div class="date-navigation"><button class="date-today-button" type="button"><span>Сегодня</span></button></div>
        <div id="dateStrip" class="date-strip"><button type="button">23</button><button class="active" type="button"><span>Сегодня</span><strong>24</strong><small>сент</small></button></div>
        <div id="providerBookings" class="provider-bookings timeline-view"><div class="day-timeline" style="--timeline-height:300px"><div class="timeline-hours">10:00</div><div class="timeline-stage">
          <button type="button" class="timeline-booking status-confirmed color-auto" style="top:0;height:75px"><span class="timeline-booking-time"><b>10:00</b><small>–11:00</small></span><span class="timeline-booking-copy"><strong><span class="timeline-service-title">Услуга</span></strong><span class="timeline-booking-client">Клиент</span></span></button>
          <button type="button" class="timeline-booking status-block automatic-break" style="top:85px;height:95px"><span class="timeline-booking-time"><b>11:00</b><small>–12:00</small></span><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong></span></button>
        </div></div></div>
      </section></main><script>document.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>document.body.dataset.clicked='true'));</script></body>`);
    for (const file of ['styles.css','provider-themes-signature.css','provider-theme-families.css','provider-porcelain-detail.css','provider-schedule-minimal.css','provider-schedule-desktop-reference.css']) {
      await page.addStyleTag({ path:path.join(root,file) });
    }
    await page.addStyleTag({ content:'*{transition:none!important;animation:none!important}' });
    await page.addScriptTag({ path:path.join(root,'provider-porcelain-matrix.js') });
    for (const character of ['pearl','petal','silk']) {
      for (const shade of ['pearl-white','porcelain-white','gentle-pink','petal-pink','pink-accent']) {
        await page.evaluate(({character,shade})=>{
          const palette=window.MinutaProviderPorcelainMatrix.paletteFor(character,shade);
          document.body.dataset.providerPorcelainCharacter=character;
          for(const [name,value] of Object.entries({
            '--theme-bg':palette.bg,'--theme-surface':palette.surface,'--theme-surface-alt':palette.surfaceAlt,'--theme-ink':palette.ink,'--theme-muted':palette.muted,
            '--theme-line':palette.line,'--theme-accent':palette.accent,'--theme-accent-soft':palette.accentSoft,'--porcelain-action-bg':palette.actionBg,'--porcelain-action-ink':palette.actionInk
          }))document.body.style.setProperty(name,value);
        },{character,shade});
        const state=await page.evaluate(()=>{
          const css=s=>getComputedStyle(document.querySelector(s));
          return {
            todayBackground:css('.date-today-button').backgroundColor,
            bookingBackground:css('.timeline-booking.status-confirmed').backgroundColor,
            breakBackground:css('.timeline-booking.automatic-break').backgroundColor,
            todayColor:css('.date-today-button span').color,
            dayColor:css('#dateStrip button.active strong').color,
            bookingTitleColor:css('.timeline-booking.status-confirmed .timeline-service-title').color,
            bookingTimeColor:css('.timeline-booking.status-confirmed .timeline-booking-time').color,
            bookingClientColor:css('.timeline-booking.status-confirmed .timeline-booking-client').color,
            breakTitleColor:css('.timeline-booking.automatic-break strong').color,
            breakSourceColor:css('.timeline-automatic-break-source').color,
            breakTimeColor:css('.timeline-booking.automatic-break .timeline-booking-time').color,
            bookingTextShadow:css('.timeline-booking.status-confirmed .timeline-service-title').textShadow,
            breakTextShadow:css('.timeline-booking.automatic-break strong').textShadow,
            unselectedDateColor:css('#dateStrip button:not(.active)').color,
            timeAxisColor:css('.timeline-hours').color,
            scrollWidth:document.documentElement.scrollWidth,innerWidth
          };
        });
        assert.equal(state.bookingBackground,state.todayBackground,`${width} ${character}/${shade} booking fill`);
        for(const key of ['todayColor','dayColor','bookingTitleColor','bookingTimeColor','bookingClientColor','breakTitleColor','breakSourceColor','breakTimeColor'])
          assert.equal(state[key],'rgb(255, 255, 255)',`${width} ${character}/${shade} ${key}`);
        assert.equal(state.bookingTextShadow,'none');
        assert.equal(state.breakTextShadow,'none');
        assert.notEqual(state.unselectedDateColor,'rgb(255, 255, 255)');
        assert.notEqual(state.timeAxisColor,'rgb(255, 255, 255)');
        assert.ok(state.scrollWidth<=state.innerWidth+1,`${width} ${character}/${shade} overflow`);
      }
    }
    await page.evaluate(()=>{
      const palette=window.MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');
      document.body.dataset.providerPorcelainCharacter='petal';
      for(const [name,value] of Object.entries({
        '--theme-bg':palette.bg,'--theme-surface':palette.surface,'--theme-surface-alt':palette.surfaceAlt,'--theme-ink':palette.ink,'--theme-muted':palette.muted,
        '--theme-line':palette.line,'--theme-accent':palette.accent,'--theme-accent-soft':palette.accentSoft,'--porcelain-action-bg':palette.actionBg,'--porcelain-action-ink':palette.actionInk
      }))document.body.style.setProperty(name,value);
    });
    if(process.env.MINUTA_PORCELAIN_OUTPUT)await page.screenshot({ path:path.join(process.env.MINUTA_PORCELAIN_OUTPUT,`porcelain-white-text-candidate-${width}.png`),fullPage:true });
    await page.locator('.date-today-button').click();
    assert.equal(await page.locator('body').getAttribute('data-clicked'),'true');
    await page.evaluate(()=>document.body.dataset.providerTheme='sage');
    assert.notEqual(await page.locator('.timeline-booking.status-confirmed .timeline-service-title').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)',`${width} other theme`);
    console.log(`${width}px: 15 palettes, white target text, unchanged adjacent theme, no overflow, click OK`);
    await page.close();
  }
} finally { await browser.close(); }
