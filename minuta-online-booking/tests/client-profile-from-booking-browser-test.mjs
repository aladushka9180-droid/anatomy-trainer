import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const styles=readFileSync(new URL('../client-records.css',import.meta.url),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^function ${name}\\(`,'m'));assert.ok(start>=0,`Actual ${name}`);
  const end=source.indexOf('\n}',start)+2;assert.ok(end>start);return source.slice(start,end);
}
assert.match(source,/booking-repeat-actions[^\n]+bookingClientProfileActionMarkup\(item\)/,'Current booking exposes the full client profile action');
assert.match(source,/imported-history-readonly[\s\S]*?bookingClientProfileActionMarkup|bookingClientProfileActionMarkup\(item\)[\s\S]*?imported-history-readonly/,'Imported history exposes the same client profile action');
assert.match(source,/if \(openClientProfile\) openClientProfileFromBooking/,'Delegated click opens the shared profile');
assert.match(source,/bookingClientOverviewMarkup\(item\)[\s\S]*?id="bookingOutcomeForm"/,'Client context is added without removing visit result and payment controls');

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
  const page=await browser.newPage();
  await page.setContent('<div id="bookingSheet"></div><div id="clientOverview"></div><div id="clientsLayout"><button class="client-list-item" data-client-phone="79990000001"></button></div><button id="clientProfileBack"><span>Назад к клиентам</span></button>');
  await page.addScriptTag({content:`
    var clientProfileReturnContext=null,selectedClientPhone='79990000001';
    var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    var item={id:'booking-1',booking_date:'2026-09-12',booking_time:'10:00',client_phone:'+7 999 000-00-01',services:{name:'Массаж спины'}};
    var later={id:'booking-2',booking_date:'2026-09-20',booking_time:'12:00',client_phone:item.client_phone,status:'confirmed',services:{name:'Массаж спины'}};
    var completed={id:'past-1',booking_date:'2026-09-04',booking_time:'11:00',client_phone:item.client_phone,status:'confirmed',services:{name:'Массаж спины'},outcome:{visit_status:'completed',amount_rub:2000}};
    var effects=[];
    var normalizePhone=value=>String(value||'').replace(/\\D/g,'');
    var bookingSourceItems=()=>[item],isScheduleBlock=()=>false,buildClients=()=>[{phone:'79990000001',imported:{visit_count:4},bookings:[completed,later,item]}];
    var bookingOutcome=booking=>booking.outcome||{visit_status:'scheduled',amount_rub:0};
    var clientFavoriteServiceFacts=()=>[{name:'Массаж спины'}];
    var serviceName=value=>value,money=value=>new Intl.NumberFormat('ru-RU').format(value)+' ₽';
    var escapeHtml=value=>String(value);
    var notify=text=>effects.push(['notify',text]),closeBookingSheet=()=>effects.push(['close']);
    var setProviderView=view=>{effects.push(['view',view]);};
    var renderClientDetail=(phone,options)=>effects.push(['client',phone,options]);
    var selectScheduleDate=date=>effects.push(['date',date]);
    var openBookingSheet=id=>effects.push(['booking',id]);
    ${declaration('resetClientProfileReturnContext')}
    ${declaration('openClientProfileFromBooking')}
    ${declaration('returnFromClientProfile')}
    ${declaration('clientUpcoming')}
    ${declaration('clientCompletedVisits')}
    ${declaration('clientNextBookingAfter')}
    ${declaration('reportVisitWord')}
    ${declaration('bookingClientOverviewMarkup')}
  `});
  assert.equal(await page.evaluate(()=>clientUpcoming(buildClients()[0],new Date('2026-09-06T00:00:00')).id),'booking-1');
  assert.equal(await page.evaluate(()=>clientNextBookingAfter(buildClients()[0],item,new Date('2026-09-06T00:00:00')).id),'booking-2');
  await page.locator('#clientOverview').evaluate((host)=>{host.innerHTML=bookingClientOverviewMarkup(item,new Date('2026-09-06T00:00:00'));});
  const overview=page.locator('.booking-client-overview');
  assert.doesNotMatch(await overview.textContent(),/12 сент\. · 10:00/,'The open booking is not repeated as the next visit');
  assert.match(await overview.textContent(),/20 сент\. · 12:00/);
  assert.match(await overview.textContent(),/История клиента\s*4 визита · 2[\s ]?000 ₽/);
  assert.match(await overview.textContent(),/Последний визит: 4 сент\. 2026 г\./);
  assert.match(await overview.textContent(),/Любимые услуги\s*Массаж спины/);
  await page.evaluate(()=>{buildClients=()=>[{phone:'79990000001',bookings:[item]}];document.querySelector('#clientOverview').innerHTML=bookingClientOverviewMarkup(item,new Date('2026-09-06T00:00:00'));});
  assert.match(await overview.textContent(),/Первый визит\s*Истории посещений пока нет/);
  assert.match(await overview.textContent(),/Следующая запись\s*Не запланирована\s*После этой записи новых визитов нет/);
  assert.doesNotMatch(await overview.textContent(),/Визитов\s*0|Получено\s*0 ₽|Последний визит\s*Нет/);
  await page.addStyleTag({content:styles});
  await page.locator('body').evaluate(body=>{body.className='provider-body';body.dataset.providerTheme='graphite';});
  await page.locator('#clientOverview').evaluate(host=>host.insertAdjacentHTML('beforeend','<div class="booking-sheet-actions booking-repeat-actions"><button>Карточка клиента</button><button class="booking-repeat-action">Повторить запись</button></div>'));
  await page.setViewportSize({width:760,height:900});
  const desktopLayout=await page.evaluate(()=>{const articles=[...document.querySelectorAll('.booking-client-overview article')].map(node=>node.getBoundingClientRect());const buttons=[...document.querySelectorAll('.booking-repeat-actions button')].map(node=>node.getBoundingClientRect());return {articles:articles.map(({x,y,width,height})=>({x,y,width,height})),buttons:buttons.map(({x,y,width,height})=>({x,y,width,height}))};});
  assert.equal(Math.round(desktopLayout.articles[0].y),Math.round(desktopLayout.articles[1].y),'Client context remains a compact two-column row at 760px');
  assert.equal(Math.round(desktopLayout.buttons[0].y),Math.round(desktopLayout.buttons[1].y),'Context actions share one row at 760px');
  assert.ok(Math.abs(desktopLayout.buttons[0].width-desktopLayout.buttons[1].width)<2,'Context actions have equal width');
  assert.ok(Math.abs(desktopLayout.buttons[0].height-desktopLayout.buttons[1].height)<2,'Context actions have equal height');
  await page.setViewportSize({width:390,height:844});
  const mobileLayout=await page.evaluate(()=>{const articles=[...document.querySelectorAll('.booking-client-overview article')].map(node=>node.getBoundingClientRect());const buttons=[...document.querySelectorAll('.booking-repeat-actions button')].map(node=>node.getBoundingClientRect());return {articles:articles.map(({y,height})=>({y,height})),buttons:buttons.map(({y,width})=>({y,width}))};});
  assert.ok(mobileLayout.articles[1].y>=mobileLayout.articles[0].y+mobileLayout.articles[0].height,'Client context stacks without overlap at 390px');
  assert.ok(mobileLayout.buttons[1].y>mobileLayout.buttons[0].y,'Context actions stack at 390px');
  assert.ok(Math.abs(mobileLayout.buttons[0].width-mobileLayout.buttons[1].width)<2,'Stacked actions remain equal width');
  await page.evaluate(()=>openClientProfileFromBooking('booking-1','79990000001'));
  assert.deepEqual(await page.evaluate(()=>effects),[['close'],['view','clients'],['client','79990000001',{preserveReturn:true}]]);
  assert.equal(await page.locator('#clientsLayout').evaluate(el=>el.classList.contains('is-detail')),true);
  assert.equal(await page.locator('#clientProfileBack span').textContent(),'Назад к записи');
  assert.equal(await page.locator('#clientProfileBack').evaluate(el=>el.classList.contains('is-booking-return')),true);
  assert.deepEqual(await page.evaluate(()=>clientProfileReturnContext),{bookingId:'booking-1',bookingDate:'2026-09-12'});
  await page.evaluate(()=>returnFromClientProfile());
  assert.deepEqual(await page.evaluate(()=>effects.slice(-3)),[['view','bookings'],['date','2026-09-12'],['booking','booking-1']]);
  assert.equal(await page.locator('#clientsLayout').evaluate(el=>el.classList.contains('is-detail')),false);
  assert.equal(await page.locator('#clientProfileBack span').textContent(),'Назад к клиентам');
  assert.equal(await page.locator('#clientProfileBack').evaluate(el=>el.classList.contains('is-booking-return')),false);
  assert.equal(await page.evaluate(()=>clientProfileReturnContext),null);
  assert.deepEqual(await page.evaluate(()=>{effects=[];openClientProfileFromBooking('missing','');return effects;}),[['notify','Карточка клиента недоступна']]);
  console.log('Client profile from booking: shared detail and return context PASS (browser fixture)');
} finally {await browser.close();}
