import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Native editor DOM and sourced actual provider handlers. This is NOT full
// provider/auth/SQL E2E. RPC, color, note and refresh are deferred boundaries;
// final openBookingSheet/selectScheduleDate are navigation spies, not fake UI.
// The unsafe baseline is intentionally RED; no expected-failure inversion.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../ui-icons.svg', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing production function ${name}`);
  const lineEnd = source.indexOf('\n', start);
  if (source.slice(start, lineEnd).endsWith('}')) return source.slice(start, lineEnd);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `Missing production function end ${name}`);
  return source.slice(start, end + 2);
}
function listener(startText) {
  const start = source.indexOf(startText), end = source.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'Actual production listener missing');
  return source.slice(start, end + 4);
}
const names = ['openBookingEditor', 'saveBookingChanges', 'loadBookingEditSlots', 'closeBookingSheet',
  'sessionIsCurrent', 'requireWrites', 'providerAssistantIsoDate', 'isScheduleBlock', 'escapeHtml',
  'serviceName', 'money', 'uiIcon', 'serviceOptions', 'bookingDisplayNote', 'bookingClientNote',
  'normalizePhone', 'bookingColor', 'validBookingColor', 'bookingColorPicker', 'bookingOutcome',
  'actionableSeriesBookings', 'seriesBookingCountLabel', 'bookingSeriesScopeMarkup', 'seriesRpcErrorMessage',
  'showFormError', 'clearFormError'];
const colorConstants = source.match(/^const BOOKING_COLOR_KEYS = [\s\S]*?^const BOOKING_COLOR_DEFAULT = [^\n]+/m)?.[0];
assert.ok(colorConstants, 'Use actual color-control definitions');
const loader = [colorConstants, ...names.map(declaration),
  listener("document.addEventListener('click', async event => {"),
  listener("document.addEventListener('keydown', event => {\n  if (event.key !== 'Escape') return;")].join('\n');
const ids = { A:'11111111-1111-4111-8111-111111111111', B:'22222222-2222-4222-8222-222222222222',
  service:'33333333-3333-4333-8333-333333333333', seriesA:'44444444-4444-4444-8444-444444444444', seriesB:'55555555-5555-4555-8555-555555555555' };
const reply = { data:{ series_id:ids.seriesA, action:'reschedule', scope:'following', affected_count:1,
  affected:[{ booking_id:ids.A, occurrence:1 }] }, error:null };
