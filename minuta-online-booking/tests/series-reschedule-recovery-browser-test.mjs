import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Native editor DOM and sourced actual provider handlers. This is NOT full
// provider/auth/SQL E2E. Real color/note helpers and localStorage execute;
// their RPC transport, client-note transport and refresh are deferred boundaries.
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
  'showFormError', 'clearFormError', 'persistBookingColors', 'persistBookingNotes', 'captureBookingMetadataContext', 'beginBookingColorOperation',
  'bookingColorStorageKey', 'bookingColorPendingStorageKey', 'bookingNoteStorageKey', 'bookingNotePendingStorageKey'];
const colorConstants = source.match(/^const BOOKING_COLOR_KEYS = [\s\S]*?^const BOOKING_COLOR_DEFAULT = [^\n]+/m)?.[0];
assert.ok(colorConstants, 'Use actual color-control definitions');
const lifecycle = ['bookingSeriesCancellationRevision','bookingEditorRevision','bookingMetadataRevision'].map(name => {
  const declaration = source.match(new RegExp(`^let ${name} = .*;$`, 'm'))?.[0];
  assert.ok(declaration, `Actual lifecycle declaration: ${name}`);
  return declaration;
}).join('\n');
const resetHooks = [...source.matchAll(/^window\.addEventListener\('minuta:provider-session-reset', \(\) => (?:\{[\s\S]*?^\}\);|[^\n]*\);)/gm)]
  .map(match=>match[0]).join('\n');
