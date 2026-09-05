import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const source=readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
function declaration(name) {
  const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));
  assert.ok(start>=0,name);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2;
  return source.slice(start,end);
}
const helpers=source.slice(source.indexOf('// Background replay'),source.indexOf('// Local completion ownership'));
const script=`
let currentUser={id:'actor-A'},sessionGeneration=1,activeClientOrganizationId='org-A',bookingMetadataRevision=0;
let pendingClientNotes=new Map(),clientNotes=new Map(),selectedClientPhone='79990000000',bookingNotes=new Map();
const $=selector=>document.querySelector(selector),sessionIsCurrent=(id,generation)=>currentUser?.id===id&&sessionGeneration===generation;
const normalizePhone=value=>String(value||'').replace(/\\D/g,''),requireWrites=()=>true;
window.notices=[];const notify=message=>notices.push(message);window.calls=[];
const db={from:table=>({upsert:params=>new Promise((resolve,reject)=>calls.push({table,params,resolve,reject}))})};
${declaration('captureBookingMetadataContext')}
${helpers}
${declaration('saveClientNote')}
loadPendingClientNotes();
$('#clientNote').value=clientNotes.get(selectedClientPhone)||'';
$('#saveClientNote').addEventListener('click',saveClientNote);
window.state=()=>({notes:[...clientNotes],pending:[...pendingClientNotes]});
window.switchActor=()=>{currentUser={id:'actor-B'};sessionGeneration++;loadPendingClientNotes();$('#clientNote').value='';};
`;
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
let passed=0;
try {
  for(const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    await context.route('**/*',route=>route.request().url()==='https://metadata.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}):route.abort());
    const page=await context.newPage();
    async function open() {
      await page.goto('https://metadata.test/');
      await page.evaluate(html=>{
        const parsed=new DOMParser().parseFromString(html,'text/html');
        for(const id of ['clientNote','saveClientNote'])document.body.append(parsed.getElementById(id).cloneNode(true));
      },html);
      await page.addScriptTag({content:script});
    }
    await open();
    await page.locator('#clientNote').fill('Важная заметка');await page.locator('#saveClientNote').click();
    await page.waitForFunction(()=>calls.length===1);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(pendingClientNoteStorageKey()))['79990000000']),'Важная заметка');
    // Reload while the transport reply is still missing: actual localStorage,
    // actual input/button and helpers; RPC is deliberately synthetic.
    await open();assert.equal(await page.locator('#clientNote').inputValue(),'Важная заметка');
    await page.evaluate(()=>{window.replayed=saveClientNoteValue('79990000000',pendingClientNotes.get('79990000000'),{replay:true});});
    await page.waitForFunction(()=>calls.length===1);
    await page.evaluate(()=>calls[0].resolve({data:null,error:null}));await page.evaluate(()=>replayed);
    assert.equal((await page.evaluate(()=>state())).pending.length,0);passed++;
    await page.locator('#clientNote').fill('');await page.locator('#saveClientNote').click();
    await page.waitForFunction(()=>calls.length===2);
    await page.evaluate(()=>calls[1].reject(new Error('network')));
    await page.waitForFunction(()=>notices.some(text=>text.includes('на этом устройстве')));
    await open();assert.equal(await page.locator('#clientNote').inputValue(),'');
    assert.deepEqual((await page.evaluate(()=>state())).pending,[['79990000000','']]);passed++;
    await page.locator('#clientNote').fill('Private A');await page.locator('#saveClientNote').click();
    await page.waitForFunction(()=>calls.length===1);
    await page.evaluate(()=>{switchActor();calls[0].resolve({data:null,error:null});});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
    assert.deepEqual((await page.evaluate(()=>state())).notes,[]);assert.deepEqual(await page.evaluate(()=>notices),[]);
    assert.equal(await page.evaluate(()=>localStorage.getItem(pendingClientNoteStorageKey('actor-B'))),null);passed++;
    await context.close();
    console.log(`PASS ${width}px: native save/reload, empty note recovery, actor isolation`);
  }
  console.log(`${passed}/6 native metadata recovery checks passed; synthetic RPC, no production data writes`);
} finally {await browser.close();}
