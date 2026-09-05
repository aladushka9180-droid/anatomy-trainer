import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Native DOM regression specification, intentionally RED on the unsafe baseline.
// Actual openBookingSheet block renderer, change/click/Escape/submit handlers,
// metadata helpers and native localStorage execute. List rendering, read-only
// display calculations and RPC transport are fixture boundaries. Not full
// provider bootstrap/auth/SQL/offline-queue or production E2E.
const source=readFileSync(process.env.MINUTA_PROVIDER_SOURCE||new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0,`Missing actual ${name}`);
  const lineEnd=source.indexOf('\n',start);
  const end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2;
  assert.ok(end>start,`Missing actual end of ${name}`);return source.slice(start,end);
}
function listener(prefix){
  const start=source.indexOf(prefix),end=source.indexOf('\n});',start);
  assert.ok(start>=0&&end>start,`Missing actual listener ${prefix}`);return source.slice(start,end+4);
}
const constants=source.match(/^const BOOKING_COLOR_KEYS = [\s\S]*?^const BOOKING_COLOR_DEFAULT = [^\n]+/m)?.[0];
assert.ok(constants,'Actual color definitions');
const revisions=['bookingSeriesCancellationRevision','bookingEditorRevision'].map(name=>
  source.match(new RegExp(`^let ${name} = .*;$`,'m'))?.[0]||'').join('\n');
const resets=[...source.matchAll(/^window\.addEventListener\('minuta:provider-session-reset', \(\) => (?:\{[\s\S]*?^\}\);|[^\n]*\);)/gm)].map(m=>m[0]).join('\n');
const orgStart=source.indexOf('  onActiveOrganizationChange: organization => {');
const orgEnd=source.indexOf('    if (clientOrganizationChanged) {',orgStart);
assert.ok(orgStart>=0&&orgEnd>orgStart,'Actual org identity/epoch prefix');
const orgHook=source.slice(orgStart,orgEnd).replace('  onActiveOrganizationChange: organization => {','function changeOrganization(organization) {')+'\n}';
const functions=['openBookingSheet','closeBookingSheet','saveBookingBlockNote','saveBookingColor','saveBookingNote',
  'persistBookingColors','persistBookingNotes','bookingColorStorageKey','bookingColorPendingStorageKey',
  'bookingNoteStorageKey','bookingNotePendingStorageKey','validBookingColor','bookingColor','bookingColorPicker',
  'bookingDisplayNote','bookingClientNote','normalizePhone','isScheduleBlock','escapeHtml','uiIcon',
  'requireWrites','sessionIsCurrent'];
const loader=[constants,revisions,resets,orgHook,...functions.map(declaration),
  listener("document.addEventListener('change', async event => {"),
  listener("document.addEventListener('click', async event => {"),
  listener("document.addEventListener('keydown', event => {\n  if (event.key !== 'Escape') return;")].join('\n');
