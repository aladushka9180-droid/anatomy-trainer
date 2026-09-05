import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Local rapid-intent regression only. Actual journal controls, change listener,
// color helper and native localStorage execute. RPC and journal list rendering
// are boundaries. Response order is NOT evidence of server commit ordering.
// Three safety cases must remain RED until repaired; no expected-failure flip.
const source=readFileSync(process.env.MINUTA_PROVIDER_SOURCE||new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
function declaration(name){
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0,`Missing actual ${name}`);
  const lineEnd=source.indexOf('\n',start);
  const end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2;
  assert.ok(end>start,`Missing actual end ${name}`);return source.slice(start,end);
}
const names=['saveBookingColor','persistBookingColors','bookingColorStorageKey','bookingColorPendingStorageKey',
  'validBookingColor','bookingColor','bookingColorPicker','requireWrites','sessionIsCurrent'];
if(/^function captureBookingMetadataContext\(/m.test(source))names.push('captureBookingMetadataContext');
const operations=source.match(/^const bookingColorOperations = .*;$/m)?.[0]||'';
if(operations)names.push('beginBookingColorOperation');
const constants=source.match(/^const BOOKING_COLOR_KEYS = [\s\S]*?^const BOOKING_COLOR_DEFAULT = [^\n]+/m)?.[0];
assert.ok(constants,'Actual color definitions');
const revision=source.match(/^let bookingMetadataRevision = .*;$/m)?.[0]||'';
const start=source.indexOf("document.addEventListener('change', async event => {");
const end=source.indexOf('\n});',start);
assert.ok(start>=0&&end>start,'Actual full change listener');
const metadataDependencies = source.includes('// Background replay') ? source.slice(source.indexOf('// Background replay'), source.indexOf('// Local completion ownership')) : '';
const loader=[metadataDependencies,constants,revision,operations,...names.map(declaration),source.slice(start,end+4)].join('\n');
const ids={A:'11111111-1111-4111-8111-111111111111',B:'22222222-2222-4222-8222-222222222222'};
const origin='https://booking-color-revision.test/';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
let browser;
async function fixture(){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],traffic=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(4000);
  await context.route('**/*',route=>{
    if(route.request().url()!==origin){traffic.push(route.request().url());return route.abort();}
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body><main id="journal"></main></body></html>'});
  });
  await page.goto(origin);
  await page.addScriptTag({content:`
    var ids=${JSON.stringify(ids)},currentUser={id:'actor-A'},sessionGeneration=7,activeClientOrganizationId='org-A',writesAllowed=true;
    var $=s=>document.querySelector(s),bookingColors=new Map(),pendingBookingColors=new Set();
    var allBookings=[{id:ids.A,color_key:'auto'},{id:ids.B,color_key:'auto'}];
    var effects=[],gates=[],notify=text=>effects.push({kind:'notify',text});
    var renderBookingData=()=>effects.push({kind:'render-list'});
    var db={rpc:(name,args)=>{
      if(name!=='set_booking_color')throw new Error('Unexpected RPC '+name);
      effects.push({kind:'rpc',args:structuredClone(args)});
      return new Promise((resolve,reject)=>gates.push({resolve,reject,value:args.p_color}));
    }};
    ${loader}
    $('#journal').innerHTML=bookingColorPicker('journal-A','auto',ids.A)+bookingColorPicker('journal-B','auto',ids.B);
  `});
  return{context,page,errors,traffic};
}
async function state(page){
  return page.evaluate(()=>({pending:[...pendingBookingColors],stored:JSON.parse(localStorage.getItem(bookingColorPendingStorageKey())||'[]'),
    colors:Object.fromEntries(bookingColors),selected:Object.fromEntries([...document.querySelectorAll('#journal input:checked')].map(el=>[el.name,el.value])),
    notices:effects.filter(e=>e.kind==='notify').map(e=>e.text),rpc:effects.filter(e=>e.kind==='rpc').map(e=>e.args)}));
}
async function answer(page,index,outcome){
  await page.evaluate(({index,outcome})=>{
    const [gate]=gates.splice(index,1);
    if(outcome==='throw')gate.reject(new Error('Failed to fetch'));
    else gate.resolve({data:gate.value,error:outcome==='error'?{code:'08006',message:'connection lost'}:null});
  },{index,outcome});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
}
async function startTwo(page,different=false){
  await page.locator('[name="journal-A"][value="mint"]').check();
  await page.locator(`[name="journal-${different?'B':'A'}"][value="rose"]`).check();
  await page.waitForFunction(()=>gates.length===2);
  const initial=await state(page);
  assert.deepEqual(initial.rpc,[{p_booking:ids.A,p_color:'mint'},{p_booking:different?ids.B:ids.A,p_color:'rose'}]);
  assert.equal(initial.selected[different?'journal-B':'journal-A'],'rose');
  return initial;
}
function latestLocalColor(result){
  assert.equal(result.colors[ids.A],'rose','Local latest selected color must not roll back');
  assert.equal(result.selected['journal-A'],'rose');
  assert.equal(result.rpc.length,2,'No hidden additional transport attempt');
}
const cases=[
  ['SAFETY older success cannot clear the latest pending intent before its error',async page=>{
    await startTwo(page);await answer(page,0,'success');const middle=await state(page);
    await answer(page,0,'error');const final=await state(page);latestLocalColor(final);
    assert.deepEqual({pendingWhileLatestRuns:middle.pending,storedWhileLatestRuns:middle.stored,noticesBeforeLatestResult:middle.notices,
      pendingAfterLatestError:final.pending,storedAfterLatestError:final.stored},
    {pendingWhileLatestRuns:[ids.A],storedWhileLatestRuns:[ids.A],noticesBeforeLatestResult:[],pendingAfterLatestError:[ids.A],storedAfterLatestError:[ids.A]},
    'Older operation cannot own the latest marker or advertise success for the selected latest intent');
    assert.equal(final.notices.length,1);assert.notEqual(final.notices[0],'Цвет записи сохранён');
  }],
  ...['error','throw'].map(outcome=>[
    `SAFETY latest ${outcome} then older success preserves its marker and warning`,async page=>{
      await startTwo(page);await answer(page,1,outcome);const middle=await state(page);
      assert.deepEqual(middle.pending,[ids.A]);assert.equal(middle.notices.length,1);
      await answer(page,0,'success');const final=await state(page);latestLocalColor(final);
      assert.deepEqual({pending:final.pending,stored:final.stored,notices:final.notices},
        {pending:[ids.A],stored:[ids.A],notices:middle.notices},'Old success must not erase the retry marker or supersede the latest failure notice');
    }
  ]),
  ['CONTROL two successes in reverse response order preserve local latest color',async page=>{
    await startTwo(page);await answer(page,1,'success');await answer(page,0,'success');const final=await state(page);
    latestLocalColor(final);assert.deepEqual(final.pending,[]);assert.deepEqual(final.stored,[]);
    // This local control deliberately makes no server last-write/ordering claim.
  }],
  ['CONTROL distinct bookings retain independent pending markers',async page=>{
    await startTwo(page,true);await answer(page,0,'success');const middle=await state(page);
    assert.deepEqual(middle.pending,[ids.B]);assert.deepEqual(middle.stored,[ids.B]);
    await answer(page,0,'error');const final=await state(page);
    assert.deepEqual(final.pending,[ids.B]);assert.deepEqual(final.stored,[ids.B]);
    assert.equal(final.colors[ids.A],'mint');assert.equal(final.colors[ids.B],'rose');
    assert.equal(final.selected['journal-A'],'mint');assert.equal(final.selected['journal-B'],'rose');
    assert.equal(final.rpc.length,2);
  }]
];
let failed=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run]of cases){let f;try{
    f=await fixture();await run(f.page);assert.deepEqual(f.errors,[],'No unhandled browser rejection');assert.deepEqual(f.traffic,[],'No external network');console.log(`PASS ${name}`);
  }catch(error){failed++;console.error(`FAIL ${name}\n${error.stack}`);if(f?.errors.length)console.error('Browser errors:',f.errors);}
  finally{await f?.context.close();}}
}finally{await browser?.close();}
console.log(`${cases.length-failed}/${cases.length} local native color-revision cases passed; no server ordering proof`);
if(failed)process.exitCode=1;