const fixtureUrl = 'https://series-reschedule.test/';
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
let browser;
const failures = [];
async function fixture(holdAt = '') {
  const context = await browser.newContext({ serviceWorkers:'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], traffic = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(fixtureUrl).origin && url.pathname === '/ui-icons.svg') return route.fulfill({ contentType:'image/svg+xml', body:icons });
    if (route.request().url() !== fixtureUrl) { traffic.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><body></body></html>' });
  });
  await page.goto(fixtureUrl);
  await page.evaluate(({html,ids}) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['bookingSheet','portfolioEditorDialog']) {
      const el = parsed.getElementById(id);
      if (!el) throw new Error(`Missing provider #${id}`);
      document.body.append(document.importNode(el, true));
    }
    for (const name of ['A','B']) {
      const button = document.createElement('button');
      button.dataset.editBooking = ids[name]; button.textContent = `Открыть редактор ${name}`;
      document.body.append(button);
    }
  }, {html,ids});
  await page.addStyleTag({content:'[hidden]{display:none!important}label{display:block;margin:8px}svg{width:18px;height:18px}button,input,select,textarea{font:16px sans-serif}'});
  await page.addScriptTag({content:`
    var ids=${JSON.stringify(ids)}, responseFixture=${JSON.stringify(reply)}, holdAt=${JSON.stringify(holdAt)};
    var currentUser={id:'same-provider'}, sessionGeneration=7, activeClientOrganizationId='org-A';
    var bookingEditTime='', editingOfflineBookingId='', newBookingHistoricalMode=false;
    var bookingSeriesCancellationRevision=0, gestureClickSuppressedUntil=0, writesAllowed=true;
    var SCHEDULE_BLOCK_PHONE='0000000000', bookingColors=new Map(), bookingNotes=new Map(), bookingOutcomes=new Map();
    var clientNotes=new Map([['79990000001','Исходная заметка A'],['79990000002','Исходная заметка B']]);
    var ownServices=[{id:ids.service,name:'Услуга',duration_minutes:60,price_rub:1000,active:true}];
    var allBookings=['A','B'].map((name,index)=>({id:ids[name],series_id:ids['series'+name],series_occurrence:1,
      booking_series:{occurrence_count:1},service_id:ids.service,services:ownServices[0],duration_minutes:60,
      booking_date:'2099-09-05',booking_time:'10:00:00',status:'confirmed',client_phone:'+7999000000'+(index+1)}));
    var $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
    var businessTodayIso=()=> '2099-09-05', applyClientHighlightClasses=()=>{};
    var effects=[], gates=[], slotCalls=[], notices=[];
    var boundary=(kind,value)=>{effects.push({kind});return kind===holdAt
      ?new Promise((resolve,reject)=>gates.push({kind,resolve:()=>resolve(value),reject})):Promise.resolve(value);};
    var db={rpc:(name,args)=>{effects.push({kind:'rpc-args',name,args:structuredClone(args)});return boundary('rpc',responseFixture);},
      from:name=>{if(name!=='client_notes')throw new Error('Unexpected table '+name);return {upsert:args=>{
        effects.push({kind:'note-args',args:structuredClone(args)});return boundary('note',{error:null});}};}};
    var saveBookingColor=(id,color,options)=>{effects.push({kind:'color-args',id,color,options});return boundary('color',true);};
    var getProviderAvailableSlots=async args=>{slotCalls.push(structuredClone(args));return {data:[{booking_time:'10:00:00'},{booking_time:'11:00:00'},{booking_time:'15:00:00'}],error:null};};
    var refreshAfterWrite=()=>boundary('refresh',true);
    var notifyTelegramClient=(id,event)=>effects.push({kind:'telegram',id,event});
    var notify=text=>{notices.push(text);effects.push({kind:'notify',text});};
    var selectScheduleDate=date=>effects.push({kind:'select-date',date});
    var openBookingSheet=id=>effects.push({kind:'open-sheet',id});
    ${loader}
  `});
  return {page,context,errors,traffic};
}
async function open(page, name) {
  await page.locator(`[data-edit-booking="${ids[name]}"]`).click();
  await page.locator('[data-edit-booking-time="10:00"]').waitFor();
  assert.equal(await page.locator('#bookingEditForm').getAttribute('data-booking-id'), ids[name]);
  assert.equal(await page.locator('#editBookingService').inputValue(), ids.service);
}
async function edit(page, name) {
  await page.locator('#editBookingNote').fill(`Новая заметка ${name}`);
  await page.locator(`[name="editBookingColor"][value="${name==='A'?'mint':'rose'}"]`).check();
  await page.locator('[name="editBookingSeriesScope"][value="following"]').check();
  await page.locator('#editBookingDate').fill(name==='A'?'2099-09-06':'2099-09-07');
  await page.locator('#editBookingDate').dispatchEvent('change');
  const time = name==='A'?'11:00':'15:00';
  await page.locator(`[data-edit-booking-time="${time}"]`).click();
}
async function startA(page) {
  await open(page,'A'); await edit(page,'A');
  await page.locator('#bookingEditForm button[type="submit"]').click();
}
async function editorSnapshot(page) {
  return page.evaluate(() => ({visible:!$('#bookingSheet').hidden,same:window.newEditor===$('#bookingEditForm'),
    id:$('#bookingEditForm').dataset.bookingId,date:$('#editBookingDate').value,note:$('#editBookingNote').value,
    color:$('[name="editBookingColor"]:checked').value,scope:$('#bookingEditForm').elements.editBookingSeriesScope.value,
    time:bookingEditTime,errorHidden:$('#bookingEditError').hidden,
    disabled:$('#bookingEditForm button[type="submit"]').disabled,caption:$('#bookingEditForm button[type="submit"]').textContent,
    user:currentUser.id,generation:sessionGeneration}));
}
const cases = [
  ['current editor completes the intended RPC/color/note/refresh pipeline', '', async page => {
    await startA(page);
    await page.waitForFunction(() => effects.some(e=>e.kind==='open-sheet'));
    const output = await page.evaluate(() => ({effects,notes:[...clientNotes],notices}));
    assert.deepEqual(output.effects.map(e=>e.kind), ['rpc-args','rpc','telegram','color-args','color','note-args','note','select-date','refresh','notify','open-sheet']);
    assert.deepEqual(output.effects[0].args, {p_booking:ids.A,p_action:'reschedule',p_scope:'following',p_date:'2099-09-06',p_time:'11:00:00'});
    assert.equal(output.effects.find(e=>e.kind==='color-args').color,'mint');
    assert.deepEqual(output.effects.find(e=>e.kind==='note-args').args.client_phone,'79990000001');
    assert.deepEqual(output.effects.find(e=>e.kind==='note-args').args.note,'Новая заметка A');
    assert.equal(output.effects.at(-1).id,ids.A);
    assert.deepEqual(output.notices,['Запись обновлена']);
    assert.ok(output.notes.some(([phone,note])=>phone==='79990000001'&&note==='Новая заметка A'));
  }]
];
for (const boundary of ['rpc','color','note','refresh']) cases.push([
  `A pending ${boundary} → native close → B editor → late A must stop`, boundary, async page => {
    await startA(page);
    await page.waitForFunction(kind=>gates.some(g=>g.kind===kind), boundary);
    await page.keyboard.press('Escape');
    await open(page,'B'); await edit(page,'B');
    await page.evaluate(()=>{window.newEditor=$('#bookingEditForm');});
    const before = await page.evaluate(()=>({effects:structuredClone(effects),notes:[...clientNotes]}));
    const formBefore = await editorSnapshot(page);
    await page.evaluate(()=>gates.shift().resolve());
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.deepEqual(await editorSnapshot(page),formBefore,'Late A must not change any native B editor control');
    const after = await page.evaluate(()=>({effects,notes:[...clientNotes]}));
    assert.deepEqual(after,before,'A must not start further writes, mutate the notes cache, change schedule, toast, or navigate after B opens');
  }
]);
try {
  browser = await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,hold,run] of cases) {
    let f;
    try {
      f=await fixture(hold); await run(f.page);
      assert.deepEqual(f.errors,[],'No unhandled browser errors');
      assert.deepEqual(f.traffic,[],'No external/production network');
      console.log(`PASS ${name}`);
    } catch(error) {
      failures.push(name); console.error(`FAIL ${name}\n${error.stack}`);
      if(f?.errors.length)console.error('Page errors:',f.errors);
    } finally {await f?.context.close();}
  }
} finally {await browser?.close();}
console.log(`${cases.length-failures.length}/${cases.length} native editor cases passed; destination sheet renderer and full provider E2E not exercised`);
if(failures.length)process.exitCode=1;
