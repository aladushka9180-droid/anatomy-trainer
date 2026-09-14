import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {themes,layouts} from './theme-card-fixture.mjs';

const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const css=[
  readFileSync(new URL('../styles.css',import.meta.url),'utf8'),
  readFileSync(new URL('../client-records.css',import.meta.url),'utf8'),
  readFileSync(new URL('../provider-clients-premium.css',import.meta.url),'utf8')
].join('\n');
function declaration(name){
  const start=source.search(new RegExp(`^function ${name}\\(`,'m'));
  assert.ok(start>=0,`Actual ${name}`);
  const end=source.indexOf('\n}',start)+2;
  assert.ok(end>start,`Complete ${name}`);
  return source.slice(start,end);
}

assert.match(source,/classList\.add\('booking-sheet-detail'\)/,'Real booking details opt into the isolated modifier');
assert.match(source,/bookingDetailHeaderMarkup\(item,[\s\S]*?bookingDetailClientMarkup\(item/,'Real detail sheet uses the compact header and client block');
assert.match(source,/editableAvatar:false/,'Imported history uses a static avatar');
assert.match(source,/bookingClientProfileActionMarkup\(item, \{ primary:true \}\)/,'Imported profile action is primary');
assert.match(source,/booking-repeat-actions[^\n]+bookingClientProfileActionMarkup\(item, \{ primary:true \}\)/,'Regular booking profile action is primary');
assert.match(source,/clientBadgeMarkup\(item\.client_phone, \{ limit:1, showLabels:true \}\)/,'Detail client block shows only the highest-priority badge');
assert.match(source,/classList\.remove\('booking-sheet-wide', 'new-booking-sheet', 'booking-sheet-detail'\)/,'Closing clears the detail modifier');
assert.match(source,/addEventListener\('keydown', trapBookingSheetFocus\)/,'Existing detail focus trap remains active');

const imported={
  id:'imported-1',is_imported_history:true,booking_date:'2026-09-04',booking_time:'10:30',
  duration_minutes:60,client_name:'Евгения Белышева',client_phone:'+7 912 768-07-83',
  services:{name:'Общий массаж задней поверхности. Проминающий (интенсивный) или Расслабляющий (нежный)'},
  source_provider_name:'Рамиль'
};
const normal={...imported,id:'normal-1',is_imported_history:false,series_id:'series-1',series_occurrence:2,
  booking_series:{occurrence_count:6},services:{name:'Массаж спины + ШВЗ — углублённый'}};

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
  const page=await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}</style></head>
    <body class="provider-body" data-provider-theme="graphite" data-provider-layout="capsule"
      style="--theme-surface:#fff;--theme-surface-alt:#f4f7f5;--theme-line:#d9e3dd;--theme-ink:#183326;--theme-muted:#718278;--theme-accent:#2f7654;--theme-accent-soft:#e8f3ec;--theme-shadow:rgba(17,48,33,.18);margin:0">
      <div class="booking-sheet booking-sheet-detail" id="bookingSheet">
        <button class="booking-sheet-backdrop" type="button" aria-label="Закрыть"></button>
        <section class="booking-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="bookingSheetTitle">
          <button class="booking-sheet-close" type="button" aria-label="Закрыть">×</button>
          <div id="bookingSheetContent"></div>
        </section>
      </div>
    </body></html>`);
  await page.addScriptTag({content:`
    var $=selector=>document.querySelector(selector),allBookings=[${JSON.stringify(normal)}];
    var escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    var serviceName=value=>String(value||'');
    var bookingStatus=item=>item.is_imported_history?'Импортировано':'Подтверждена';
    var normalizePhone=value=>String(value||'').replace(/\\D/g,'');
    var isScheduleBlock=()=>false;
    var uiIcon=name=>'<svg class="ui-icon" aria-hidden="true" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5"></circle></svg>';
    var clientAvatarContent=(phone,name)=>escapeHtml(String(name||'К').slice(0,1));
    var clientAvatarEditorMarkup=(phone,name)=>'<span class="booking-sheet-client-avatar">'+clientAvatarContent(phone,name)+'</span>';
    var clientBadgeMarkup=(phone,options)=>options.limit===1?'<span class="client-badges with-labels"><span class="client-badge badge-attention"><svg class="ui-icon"></svg><span>Внимание</span></span></span>':'';
    ${declaration('bookingClientProfileActionMarkup')}
    ${declaration('bookingDetailSeriesMarkup')}
    ${declaration('bookingDetailHeaderMarkup')}
    ${declaration('bookingDetailClientMarkup')}
    ${declaration('trapBookingSheetFocus')}
    document.querySelector('#bookingSheet').addEventListener('keydown',trapBookingSheetFocus);
    window.renderImported=()=>{
      const item=${JSON.stringify(imported)};
      document.querySelector('#bookingSheetContent').innerHTML=bookingDetailHeaderMarkup(item,new Date('2026-09-04T12:00:00'),60,'Импортировано из прежнего журнала','visited','3 000 ₽')+
        '<div class="booking-sheet-summary">'+bookingDetailClientMarkup(item,{editableAvatar:false})+'</div>'+
        '<details class="booking-client-overview booking-sheet-disclosure"><summary><strong>История клиента · 4 визита · 8 000 ₽</strong></summary><div class="booking-client-overview-body"><div class="booking-client-overview-stats"><article><small>Последний визит</small><strong>4 сент. 2026 г.</strong></article><article><small>Следующая запись</small><strong>Не запланирована</strong></article></div><div class="booking-client-overview-favorites"><small>Любимые услуги</small><span><b>Лимфодренажный массаж</b></span></div></div></details>'+
        '<div class="booking-sheet-actions booking-detail-primary-action">'+bookingClientProfileActionMarkup(item,{primary:true})+'</div>'+
        '<details class="booking-sheet-disclosure imported-history-readonly"><summary><strong>Импорт · Рамиль</strong></summary><div class="imported-history-readonly-body"><strong>Архивная запись доступна только для просмотра.</strong></div></details>';
    };
    window.renderNormal=()=>{
      const item=${JSON.stringify(normal)};
      document.querySelector('#bookingSheetContent').innerHTML=bookingDetailHeaderMarkup(item,new Date('2026-09-12T12:00:00'),90,'Подтверждена','confirmed','4 500 ₽',bookingDetailSeriesMarkup(item))+
        '<div class="booking-sheet-summary">'+bookingDetailClientMarkup(item)+'</div>'+
        '<details class="booking-client-overview booking-sheet-disclosure is-first-visit"><summary><strong>Первый визит</strong></summary><div class="booking-client-overview-body"><div class="booking-client-overview-stats"><article><small>История посещений</small><strong>Пока нет</strong></article></div></div></details>'+
        '<div class="booking-sheet-actions booking-repeat-actions">'+bookingClientProfileActionMarkup(item,{primary:true})+'<button class="secondary-button booking-repeat-action">Повторить запись</button></div>';
    };
    renderImported();
  `});

  assert.equal(await page.locator('.booking-detail-heading .booking-status').textContent(),'Импорт');
  assert.equal(await page.locator('.booking-detail-heading .booking-status').getAttribute('aria-label'),'Импортировано из прежнего журнала');
  assert.equal(await page.locator('.booking-sheet-client input').count(),0,'Imported avatar is static');
  assert.equal(await page.locator('.booking-sheet-client-name .client-badge').count(),1,'Only the highest-priority client badge is shown');
  assert.match(await page.locator('.booking-client-profile-action').textContent(),/Открыть карточку клиента/);
  assert.equal(await page.locator('.booking-client-overview').getAttribute('open'),null,'History is closed by default');
  assert.equal(await page.locator('.imported-history-readonly').getAttribute('open'),null,'Import source is closed by default');
  assert.doesNotMatch(await page.locator('#bookingSheetContent').textContent(),/Любимые услуги\s*Общий массаж задней поверхности/,'Current service is absent from favorites');

  await page.locator('.booking-client-overview>summary').focus();
  assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.booking-client-overview>summary')),true,'History summary receives focus');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.booking-client-overview').getAttribute('open'),'','Enter toggles history disclosure');
  await page.locator('.imported-history-readonly>summary').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('.imported-history-readonly').getAttribute('open'),'','Space toggles import disclosure');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.booking-sheet-close')),true,'Tab from the last control wraps to the first dialog control');
  await page.evaluate(()=>{document.querySelector('.booking-client-overview').open=false;document.querySelector('.imported-history-readonly').open=false;});

  const variants=themes.flatMap(theme=>layouts.map(layout=>({theme,layout})));
  for(const variant of variants){
    await page.locator('body').evaluate((body,value)=>{
      body.dataset.providerTheme=value.theme;body.dataset.providerLayout=value.layout;
    },variant);
    for(const width of [390,760,1440]){
      await page.setViewportSize({width,height:900});
      const metrics=await page.evaluate(()=>{
        const rect=selector=>document.querySelector(selector).getBoundingClientRect();
        const title=document.querySelector('#bookingSheetTitle');
        const facts=rect('.booking-detail-facts');
        const action=rect('.booking-client-profile-action');
        const icon=rect('.booking-client-profile-action .ui-icon');
        const label=rect('.booking-client-profile-action span');
        const panel=rect('.booking-sheet-panel');
        const line=parseFloat(getComputedStyle(title).lineHeight);
        return {
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          panel:{left:panel.left,right:panel.right,width:panel.width},
          titleLines:title.getBoundingClientRect().height/line,
          factsHeight:facts.height,
          action:{height:action.height,left:action.left,right:action.right},
          actionCenterDelta:Math.abs((icon.top+icon.height/2)-(label.top+label.height/2))
        };
      });
      assert.ok(metrics.overflow<=0,`${variant.theme}/${variant.layout}/${width}: no horizontal overflow`);
      assert.ok(metrics.panel.left>=0&&metrics.panel.right<=width+0.5,`${variant.theme}/${variant.layout}/${width}: panel stays inside viewport`);
      assert.ok(metrics.titleLines<=2.05,`${variant.theme}/${variant.layout}/${width}: service title is clamped to two lines`);
      assert.ok(metrics.factsHeight<=44.5,`${variant.theme}/${variant.layout}/${width}: time, duration and price stay in one facts row`);
      assert.ok(metrics.action.height>=44,`${variant.theme}/${variant.layout}/${width}: profile action keeps a 44px target`);
      assert.ok(metrics.action.left>=metrics.panel.left&&metrics.action.right<=metrics.panel.right,`${variant.theme}/${variant.layout}/${width}: action stays inside panel`);
      assert.ok(metrics.actionCenterDelta<=1,`${variant.theme}/${variant.layout}/${width}: icon and action label are centered together`);
      if(width===760)assert.ok(metrics.panel.width<=641&&metrics.panel.width>=620,`${variant.theme}/${variant.layout}: 760px content stays compact`);
      if(width===1440)assert.ok(metrics.panel.width<=621,`${variant.theme}/${variant.layout}: desktop detail stays compact`);
      if(process.env.MINUTA_UI_SCREENSHOT&&variant.theme==='graphite'&&variant.layout==='capsule')await page.screenshot({path:`${process.env.MINUTA_UI_SCREENSHOT}-${width}.png`});
    }
  }

  await page.evaluate(()=>{
    clientBadgeMarkup=(phone,options)=>options.limit===1?'<span class="client-badges with-labels"><span class="client-badge badge-vip"><svg class="ui-icon"></svg><span>VIP</span></span></span>':'';
    renderNormal();
  });
  assert.equal(await page.locator('.booking-detail-series').textContent(),'Серия · 2 из 6');
  assert.equal(await page.locator('.booking-sheet-client-name .badge-vip').count(),1,'VIP remains visible as the single priority badge');
  assert.equal(await page.locator('.booking-client-overview').getAttribute('open'),null,'First-visit disclosure is closed');
  assert.equal(await page.locator('.booking-client-overview>summary').textContent(),'Первый визит');
  assert.ok((await page.locator('.booking-client-profile-action').getAttribute('class')).includes('primary'),'Normal detail keeps the client profile as the primary action');

  console.log(`booking detail sheet minimal browser test: OK (${variants.length*3} theme/layout/viewport combinations)`);
}finally{await browser.close();}
