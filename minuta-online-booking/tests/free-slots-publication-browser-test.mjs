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
      getData:()=>({today:'2026-09-05',now:window.testNow || '2026-09-05T08:00:00Z',selectedDate:'2026-09-06',bookingUrl:'https://example.test/booking.html?service=old&time=10:00&repeat=1'}),
      loadContext:async()=>({mode:'personal',services:[{id:'service-60',name:'Массаж',duration_minutes:60}],locations:[]}),
      loadWindows:async args=>{
        if(window.serverFail) throw Error('Unavailable');
        return {data:window.generalWindows || [{booking_date:args.from,start_time:'10:00',end_time:'20:00',duration_minutes:600}]};
      },
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
  assert.ok((await text()).includes('10:00–20:00 · 10 часов'));
  assert.ok(!(await text()).includes('Массаж'));
  assert.equal(await page.locator('#freeSlotsService').isVisible(),false);
  const catalogUrl=new URL(await page.locator('#freeSlotsBookingLink').getAttribute('href'));
  for(const key of ['service','time','repeat']) assert.equal(catalogUrl.searchParams.has(key),false);
  await page.locator('[name="freeSlotsBookingMode"][value="service"]').check();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok(await page.evaluate(()=>Boolean(document.querySelector('#freeSlotsFrom').compareDocumentPosition(document.querySelector('#freeSlotsService')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Date must precede the secondary service choice');
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
  // Same-day cutoff is business time, regardless of the browser/device time zone.
  await page.evaluate(()=>{
    window.testNow='2026-09-06T11:32:00Z'; // Samara 15:32
    window.serverTimes=['10:00','15:30','15:35','16:00','17:00','18:00','19:00'];
    window.controller.refresh();
  });
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('16:00, 17:00, 18:00, 19:00'));
  assert.ok(!(await text()).includes('15:'));
  await page.locator('[name="freeSlotsBookingMode"][value="general"]').check();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('16:00–20:00 · 4 часа'));
  // A new booking before copying must change the preview, never silently send the old interval.
  const copiedBefore=await page.evaluate(()=>window.copied.length);
  await page.evaluate(()=>{window.generalWindows=[{booking_date:'2026-09-06',start_time:'17:00',end_time:'20:00',duration_minutes:180}];});
  await page.locator('#copyFreeSlots').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.evaluate(()=>window.copied.length),copiedBefore);
  assert.ok((await text()).includes('17:00–20:00 · 3 часа'));
  // The open dialog refreshes when its time boundary passes, without a new user click.
  await page.evaluate(()=>{window.testNow='2026-09-06T13:01:00Z';});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('18:00–20:00 · 2 часа'));
  await page.evaluate(()=>{window.serverFail=true;window.controller.refresh();});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('не опубликовано'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS: both modes, catalog link, full hourly preview, server gaps, manual/auto, today 15:32→16:00, live clock rollover, fresh pre-send, copy/share, fail-closed');
} finally {await browser.close();}