const ids={A:'11111111-1111-4111-8111-111111111111',B:'22222222-2222-4222-8222-222222222222'};
const origin='https://metadata-context.test/';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
let browser;
async function fixture(){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],traffic=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(4000);
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(origin).origin&&url.pathname==='/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    if(route.request().url()!==origin){traffic.push(route.request().url());return route.abort();}
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
  });
  await page.goto(origin);
  await page.evaluate(({html,ids})=>{
    const parsed=new DOMParser().parseFromString(html,'text/html');
    for(const id of ['bookingSheet','portfolioEditorDialog']){
      const el=parsed.getElementById(id);if(!el)throw new Error(`Missing real #${id}`);
      document.body.append(document.importNode(el,true));
    }
    for(const name of ['A','B']){
      const button=document.createElement('button');button.dataset.openBooking=ids[name];button.textContent=`Открыть ${name}`;document.body.append(button);
    }
  },{html,ids});
  await page.addStyleTag({content:'[hidden]{display:none!important}svg{width:18px;height:18px}label{display:block}input,textarea,button{font:16px sans-serif}'});
  await page.addScriptTag({content:`
    var ids=${JSON.stringify(ids)},currentUser={id:'actor-A'},sessionGeneration=7,activeClientOrganizationId='org-A';
    var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    var freeSlotsController={invalidateScope(){}},providerReadFetch={cancelPendingReads(){}};
    var gestureClickSuppressedUntil=0,writesAllowed=true,editingOfflineBookingId='',newBookingHistoricalMode=false;
    var SCHEDULE_BLOCK_PHONE='0000000000';
    var bookingColors=new Map(),pendingBookingColors=new Set(),bookingNotes=new Map(),pendingBookingNotes=new Set(),clientNotes=new Map();
    var allBookings=['A','B'].map(name=>({id:ids[name],client_name:'Перерыв '+name,client_phone:SCHEDULE_BLOCK_PHONE,
      booking_date:'2099-09-06',booking_time:'10:00:00',duration_minutes:60,status:'confirmed',provider_note:'Исходная заметка '+name}));
    var bookingSourceItems=()=>allBookings,bookingStatus=()=> 'Подтверждена',bookingStatusClass=()=> 'confirmed';
    var clientMessageButtonMarkup=()=>'',bookingOutcome=()=>({}),bookingMinuteRate=()=>0,bookingSessionTotal=()=>0,applyClientHighlightClasses=()=>{};
    var effects=[],gates=[];
    var renderBookingData=()=>effects.push({kind:'render-list'});
    var notify=text=>effects.push({kind:'notify',text});
    var db={rpc:(name,args)=>{
      if(!['set_booking_color','set_booking_note'].includes(name))throw new Error('Unexpected RPC '+name);
      effects.push({kind:'rpc',name,args:structuredClone(args)});
      return new Promise((resolve,reject)=>gates.push({name,resolve,reject}));
    }};
    ${loader}
  `});
  return{context,page,errors,traffic};
}
async function open(page,name){
  await page.locator(`[data-open-booking="${ids[name]}"]`).click();
  assert.equal(await page.locator('#bookingSheet').getAttribute('data-booking-id'),ids[name]);
  assert.equal(await page.locator('#bookingBlockNoteForm').getAttribute('data-booking-id'),ids[name]);
}
async function start(page,kind){
  await open(page,'A');
  if(kind==='color')await page.locator(`[data-booking-color-id="${ids.A}"][value="mint"]`).check();
  else{
    await page.locator('#bookingBlockNote').fill('Новая заметка A');
    await page.locator('#bookingBlockNoteForm button').click();
  }
  await page.waitForFunction(()=>gates.length===1);
}
async function release(page,outcome){
  await page.evaluate(outcome=>{
    const gate=gates.shift();
    if(outcome==='throw')gate.reject(new Error('Failed to fetch'));
    else gate.resolve({data:null,error:outcome==='error'?{code:'08006',message:'connection lost'}:null});
  },outcome);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
}
async function snapshot(page){
  return page.evaluate(()=>({effects:structuredClone(effects),colors:[...bookingColors],notes:[...bookingNotes],
    pendingColors:[...pendingBookingColors],pendingNotes:[...pendingBookingNotes],storage:Object.entries(localStorage).sort(),
    items:structuredClone(allBookings),sheetId:$('#bookingSheet').dataset.bookingId,visible:!$('#bookingSheet').hidden,
    value:$('#bookingBlockNote').value,noteState:$('.booking-note-state').textContent,
    buttonDisabled:$('#bookingBlockNoteForm button').disabled,buttonCaption:$('#bookingBlockNoteForm button').textContent,
    sameForm:!window.currentForm||window.currentForm===$('#bookingBlockNoteForm')}));
}
const cases=[];
for(const kind of ['color','note'])cases.push([`current ${kind} success persists the intended account`,async page=>{
  await start(page,kind);await release(page,'success');
  const state=await snapshot(page);
  assert.equal(state.effects.filter(e=>e.kind==='rpc').length,1);
  assert.equal(state.effects.find(e=>e.kind==='rpc').args.p_booking,ids.A);
  assert.equal(state.effects.filter(e=>e.kind==='notify').length,1);
  if(kind==='color'){
    assert.equal(state.effects.find(e=>e.kind==='rpc').args.p_color,'mint');
    assert.ok(state.colors.some(([id,color])=>id===ids.A&&color==='mint'));assert.deepEqual(state.pendingColors,[]);
    assert.equal(JSON.parse(state.storage.find(([key])=>key==='massage-booking-colors-v1:actor-A')[1])[ids.A],'mint');
  }else{
    assert.equal(state.effects.find(e=>e.kind==='rpc').args.p_note,'Новая заметка A');
    assert.ok(state.notes.some(([id,note])=>id===ids.A&&note==='Новая заметка A'));assert.deepEqual(state.pendingNotes,[]);
    assert.equal(state.buttonDisabled,false);assert.equal(state.noteState,'Добавлена');
    assert.equal(JSON.parse(state.storage.find(([key])=>key==='massage-booking-notes-v1:actor-A')[1])[ids.A],'Новая заметка A');
  }
}]);
for(const kind of ['color','note'])for(const outcome of ['error','throw'])cases.push([
  `current ${kind} ${outcome} is handled without a false remote-success claim`,async page=>{
    await start(page,kind);await release(page,outcome);
    if(kind==='note')assert.equal(await page.locator('#bookingBlockNoteForm button').isDisabled(),false,'Rejected transport must release native submit');
    const state=await snapshot(page),notices=state.effects.filter(e=>e.kind==='notify').map(e=>e.text);
    assert.ok(notices.length,'The current user needs an honest failure/local-only result');
    assert.ok(notices.every(text=>text!=='Цвет записи сохранён'&&text!=='Заметка сохранена'),'A failed transport is not confirmed remote success');
    assert.equal(state.effects.filter(e=>e.kind==='rpc').length,1,'No automatic write retry');
  }
]);
for(const kind of ['color','note'])cases.push([`same organization refresh preserves current ${kind} success`,async page=>{
  await start(page,kind);await page.evaluate(()=>changeOrganization({id:'org-A'}));await release(page,'success');
  const state=await snapshot(page);
  assert.equal(state.effects.filter(e=>e.kind==='notify').length,1,'An unchanged organization must not suppress a valid result');
  assert.equal(state.buttonDisabled,false);
}]);
for(const kind of ['color','note'])for(const transition of ['account','session-reset','org-roundtrip'])for(const outcome of ['success','error','throw'])cases.push([
  `late ${kind} ${outcome} after ${transition} preserves current DOM/maps/storage`,async page=>{
    await start(page,kind);
    await page.evaluate(({kind,transition})=>{
      if(transition==='account'){
        currentUser={id:'actor-B'};sessionGeneration++;
        bookingColors=new Map([[ids.A,'rose'],[ids.B,'rose']]);pendingBookingColors=new Set(kind==='color'?[ids.A]:[]);
        bookingNotes=new Map([[ids.B,'']]);pendingBookingNotes=new Set();
        allBookings=structuredClone(allBookings);allBookings[1].provider_note='';
        persistBookingColors();persistBookingNotes();
      }else if(transition==='session-reset')window.dispatchEvent(new CustomEvent('minuta:provider-session-reset'));
      else{changeOrganization({id:'org-B'});changeOrganization({id:'org-A'});}
    },{kind,transition});
    if(transition==='account'){
      await page.keyboard.press('Escape');await open(page,'B');
      await page.locator('.booking-note-disclosure summary').click();
      await page.locator('#bookingBlockNote').fill('Несохранённый ввод B');
    }
    await page.evaluate(()=>{window.currentForm=$('#bookingBlockNoteForm');});
    const before=await snapshot(page);await release(page,outcome);
    assert.deepEqual(await snapshot(page),before,'No stale notice, control change, pending-marker mutation or cross-account persistence');
  }
]);
let failed=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run]of cases){
    let f;
    try{
      f=await fixture();await run(f.page);
      assert.deepEqual(f.errors,[],'No unhandled native browser rejection');assert.deepEqual(f.traffic,[],'No external network');
      console.log(`PASS ${name}`);
    }catch(error){failed++;console.error(`FAIL ${name}\n${error.stack}`);if(f?.errors.length)console.error('Browser errors:',f.errors);}
    finally{await f?.context.close();}
  }
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native metadata cases passed; list renderer and full provider E2E are not exercised`);
if(failed)process.exitCode=1;
