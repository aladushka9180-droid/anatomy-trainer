import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const start=html.indexOf('<dialog class="free-slots-dialog"');
const dialog=html.slice(start,html.indexOf('</dialog>',start)+9);
const script=readFileSync(new URL('../free-slots-share.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<button id="open">Открыть</button>'+dialog);
  await page.addScriptTag({content:script});
  await page.evaluate(()=>{
    const clock=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
    window.serverTimes=Array.from({length:109},(_,i)=>clock(600+i*5));
    window.serverCalls=[];window.copied=[];window.shared=[];window.serverFail=false;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});
    Object.defineProperty(navigator,'share',{value:async data=>window.shared.push(data.text),configurable:true});
    window.controller=window.MinutaFreeSlots.createController({
      root:document.querySelector('#freeSlotsDialog'),
      getData:()=>({today:'2026-09-05',selectedDate:'2026-09-06',bookingUrl:'https://example.test/booking.html'}),
      loadContext:async()=>({mode:'personal',services:[{id:'service-60',name:'Массаж',duration_minutes:60}],locations:[]}),
      loadSlots:async args=>{
        window.serverCalls.push(args);
        if(window.serverFail) throw Error('Unavailable');
        return {data:window.serverTimes.map(time=>({booking_date:args.from,booking_time:time}))};
      },notify:()=>{}
    });
    document.querySelector('#open').addEventListener('click',window.controller.open);
  });
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  const text=()=>page.locator('#freeSlotsText').inputValue();
  assert.ok((await text()).includes('10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00'));
  assert.equal(await page.locator('#freeSlotsTimeChoices input:checked').count(),10);
  const calls=await page.evaluate(()=>window.serverCalls);
  assert.equal(calls[0].serviceId,'service-60');assert.equal(calls[0].from,'2026-09-06');
  await page.evaluate(()=>{window.serverTimes=window.serverTimes.filter(t=>t<'12:00'||t>='14:20');window.controller.refresh();});
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('10:00, 11:00, 14:20, 15:00, 16:00, 17:00, 18:00, 19:00'));
  await page.locator('#freeSlotsSelectionSummary').click();
  await page.locator('#freeSlotsTimeChoices input[value="2026-09-06T10:00"]').uncheck();
  await page.evaluate(()=>window.controller.refresh());
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok(!(await text()).includes('10:00'),'Manual exclusions survive refresh');
  await page.locator('#freeSlotsAutoSelection').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('10:00'),'Automatic selection can be restored');
  // A start becomes unavailable after preview: it must never reach clipboard.
  await page.evaluate(()=>{window.serverTimes=window.serverTimes.filter(t=>t<'11:00'||t>='12:00');});
  const before=await page.evaluate(()=>window.serverCalls.length);
  await page.locator('#copyFreeSlots').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.evaluate(()=>window.copied.length),0);
  assert.ok(!(await text()).includes('11:00'));
  assert.ok(await page.evaluate(before=>window.serverCalls.length>before,before));
  for(let attempt=0;attempt<3 && await page.evaluate(()=>window.copied.length===0);attempt++){
    await page.locator('#copyFreeSlots').click();
    await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  }
  assert.equal(await page.evaluate(()=>window.copied.length),1);
  assert.ok(!(await page.evaluate(()=>window.copied[0])).includes('11:00'));
  for(let attempt=0;attempt<3 && await page.evaluate(()=>window.shared.length===0);attempt++){
    await page.locator('#shareFreeSlots').click();
    await page.waitForFunction(()=>!document.querySelector('#shareFreeSlots').disabled);
  }
  assert.equal(await page.evaluate(()=>window.shared.length),1);
  await page.evaluate(()=>{window.serverFail=true;window.controller.refresh();});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('не опубликовано'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: real controller, full hourly preview, server gaps, manual/auto selection, fresh pre-send check, copy/share, fail-closed');
} finally {await browser.close();}
