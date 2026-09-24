import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const html=await readFile(path.join(root,'provider.html'),'utf8');
const links=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>/g)].map(match=>`<link rel="stylesheet" href="/${match[1]}">`).join('');
const catalogContext={window:{}};
vm.createContext(catalogContext);
vm.runInContext(await readFile(path.join(root,'theme-catalog.js'),'utf8'),catalogContext);
const themes=[...catalogContext.window.MinutaThemeCatalog.themeKeys];
const longService='Массаж спины + шейно-воротниковой зоны — углублённый восстанавливающий уход с дополнительными процедурами';
const preferenceSeam=`
window.__scheduleFontPreferenceTest={
  set(userId,font,textScale){
    currentUser={id:userId,user_metadata:{}};
    displayPreferences=normalizeDisplayPreferences({...displayPreferences,schedule_font_style:font,text_scale:textScale});
    displayPreferencesUpdatedAt=Math.max(Date.now(),displayPreferencesUpdatedAt+1);
    displayPreferencesPending=true;
    persistLocalDisplayPreferences(userId);
    applyDisplayPreferences();
    return this.snapshot();
  },
  theme(userId,theme){
    displayPreferences=normalizeDisplayPreferences({...displayPreferences,theme});
    displayPreferencesUpdatedAt=Math.max(Date.now(),displayPreferencesUpdatedAt+1);
    persistLocalDisplayPreferences(userId);
    applyDisplayPreferences();
    return this.snapshot();
  },
  restore(userId){
    currentUser={id:userId,user_metadata:{}};
    displayPreferences={...DEFAULT_DISPLAY_PREFERENCES};
    restoreDisplayPreferences(currentUser);
    applyDisplayPreferences();
    return this.snapshot();
  },
  snapshot(){return {font:displayPreferences.schedule_font_style,bodyFont:document.body.dataset.scheduleFontStyle,textScale:displayPreferences.text_scale,theme:displayPreferences.theme};}
};`;
const fixture=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${links}<style>*,*::before,*::after{transition:none!important;animation:none!important}.fixture{max-width:1060px;margin:auto;padding:16px}.day-timeline{min-height:350px}.timeline-stage{min-height:350px}</style><body class="provider-body" data-provider-theme="sage" data-provider-layout="soft" data-provider-text-scale="default" data-schedule-font-style="current"><main class="fixture" id="dashboard" data-active-view="bookings"><form id="providerDisplayForm"><fieldset class="provider-text-scale-picker"><legend>Размер текста</legend><label><input type="radio" name="providerTextScale" value="default" checked>Обычный</label><label><input type="radio" name="providerTextScale" value="comfortable">Комфортный</label></fieldset><fieldset class="schedule-font-style-picker"><legend>Шрифт карточек расписания</legend><div class="schedule-font-style-options"><label class="schedule-font-style-option"><input type="radio" name="scheduleFontStyle" value="current" checked><span><strong>Текущий</strong><small>10:00–11:00 · Имя<br>Название услуги</small></span></label><label class="schedule-font-style-option"><input type="radio" name="scheduleFontStyle" value="refined"><span><strong>Утончённый</strong><small>10:00–11:00 · Имя<br>Название услуги</small></span></label></div></fieldset></form><section class="schedule-card"><div id="providerBookings" class="provider-bookings timeline-view"><div class="day-timeline"><div class="timeline-hours"><span class="timeline-hour" style="top:0">10:00</span><span class="timeline-hour" style="top:90px">11:00</span></div><div class="timeline-stage"><button type="button" class="timeline-booking status-confirmed color-auto timeline-tight" data-open-booking="fixture" data-mobile-timeline-top="2" style="top:2px;height:82px" aria-label="${longService}"><span class="timeline-booking-time"><b>10:00</b><small>–11:00</small></span><span class="timeline-booking-copy"><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">10:00–11:00 · </span><span class="timeline-client-name">Анна Тестовая</span><span class="timeline-client-phone"> · +7 999 123-45-67</span></small></span><strong><span class="timeline-service-title">${longService}</span><span class="timeline-service-duration">60 минут</span></strong></span></button><button type="button" class="timeline-booking status-block automatic-break" data-open-automatic-break style="top:94px;height:110px"><span class="timeline-booking-time"><b>11:00</b><small>–12:00</small></span><span class="timeline-booking-copy"><strong>Автоперерыв<span class="timeline-automatic-break-source">Автоматический · из правил записи</span></strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:00</span></small></span></span></button></div></div></div></section></main><script>document.querySelectorAll('input[name="scheduleFontStyle"]').forEach(input=>input.addEventListener('change',()=>document.body.dataset.scheduleFontStyle=input.value));document.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>document.body.dataset.clicked='true'));</script></body></html>`;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=createServer(async(request,response)=>{
  try {
    const pathname=new URL(request.url,'http://127.0.0.1').pathname;
    if(pathname==='/fixture'){response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture);return;}
    const target=path.resolve(root,decodeURIComponent(pathname.slice(1)).split('?')[0]);
    if(!target.startsWith(`${root}${path.sep}`)||!(await stat(target)).isFile())throw new Error('missing');
    response.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
    const bytes=await readFile(target);
    response.end(pathname==='/provider.js'?Buffer.concat([bytes,Buffer.from(preferenceSeam)]):bytes);
  } catch {response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const playwright=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {chromium}=playwright.default||playwright;
const browser=await chromium.launch({headless:true});
try {
  for(const width of [390,760,820,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`,{waitUntil:'networkidle'});
    for(const theme of themes){
      await page.evaluate(theme=>document.body.dataset.providerTheme=theme,theme);
      const before=await page.evaluate(()=>{
        const record=getComputedStyle(document.querySelector('[data-open-booking]'));
        const br=getComputedStyle(document.querySelector('[data-open-automatic-break]'));
        return {recordBg:record.backgroundColor,breakBg:br.backgroundColor,recordColor:record.color,breakColor:br.color};
      });
      for(const style of ['current','refined']){
        await page.evaluate(style=>{document.body.dataset.scheduleFontStyle=style;document.querySelector(`input[name="scheduleFontStyle"][value="${style}"]`).checked=true;},style);
        const state=await page.evaluate(()=>{
          const q=s=>document.querySelector(s),c=s=>getComputedStyle(q(s)),rect=s=>q(s).getBoundingClientRect();
          const duration=q('.timeline-service-duration');
          return {
            top:rect('[data-open-booking] .timeline-booking-client-row').top,
            serviceTop:rect('[data-open-booking] .timeline-service-title').top,
            durationDisplay:getComputedStyle(duration).display,
            phoneDisplay:c('.timeline-client-phone').display,
            durationLeft:duration.getBoundingClientRect().left,
            serviceRight:rect('.timeline-service-title').right,
            serviceText:q('.timeline-service-title').textContent,
            recordFont:c('[data-open-booking] .timeline-service-title').fontFamily,
            breakFont:c('[data-open-automatic-break] strong').fontFamily,
            recordBg:c('[data-open-booking]').backgroundColor,
            breakBg:c('[data-open-automatic-break]').backgroundColor,
            recordColor:c('[data-open-booking]').color,
            breakColor:c('[data-open-automatic-break]').color,
            scrollWidth:document.documentElement.scrollWidth,innerWidth
          };
        });
        assert.equal(state.serviceText,longService,`${width}/${theme}/${style} full service DOM`);
        assert.ok(state.top<state.serviceTop,`${width}/${theme}/${style} hierarchy`);
        assert.equal(state.durationDisplay==='none',width<=760,`${width}/${theme}/${style} duration visibility`);
        assert.equal(state.phoneDisplay==='none',width<=760,`${width}/${theme}/${style} phone visibility`);
        if(width>760)assert.ok(state.durationLeft>=state.serviceRight-1,`${width}/${theme}/${style} duration beside service`);
        assert.equal(state.recordBg,before.recordBg,`${width}/${theme}/${style} booking fill changed`);
        assert.equal(state.breakBg,before.breakBg,`${width}/${theme}/${style} break fill changed`);
        assert.equal(state.recordColor,before.recordColor,`${width}/${theme}/${style} booking ink changed`);
        assert.equal(state.breakColor,before.breakColor,`${width}/${theme}/${style} break ink changed`);
        assert.ok(state.scrollWidth<=state.innerWidth+1,`${width}/${theme}/${style} horizontal overflow`);
        if(style==='refined'){
          assert.match(state.recordFont,/Manrope Schedule/);
          assert.match(state.breakFont,/Manrope Schedule/);
        }else{
          assert.doesNotMatch(state.recordFont,/Manrope Schedule/);
          assert.doesNotMatch(state.breakFont,/Manrope Schedule/);
        }
      }
    }
    await page.getByRole('radio',{name:'Утончённый'}).check();
    assert.equal(await page.locator('body').getAttribute('data-schedule-font-style'),'refined');
    await page.getByRole('button',{name:longService}).click();
    assert.equal(await page.locator('body').getAttribute('data-clicked'),'true');
    if(process.env.MINUTA_SCHEDULE_FONT_OUTPUT)await page.screenshot({path:path.join(process.env.MINUTA_SCHEDULE_FONT_OUTPUT,`schedule-font-${width}.png`),fullPage:true});
    console.log(`${width}px: ${themes.length} themes × 2 styles, hierarchy, duration, color, click and overflow PASS`);
    await page.close();
  }
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const settingsPage=await context.newPage();
  await settingsPage.goto(`http://127.0.0.1:${server.address().port}/provider.html`,{waitUntil:'domcontentloaded'});
  await settingsPage.waitForFunction(()=>Boolean(window.__scheduleFontPreferenceTest));
  const userId='schedule-font-fixture';
  let saved=await settingsPage.evaluate(userId=>window.__scheduleFontPreferenceTest.set(userId,'refined','comfortable'),userId);
  assert.equal(saved.bodyFont,'refined');
  assert.equal(saved.textScale,'comfortable');
  saved=await settingsPage.evaluate(userId=>window.__scheduleFontPreferenceTest.theme(userId,'warm'),userId);
  assert.equal(saved.font,'refined','theme switch replaced font');
  await settingsPage.reload({waitUntil:'domcontentloaded'});
  await settingsPage.waitForFunction(()=>Boolean(window.__scheduleFontPreferenceTest));
  saved=await settingsPage.evaluate(userId=>window.__scheduleFontPreferenceTest.restore(userId),userId);
  assert.equal(saved.bodyFont,'refined','reload lost font');
  assert.equal(saved.textScale,'comfortable','reload changed independent text size');
  saved=await settingsPage.evaluate(userId=>window.__scheduleFontPreferenceTest.set(userId,'current','comfortable'),userId);
  assert.equal(saved.bodyFont,'current','current option cannot be restored');
  assert.equal(saved.textScale,'comfortable','switching font changed text size');
  await context.close();
  console.log('Preference persistence: theme switch, reload and independent text size PASS');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