const orgStart = source.indexOf('  onActiveOrganizationChange: organization => {');
const orgEnd = source.indexOf('    if (clientOrganizationChanged) {',orgStart);
assert.ok(orgStart>=0&&orgEnd>orgStart,'Actual organization identity/epoch prefix');
// Only the actual identity/epoch prefix, not sibling organization controllers.
const orgHook = source.slice(orgStart,orgEnd).replace('  onActiveOrganizationChange: organization => {','function changeOrganization(organization) {')+'\n}';
const colorOperationRegistry = source.match(/^const bookingColorOperations = .*;$/m)?.[0];
assert.ok(colorOperationRegistry, 'Actual per-map operation registry declaration');
const loader = [lifecycle, resetHooks, orgHook, colorConstants, colorOperationRegistry, ...names.map(declaration),
  declaration('saveBookingColor').replace('function saveBookingColor(', 'function actualSaveBookingColor('),
  declaration('saveBookingNote').replace('function saveBookingNote(', 'function actualSaveBookingNote('),
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
    var gestureClickSuppressedUntil=0, writesAllowed=true;
    var freeSlotsController={invalidateScope(){}}, providerReadFetch={cancelPendingReads(){}};
    var SCHEDULE_BLOCK_PHONE='0000000000', bookingColors=new Map(), bookingNotes=new Map(), bookingOutcomes=new Map();
    var pendingBookingColors=new Set(), pendingBookingNotes=new Set();
    var clientNotes=new Map([['79990000001','Исходная заметка A'],['79990000002','Исходная заметка B']]);
    var ownServices=[{id:ids.service,name:'Услуга',duration_minutes:60,price_rub:1000,active:true}];
    var allBookings=['A','B'].map((name,index)=>({id:ids[name],series_id:ids['series'+name],series_occurrence:1,
      booking_series:{occurrence_count:1},service_id:ids.service,services:ownServices[0],duration_minutes:60,
      booking_date:'2099-09-05',booking_time:'10:00:00',status:'confirmed',client_phone:'+7999000000'+(index+1)}));
    var $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
    var businessTodayIso=()=> '2099-09-05', applyClientHighlightClasses=()=>{};
    var effects=[], gates=[], slotCalls=[], notices=[];
    var boundary=(kind,value)=>{effects.push({kind});return kind===holdAt
      ?new Promise((resolve,reject)=>gates.push({kind,resolve:override=>resolve(override===undefined?value:override),reject})):Promise.resolve(value);};
    var db={rpc:(name,args)=>{
      if(name==='set_booking_color')return boundary('color',{data:null,error:null});
      if(name==='set_booking_note')return boundary('booking-note',{data:null,error:null});
      if(name!=='manage_minuta_booking_series')throw new Error('Unexpected RPC '+name);
      effects.push({kind:'rpc-args',name,args:structuredClone(args)});return boundary('rpc',responseFixture);},
      from:name=>{if(name!=='client_notes')throw new Error('Unexpected table '+name);return {upsert:args=>{
        effects.push({kind:'note-args',args:structuredClone(args)});return boundary('note',{error:null});}};}};
    var saveBookingColor=(id,color,options)=>{effects.push({kind:'color-args',id,color,options:{rerender:options.rerender}});return actualSaveBookingColor(id,color,options);};
    var renderBookingData=()=>effects.push({kind:'render-bookings'});
    var getProviderAvailableSlots=async args=>{slotCalls.push(structuredClone(args));
      const value={data:[{booking_time:'10:00:00'},{booking_time:'11:00:00'},{booking_time:'15:00:00'}],error:null};
      return holdAt==='slots'?new Promise((resolve,reject)=>gates.push({kind:'slots',resolve:override=>resolve(override===undefined?value:override),reject})):value;};
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
async function effectsSnapshot(page) {
  return page.evaluate(()=>({effects:structuredClone(effects),notes:[...clientNotes],
    colors:[...bookingColors],bookingNotes:[...bookingNotes],pendingColors:[...pendingBookingColors],pendingNotes:[...pendingBookingNotes],
    storage:Object.entries(localStorage).sort(),items:structuredClone(allBookings)}));
}
async function release(page, value) {
  await page.evaluate(value=>gates.shift().resolve(value),value);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
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
    const before = await effectsSnapshot(page);
    const formBefore = await editorSnapshot(page);
    await release(page);
    assert.deepEqual(await editorSnapshot(page),formBefore,'Late A must not change any native B editor control');
    const after = await effectsSnapshot(page);
    assert.deepEqual(after,before,'A must not start further writes, mutate the notes cache, change schedule, toast, or navigate after B opens');
  }
]);
for (const phase of ['rpc','color','note','refresh']) for (const transition of ['org-roundtrip','session-reset','account-replacement']) cases.push([
  `${phase} completion after ${transition} cannot touch current editor/maps/storage`,phase,async page=>{
    await startA(page);
    await page.waitForFunction(kind=>gates.some(g=>g.kind===kind),phase);
    await page.evaluate(transition=>{
      if(transition==='org-roundtrip'){changeOrganization({id:'org-B'});changeOrganization({id:'org-A'});}
      if(transition==='session-reset')window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
      if(transition==='account-replacement'){
        currentUser={id:'different-provider'};sessionGeneration++;
        bookingColors=new Map([[ids.A,'rose']]);pendingBookingColors=new Set([ids.A]);
        bookingNotes=new Map([[ids.A,'Другой аккаунт']]);pendingBookingNotes=new Set([ids.A]);
        clientNotes=new Map([['79990000001','Чужая заметка']]);
        allBookings=structuredClone(allBookings);allBookings[0].provider_note='Другой аккаунт';
        persistBookingColors();persistBookingNotes();
      }
      window.newEditor=$('#bookingEditForm');
    },transition);
    const before=await effectsSnapshot(page), form=await editorSnapshot(page);
    await release(page);
    assert.deepEqual(await effectsSnapshot(page),before,'Stale context must have zero subsequent effects including native localStorage');
    assert.deepEqual(await editorSnapshot(page),form,'Stale finally must not modify the current form');
  }
]);
cases.push(['same-org callback does not invalidate a current save','rpc',async page=>{
  await startA(page);await page.waitForFunction(()=>gates.length===1);
  await page.evaluate(()=>changeOrganization({id:'org-A'}));
  await release(page);
  assert.equal(await page.evaluate(()=>effects.at(-1).kind),'open-sheet');
  assert.equal(await page.evaluate(()=>effects.at(-1).id),ids.A);
}]);
for(const phase of ['rpc','color','note','refresh']){
  cases.push([`late rejected ${phase} cannot paint an error into native B`,phase,async page=>{
    await startA(page);await page.waitForFunction(()=>gates.length===1);
    await page.keyboard.press('Escape');await open(page,'B');await edit(page,'B');
    await page.evaluate(()=>{window.newEditor=$('#bookingEditForm');});
    const before=await effectsSnapshot(page),form=await editorSnapshot(page);
    await page.evaluate(()=>gates.shift().reject(new Error('Failed to fetch')));
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.deepEqual(await effectsSnapshot(page),before);assert.deepEqual(await editorSnapshot(page),form);
  }]);
  cases.push([`current rejected ${phase} restores native submit with truthful status`,phase,async page=>{
    await startA(page);await page.waitForFunction(()=>gates.length===1);
    await page.evaluate(()=>gates.shift().reject(new Error('Failed to fetch')));
    await page.waitForFunction(()=>!$('#bookingEditForm button[type="submit"]').disabled);
    assert.equal(await page.locator('#bookingEditForm button[type="submit"]').textContent(),'Сохранить изменения');
    assert.equal(await page.locator('#bookingEditError').isVisible(),true);
    assert.match(await page.locator('#bookingEditError').textContent(),phase==='rpc'?/Не удалось подтвердить результат/:/Основное изменение сохранено/);
    assert.equal(await page.evaluate(()=>effects.some(e=>e.kind==='open-sheet'||e.kind==='notify')),false);
  }]);
}
cases.push(['closing and reopening the same booking invalidates the old incarnation','rpc',async page=>{
  await startA(page);await page.waitForFunction(()=>gates.length===1);
  await page.keyboard.press('Escape');await open(page,'A');
  await page.locator('#editBookingNote').fill('Другая форма той же записи');
  await page.evaluate(()=>{window.newEditor=$('#bookingEditForm');});
  const before=await effectsSnapshot(page),form=await editorSnapshot(page);
  await release(page);
  assert.deepEqual(await effectsSnapshot(page),before);assert.deepEqual(await editorSnapshot(page),form);
}]);
cases.push(['actual color/note helpers reject an already stale context before maps/storage/RPC','',async page=>{
  const before=await effectsSnapshot(page);
  assert.deepEqual(await page.evaluate(async()=>[
    await actualSaveBookingColor(ids.A,'mint',{isCurrent:()=>false}),
    await actualSaveBookingNote(ids.A,'Запрещённая заметка',{isCurrent:()=>false})]),[false,false]);
  assert.deepEqual(await effectsSnapshot(page),before);
}]);
for(const kind of ['color','booking-note'])for(const failed of [false,true])cases.push([
  `actual ${kind} helper after account/maps replacement (${failed?'error':'success'}) preserves the new account`,kind,async page=>{
    await page.evaluate(kind=>{
      const actor=currentUser.id,generation=sessionGeneration;
      const options={rerender:false,isCurrent:()=>sessionIsCurrent(actor,generation)};
      window.helperOperation=kind==='color'?actualSaveBookingColor(ids.A,'mint',options):actualSaveBookingNote(ids.A,'Заметка A',options);
    },kind);
    await page.waitForFunction(()=>gates.length===1);
    await page.evaluate(()=>{
      currentUser={id:'different-provider'};sessionGeneration++;
      bookingColors=new Map([[ids.A,'rose']]);pendingBookingColors=new Set([ids.A]);
      bookingNotes=new Map([[ids.A,'Заметка B']]);pendingBookingNotes=new Set([ids.A]);
      allBookings=structuredClone(allBookings);allBookings[0].color_key='rose';allBookings[0].provider_note='Заметка B';
      persistBookingColors();persistBookingNotes();
    });
    const before=await effectsSnapshot(page);
    await release(page,{data:null,error:failed?{code:'08006',message:'connection lost'}:null});
    assert.equal(await page.evaluate(()=>helperOperation),false);
    assert.deepEqual(await effectsSnapshot(page),before,'Post-await guard must protect replacement maps, pending markers and account-keyed real storage');
  }
]);
cases.push(['late initial A slot response cannot overwrite native B selection','slots',async page=>{
  await page.locator(`[data-edit-booking="${ids.A}"]`).click();
  await page.waitForFunction(()=>gates.length===1);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{holdAt='';});
  await open(page,'B');await edit(page,'B');
  await page.evaluate(()=>{window.newEditor=$('#bookingEditForm');});
  const before=await editorSnapshot(page), times=await page.locator('#editBookingTimes').innerHTML();
  await release(page,{data:[{booking_time:'23:45:00'}],error:null});
  assert.deepEqual(await editorSnapshot(page),before);
  assert.equal(await page.locator('#editBookingTimes').innerHTML(),times);
}]);
cases.push(['same-form out-of-order dates keep the latest actual slot response','',async page=>{
  await open(page,'A');
  await page.evaluate(()=>{holdAt='slots';});
  for(const date of ['2099-09-06','2099-09-07']){
    // Date-input fill can itself fire change in Chromium. Dispatch exactly one
    // actual native change handler per value to control response ordering.
    await page.locator('#editBookingDate').evaluate((input,date)=>{
      input.value=date;input.dispatchEvent(new Event('change',{bubbles:true}));
    },date);
  }
  await page.waitForFunction(()=>gates.length===2);
  await page.evaluate(()=>gates.pop().resolve({data:[{booking_time:'15:00:00'}],error:null}));
  await page.locator('[data-edit-booking-time="15:00"]').click();
  await release(page,{data:[{booking_time:'23:45:00'}],error:null});
  assert.equal(await page.locator('[data-edit-booking-time="23:45"]').count(),0);
  assert.equal(await page.evaluate(()=>bookingEditTime),'15:00');
  assert.equal(await page.locator('#editBookingDate').inputValue(),'2099-09-07');
}]);
cases.push(['native slot loading recovers after rejected transport on the next date change','slots',async page=>{
  await page.locator(`[data-edit-booking="${ids.A}"]`).click();await page.waitForFunction(()=>gates.length===1);
  await page.evaluate(()=>gates.shift().reject(new Error('Failed to fetch')));
  await page.waitForFunction(()=>$('#editBookingTimes').textContent.includes('Не удалось загрузить'));
  await page.evaluate(()=>{holdAt='';});
  await page.locator('#editBookingDate').fill('2099-09-08');await page.locator('#editBookingDate').dispatchEvent('change');
  await page.locator('[data-edit-booking-time="15:00"]').click();
  assert.equal(await page.evaluate(()=>bookingEditTime),'15:00');
}]);
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
