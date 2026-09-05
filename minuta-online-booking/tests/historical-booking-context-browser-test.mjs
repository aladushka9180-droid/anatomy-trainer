import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Native historical-create regression, not full provider/auth/SQL E2E.
// Actual form renderer, historical time picker, handlers, metadata helper and
// local/sessionStorage execute. Placement validation uses an explicit no-conflict
// fixture; RPC/refresh/list rendering/final navigation are controlled boundaries.
// Exactly one mocked historical create confirms before its deferred color write.
const source=readFileSync(process.env.MINUTA_PROVIDER_SOURCE||new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
function declaration(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,`Actual ${name}`);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2;
  assert.ok(end>start,`Actual function end ${name}`);return source.slice(start,end);
}
function listener(prefix){const start=source.indexOf(prefix),end=source.indexOf('\n});',start);assert.ok(start>=0&&end>start);return source.slice(start,end+4);}
const functions=['openNewBookingSheet','createNewBooking','closeBookingSheet','setNewBookingMode','loadNewBookingSlots','renderNewBookingTimePicker',
  'updateNewBookingConnectivity','updateNewBookingSubmitCaption','updateNewBookingDurationControl','newBookingDurationMinutes','selectedNewBookingService',
  'normalizePerMinuteDuration','serviceDefaultDuration','serviceOptions','serviceName','money','escapeHtml','uiIcon','normalizePhone','minutesFromTime','timeFromMinutes','scheduleStepForDate','parseLocalIsoDate','localIsoDate',
  'bookingDraftKey','readNewBookingDraft','saveNewBookingDraft','clearNewBookingDraft','bookingColorPicker','compactBookingColorPicker','bookingColor','validBookingColor',
  'saveBookingColor','persistBookingColors','bookingColorStorageKey','bookingColorPendingStorageKey','requireBookingWrites','sessionIsCurrent','captureBookingMetadataContext',
  'showFormError','clearFormError'];
const constants=source.match(/^const BOOKING_COLOR_KEYS = [\s\S]*?^const BOOKING_COLOR_DEFAULT = [^\n]+/m)?.[0];assert.ok(constants);
const revisions=['bookingSeriesCancellationRevision','bookingEditorRevision','bookingMetadataRevision'].map(name=>{
  const value=source.match(new RegExp(`^let ${name} = .*;$`,'m'))?.[0];assert.ok(value,`Actual ${name}`);return value;
}).join('\n');
const operations=source.match(/^const bookingColorOperations = .*;$/m)?.[0]||'';if(operations)functions.push('beginBookingColorOperation');
const opening=source.match(/^\$\('#newBookingButton'\)\.addEventListener\('click',[^\n]+/m)?.[0];assert.ok(opening,'Actual opening click handler');
const metadataDependencies = source.includes('// Background replay') ? source.slice(source.indexOf('// Background replay'), source.indexOf('// Local completion ownership')) : '';
const loader=[metadataDependencies,constants,revisions,operations,...functions.map(declaration),opening,
  listener("document.addEventListener('click', async event => {"),
  listener("document.addEventListener('keydown', event => {\n  if (event.key !== 'Escape') return;")].join('\n');
const ids={booking:'11111111-1111-4111-8111-111111111111',service:'22222222-2222-4222-8222-222222222222'};
const origin='https://historical-context.test/';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
let browser;
async function fixture(){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(5000);
  const errors=[],traffic=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin===new URL(origin).origin&&url.pathname==='/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    if(route.request().url()!==origin){traffic.push(route.request().url());return route.abort();}
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
  });
  await page.goto(origin);
  await page.evaluate(html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    for(const id of ['bookingSheet','portfolioEditorDialog','newBookingButton']){
      const node=doc.getElementById(id);if(!node)throw Error(`Missing actual #${id}`);document.body.append(document.importNode(node,true));
    }
  },html);
  await page.addStyleTag({content:'[hidden]{display:none!important}svg{width:18px;height:18px}label{display:block}input,button,textarea,select{font:16px sans-serif}'});
  await page.addScriptTag({content:`
    var ids=${JSON.stringify(ids)},currentUser={id:'actor-A'},sessionGeneration=7,activeClientOrganizationId='org-A';
    var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
    var writesAllowed=true,bookingCreationReady=true,selectedDate='2020-01-05',editingOfflineBookingId='';
    var newBookingTime='',newBookingSlots=[],newBookingHour='',newBookingPreferredTime='',newBookingHistoricalMode=false,newBookingOutsideSchedule=false,newBookingMode='client';
    var PER_MINUTE_BOOKING_MIN=1,PER_MINUTE_BOOKING_MAX=480,serviceDurationDefaults={},SCHEDULE_BLOCK_PHONE='0000000000',gestureClickSuppressedUntil=0;
    var ownServices=[{id:ids.service,active:true,name:'Тестовая услуга',duration_minutes:60,price_rub:1000}],scheduleRows=[];
    var allBookings=[],clientNotes=new Map(),pendingClientNotes=new Map(),bookingColors=new Map(),pendingBookingColors=new Set();
    var businessTodayIso=()=> '2026-09-06',bookingUsesDemoData=()=>false;
    var placementCalls=[],bookingPlacementIssue=(...args)=>{placementCalls.push(args);return null;};
    var applyClientHighlightClasses=()=>{},scheduleNewBookingClientSuggestions=()=>{},hideNewBookingClientSuggestions=()=>{};
    var organizationController={getActiveOrganization:()=>({id:activeClientOrganizationId})};
    var effects=[],gates=[],hold='color',refreshOutcome='success';
    var renderBookingData=()=>effects.push({kind:'render-list'}),notify=text=>effects.push({kind:'notify',text});
    var selectScheduleDate=date=>effects.push({kind:'select-date',date});
    var refreshAfterWrite=async()=>{effects.push({kind:'refresh'});if(refreshOutcome==='throw')throw Error('refresh_failed');return refreshOutcome!=='error';};
    var focusCreatedBooking=id=>effects.push({kind:'focus-created',id});
    var historicalAck={booking_id:ids.booking,booking_code:'MIN-A1B2C3D4E5',duration_minutes:60,unit_price_rub:1000,
      total_price_rub:1000,payment_required:false,notifications_suppressed:true};
    var transport=(kind,value)=>hold===kind?new Promise((resolve,reject)=>gates.push({kind,resolve,reject,value})):Promise.resolve(value);
    var db={rpc:(name,args)=>{
      effects.push({kind:'rpc',name,args:structuredClone(args)});
      // Actual v98 envelope; no invented status or notification dispatch.
      if(name==='create_minuta_historical_booking')return transport('create',{data:structuredClone(historicalAck),error:null});
      if(name==='set_booking_color')return transport('color',{data:args.p_color,error:null});
      throw Error('Unexpected RPC '+name);
    },from:name=>{
      if(name!=='client_notes')throw Error('Unexpected table write '+name);
      return {upsert:args=>{effects.push({kind:'client-note',args:structuredClone(args)});return transport('note',{error:null});}};
    }};
    ${loader}
  `});
  return{context,page,errors,traffic};
}
async function openAndFill(page,label){
  await page.locator('#newBookingButton').click();
  await page.locator('#newBookingName').fill(`Клиент ${label}`);
  await page.locator('#newBookingPhone').fill(label==='A'?'+79990000001':'+79990000002');
  await page.locator('[data-new-booking-time="10:15"]').click();
  await page.locator('#newBookingAdvanced > summary').click();
  await page.locator('.booking-color-compact > summary').click();
  await page.locator(`[name="newBookingColor"][value="${label==='A'?'mint':'rose'}"]`).check();
  assert.equal(await page.evaluate(()=>newBookingHistoricalMode),true);
  assert.equal(await page.locator('#newBookingSubmit').textContent(),'Добавить прошедший визит');
}
async function start(page){
  await openAndFill(page,'A');await page.locator('#newBookingSubmit').click();await page.waitForFunction(()=>gates.length===1);
  assert.deepEqual(await page.evaluate(()=>effects.filter(e=>e.kind==='rpc').map(e=>e.name)),['create_minuta_historical_booking','set_booking_color']);
}
async function release(page){await page.evaluate(()=>{const gate=gates.shift();gate.resolve(gate.value);});await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function startCreate(page){
  await page.evaluate(()=>{hold='create';});await openAndFill(page,'A');await page.locator('#newBookingSubmit').click();
  await page.waitForFunction(()=>gates.some(gate=>gate.kind==='create'));
}
async function answerCreate(page,kind){
  await page.evaluate(kind=>{
    const gate=gates.shift();hold='';
    if(kind==='throw')return gate.reject(Error('slot_unavailable'));
    const result=kind==='refusal'?{data:null,error:{code:'23P01',message:'slot_unavailable'}}
      :kind==='null'?{data:null,error:null}
      :kind==='partial'?{data:{booking_id:ids.booking},error:null}
      :kind==='network-name'?{data:null,error:{code:'08006',message:'slot_unavailable'}}
      :{data:null,error:{code:'23P01',message:'network: slot_unavailable'}};
    gate.resolve(result);
  },kind);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
}
async function exerciseCaption(page){
  // Real form input/date-change/occurrence-change handlers, including actual
  // historical slot rendering and updateNewBookingSubmitCaption. Programmatic
  // events also test the submit guard if a caller bypasses disabled controls.
  await page.evaluate(()=>{
    $('#newBookingName').dispatchEvent(new Event('input',{bubbles:true}));
    $('#newBookingDate').dispatchEvent(new Event('change',{bubbles:true}));
    $('#newBookingOccurrences').dispatchEvent(new Event('change',{bubbles:true}));
    $('[data-new-booking-time="10:15"]').click();
  });
  assert.equal(await page.evaluate(()=>newBookingTime),'10:15','Keep validation preconditions valid; missing time must not mask duplicate protection');
}
async function attemptResubmit(page){
  await page.evaluate(()=>{
    const form=$('#newBookingForm'),button=$('#newBookingSubmit');
    form.requestSubmit(button);
    form.dispatchEvent(new SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));
  });
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
}
async function snapshot(page){return page.evaluate(()=>({
  visible:!$('#bookingSheet').hidden,sameForm:!window.destinationForm||window.destinationForm===$('#newBookingForm'),
  name:$('#newBookingName').value,phone:$('#newBookingPhone').value,date:$('#newBookingDate').value,time:newBookingTime,
  color:$('[name="newBookingColor"]:checked').value,note:$('#newBookingNote').value,
  buttonDisabled:$('#newBookingSubmit').disabled,buttonCaption:$('#newBookingSubmit').textContent,
  localStorage:Object.entries(localStorage).sort(),sessionStorage:Object.entries(sessionStorage).sort(),
  colors:[...bookingColors],pending:[...pendingBookingColors],clientNotes:[...clientNotes],effects:structuredClone(effects)
}));}
const cases=[['CONTROL current historical form completes one intended create',async page=>{
  await start(page);await release(page);const state=await snapshot(page);
  assert.equal(state.visible,false);
  assert.deepEqual(state.effects.map(e=>e.kind),['rpc','rpc','select-date','refresh','focus-created','notify']);
  assert.deepEqual(state.effects[0].args,{p_organization:'org-A',p_service:ids.service,p_date:'2020-01-05',p_time:'10:15:00',p_duration_minutes:60,p_client_name:'Клиент A',p_client_phone:'+79990000001'});
  assert.deepEqual(state.effects[1].args,{p_booking:ids.booking,p_color:'mint'});
  assert.equal(state.effects.at(-2).id,ids.booking);assert.deepEqual(state.pending,[]);
  assert.equal(state.sessionStorage.some(([key])=>key==='minuta-provider-booking-draft-v1:actor-A'),false);
}]];
for(const transition of ['account','close-reopen'])cases.push([
  `SAFETY confirmed historical A then pending color cannot complete into ${transition} B`,async page=>{
    await start(page);await page.keyboard.press('Escape');
    await page.evaluate(transition=>{
      if(transition==='account'){
        currentUser={id:'actor-B'};sessionGeneration++;activeClientOrganizationId='org-B';
        bookingColors=new Map([[ids.booking,'rose']]);pendingBookingColors=new Set([ids.booking]);clientNotes=new Map([['79990000002','Заметка B']]);
        allBookings=[];persistBookingColors();
      }
      selectedDate='2020-01-06';
    },transition);
    await openAndFill(page,'B');await page.locator('#newBookingNote').fill('Несохранённая форма B');
    await page.evaluate(()=>{window.destinationForm=$('#newBookingForm');});
    const before=await snapshot(page);await release(page);
    assert.deepEqual(await snapshot(page),before,'Old completion cannot clear draft, close B, navigate, refresh, toast or change current caches');
  }
]);
cases.push(['SAFETY pending CREATE survives input/change caption refresh and duplicate submit',async page=>{
  await startCreate(page);await exerciseCaption(page);const disabled=await page.locator('#newBookingSubmit').isDisabled();
  await attemptResubmit(page);
  const calls=await page.evaluate(()=>effects.filter(e=>e.name==='create_minuta_historical_booking').length);
  // Drain all fixture transports even on the unsafe baseline before asserting.
  await page.evaluate(()=>{hold='';gates.splice(0).forEach(g=>g.resolve({data:null,error:{code:'23P01',message:'slot_unavailable'}}));});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
  assert.equal(disabled,true,'A caption refresh must not unlock an in-flight non-idempotent CREATE');
  assert.equal(calls,1,'Exactly one CREATE while the first result is pending');
}]);
for(const kind of ['null','partial','network-name','wrong-pair','throw'])cases.push([
  `SAFETY unknown historical ${kind} keeps CREATE latched with no retry`,async page=>{
    await startCreate(page);await answerCreate(page,kind);await exerciseCaption(page);
    const disabled=await page.locator('#newBookingSubmit').isDisabled();await attemptResubmit(page);
    const state=await snapshot(page);
    assert.equal(disabled,true,'No request_id exists: unknown outcome cannot unlock a safe CREATE repeat');
    assert.equal(state.effects.filter(e=>e.name==='create_minuta_historical_booking').length,1);
    assert.equal(state.effects.filter(e=>e.name==='set_booking_color').length,0,'Unconfirmed acknowledgement must not start auxiliary writes');
    assert.equal(state.effects.some(e=>e.kind==='focus-created'),false);
    assert.equal(state.effects.some(e=>e.kind==='notify'&&/Запись в прошлом создана/.test(e.text)),false);
    assert.equal(state.name,'Клиент A');assert.equal(state.visible,true);
  }
]);
cases.push(['CONTROL exact v98 SQL refusal unlocks editing and a new explicit attempt',async page=>{
  await startCreate(page);await answerCreate(page,'refusal');
  assert.equal(await page.locator('#newBookingSubmit').isEnabled(),true);
  assert.equal(await page.locator('#newBookingError').isVisible(),true);
  await page.locator('#newBookingName').fill('Исправленный клиент');
  await page.locator('[data-new-booking-time="10:15"]').click();
  await page.evaluate(()=>{hold='create';});await page.locator('#newBookingSubmit').click();
  assert.equal(await page.evaluate(()=>effects.filter(e=>e.name==='create_minuta_historical_booking').length),2);
  await answerCreate(page,'refusal');
}]);
for(const phase of ['color','refresh'])for(const outcome of ['error','throw'])cases.push([
  `SAFETY confirmed CREATE then ${phase} ${outcome} remains created without another CREATE`,async page=>{
    if(phase==='refresh')await page.evaluate(outcome=>{refreshOutcome=outcome;},outcome);
    await start(page);
    await page.evaluate(({phase,outcome})=>{
      const gate=gates.shift();hold='';
      if(phase==='color'&&outcome==='throw')gate.reject(Error('color_failed'));
      else gate.resolve({data:null,error:phase==='color'?{code:'08006',message:'color failed'}:null});
    },{phase,outcome});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    const message=await page.evaluate(()=>[$('#newBookingError').hidden?'':$('#newBookingError').textContent,...effects.filter(e=>e.kind==='notify').map(e=>e.text)].join(' '));
    await exerciseCaption(page);await attemptResubmit(page);
    assert.equal(await page.evaluate(()=>effects.filter(e=>e.name==='create_minuta_historical_booking').length),1,'Confirmed primary must never be repeated for an auxiliary error');
    assert.match(message,/создан|добавлен|основн.{0,30}сохран/i,'The acknowledged creation must be distinguished from failed auxiliary work');
    assert.match(message,/проверьте|не удалось|не заверш|не обнов|не сохран/i,'Auxiliary failure must not be reported as full success');
    assert.doesNotMatch(message,/ничего не создан|запись не создана|откат/i,'No invented rollback');
  }
]);
async function startNotes(page){
  await page.evaluate(()=>{hold='note';clientNotes.set('79990000001','Прежняя сохранённая заметка A');});await openAndFill(page,'A');
  await page.locator('#newBookingNote').fill('Новая заметка клиента A');
  await page.locator('#newBookingSubmit').click();await page.waitForFunction(()=>gates.some(g=>g.kind==='note'));
  assert.equal(await page.evaluate(()=>effects.filter(e=>e.name==='create_minuta_historical_booking').length),1);
}
async function answerNotes(page,outcome){
  await page.evaluate(outcome=>{
    const gate=gates.shift();hold='';
    if(outcome==='throw')gate.reject(Error('client_note_failed'));
    else gate.resolve({data:null,error:outcome==='error'?{code:'42501',message:'new row violates row-level security policy for table "client_notes"'}:null});
  },outcome);
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
}
cases.push(['CONTROL confirmed historical CREATE and successful client note update its own cache',async page=>{
  await startNotes(page);await answerNotes(page,'success');const state=await snapshot(page);
  assert.deepEqual(state.clientNotes,[['79990000001','Новая заметка клиента A']]);
  const write=state.effects.find(e=>e.kind==='client-note').args;
  assert.equal(write.performer_id,'actor-A');assert.equal(write.client_phone,'79990000001');assert.equal(write.note,'Новая заметка клиента A');
  assert.equal(state.effects.filter(e=>e.name==='create_minuta_historical_booking').length,1);
  assert.equal(state.effects.filter(e=>e.name==='set_booking_color').length,1);
  assert.equal(state.visible,false);assert.match(state.effects.at(-1).text,/Запись в прошлом создана/);
}]);
for(const outcome of ['error','throw'])cases.push([
  `SAFETY confirmed CREATE then client note ${outcome} cannot cache unsaved text or repeat CREATE`,async page=>{
    await startNotes(page);await answerNotes(page,outcome);
    const state=await snapshot(page);
    const message=await page.evaluate(()=>[$('#newBookingError').hidden?'':$('#newBookingError').textContent,...effects.filter(e=>e.kind==='notify').map(e=>e.text)].join(' '));
    await exerciseCaption(page);await attemptResubmit(page);
    assert.deepEqual(state.clientNotes,[['79990000001','Прежняя сохранённая заметка A']],'A failed client_notes write must preserve prior saved client data');
    assert.equal(await page.evaluate(()=>effects.filter(e=>e.name==='create_minuta_historical_booking').length),1);
    assert.match(message,/создан|добавлен|основн.{0,30}сохран/i);
    assert.match(message,/проверьте|не удалось|не заверш|не подтвержд|не сохран/i,'Warn about incomplete note persistence after confirmed creation');
    assert.doesNotMatch(message,/ничего не создан|запись не создана|откат/i);
  }
]);
for(const transition of ['account','close-reopen'])for(const outcome of ['success','error','throw'])cases.push([
  `SAFETY pending client note ${outcome} after ${transition} B cannot mutate its cache or native form`,async page=>{
    await startNotes(page);await page.keyboard.press('Escape');
    await page.evaluate(transition=>{
      if(transition==='account'){
        currentUser={id:'actor-B'};sessionGeneration++;activeClientOrganizationId='org-B';
        bookingColors=new Map();pendingBookingColors=new Set();
        clientNotes=new Map([['79990000002','Сохранённая заметка B']]);allBookings=[];
      }
      selectedDate='2020-01-06';
    },transition);
    await openAndFill(page,'B');await page.locator('#newBookingNote').fill('Черновик клиента B');
    await page.evaluate(()=>{window.destinationForm=$('#newBookingForm');});
    const before=await snapshot(page);await answerNotes(page,outcome);
    assert.deepEqual(await snapshot(page),before,'Old note result must not add unsaved cache data, start color, close B, clear draft or notify');
  }
]);
let failed=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const[name,run]of cases){let f;try{
    f=await fixture();await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log(`PASS ${name}`);
  }catch(error){failed++;console.error(`FAIL ${name}\n${error.stack}`);if(f?.errors.length)console.error('Browser errors:',f.errors);}
  finally{await f?.context.close();}}
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} native historical context cases passed; mocked create/color, no server booking`);
if(failed)process.exitCode=1;
