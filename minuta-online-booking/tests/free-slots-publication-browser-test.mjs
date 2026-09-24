import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const start=html.indexOf('<dialog class="free-slots-dialog"');
const dialog=html.slice(start,html.indexOf('</dialog>',start)+9);
const script=readFileSync(new URL('../free-slots-share.js',import.meta.url),'utf8');
const providerSource=readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js',import.meta.url),'utf8');
const orgHookStart=providerSource.indexOf('  onActiveOrganizationChange: organization => {');
const orgHookEnd=providerSource.indexOf('    if (clientOrganizationChanged) {',orgHookStart);
assert.ok(orgHookStart>=0 && orgHookEnd>orgHookStart,'Actual organization callback must be available');
const orgHook=providerSource.slice(orgHookStart,orgHookEnd)
  .replace('  onActiveOrganizationChange: organization => {','window.emitTestOrganization = organization => {')+'\n};';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://example.test/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<button id="open">Открыть</button>'+dialog}));
  await page.goto('https://example.test/');
  await page.addScriptTag({content:script});
  const setup=()=>{
    const clock=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
    window.serverTimes=Array.from({length:109},(_,i)=>clock(600+i*5));
    window.serverCalls=[];window.copied=[];window.shared=[];window.serverFail=false;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});
    Object.defineProperty(navigator,'share',{value:async data=>window.shared.push(data.text),configurable:true});
    window.controller=window.MinutaFreeSlots.createController({
      root:document.querySelector('#freeSlotsDialog'),
      getData:()=>({userId:window.testUser || 'master-a',today:'2026-09-05',now:window.testNow || '2026-09-05T08:00:00Z',selectedDate:'2026-09-06',bookingUrl:'https://example.test/booking.html?service=old&time=10:00&repeat=1'}),
      loadContext:async()=>({mode:'personal',performerLabel:'Рамиль',services:[{id:'service-60',name:'Массаж',duration_minutes:60,performer_profiles:{display_name:'Рамиль'}}],locations:[]}),
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
  };
  await page.evaluate(setup);
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  const text=()=>page.locator('#freeSlotsText').inputValue();
  // Organization reloads emit the same ID on every background synchronization.
  // Execute the production callback prefix, not a reimplementation of its guard.
  await page.evaluate(`(() => {
    const freeSlotsController=window.controller;
    let activeClientOrganizationId='';
    let bookingSeriesCancellationRevision=0, bookingEditorRevision=0, bookingMetadataRevision=0, portfolioEditorRevision=0;
    ${orgHook}
  })()`);
  const beforeSync=await text();
  for(let i=0;i<3;i++) await page.evaluate(()=>window.emitTestOrganization(null));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),false,'Same personal context must survive background synchronization');
  assert.equal(await text(),beforeSync,'Same-context synchronization must preserve preview');
  await page.evaluate(()=>window.emitTestOrganization({id:'org-a'}));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true,'Actual organization switch must invalidate old publication');
  assert.equal(await page.locator('#copyFreeSlotsLink').isDisabled(),true);
  await page.locator('[data-close-free-slots]').click();
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  for(let i=0;i<3;i++) await page.evaluate(()=>window.emitTestOrganization({id:'org-a',name:'Updated organization'}));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),false,'Reloaded organization objects with the same ID must preserve publication');
  await page.evaluate(()=>window.emitTestOrganization({id:'org-b'}));
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true,'Different organization must remain protected');
  await page.evaluate(()=>window.emitTestOrganization(null));
  await page.locator('[data-close-free-slots]').click();
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('10:00–20:00 · 10 часов'));
  assert.ok(!(await text()).includes('Максимальный непрерывный интервал'));
  assert.ok(!(await text()).includes('Массаж'));
  assert.ok(!(await text()).includes('Рамиль'));
  assert.equal(await page.locator('#freeSlotsService').isVisible(),false);
  const catalogUrl=new URL(await page.locator('#freeSlotsBookingLink').getAttribute('href'));
  for(const key of ['service','time','repeat']) assert.equal(catalogUrl.searchParams.has(key),false);
  assert.equal(await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').isVisible(),true,'Format is available without expanding settings');
  assert.equal(await page.locator('#freeSlotsFormatSettings').evaluate(el=>el.nextElementSibling.matches('details.free-slots-extra')),true,'Additional settings follow primary format');
  assert.equal(await page.locator('#freeSlotsText').evaluate(el=>Boolean(el.closest('.free-slots-result'))),true,'Ready text stays in the preview');
  assert.equal(await page.locator('.free-slots-extra').getAttribute('open'),null,'Additional settings start collapsed');
  assert.equal(await page.locator('#freeSlotsFormatHint').isVisible(),false);
  await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').check();
  assert.ok((await text()).includes('\n10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00\n'));
  assert.ok(!(await text()).includes('20:00'));
  assert.ok(!(await text()).includes('Рамиль'));
  await page.locator('.free-slots-extra > summary').click();
  await page.locator('[name="freeSlotsTextLayout"][value="compact"]').check();
  assert.ok((await text()).includes('вс, 6 сентября, 10:00, 11:00, 12:00'));
  await page.evaluate(()=>{window.generalWindows=[{booking_date:'2026-09-06',start_time:'10:00',end_time:'20:00',duration_minutes:600},{booking_date:'2026-09-08',start_time:'11:00',end_time:'13:00',duration_minutes:120}];});
  await page.locator('[name="freeSlotsPeriod"][value="range"]').check();
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('8 сентября, 11:00, 12:00'));
  const mixedPreview=await text();
  assert.ok(!mixedPreview.includes('7 сентября') && !mixedPreview.includes('макс.') && mixedPreview.includes('https://example.test/booking.html'));
  const copiedCompactBefore=await page.evaluate(()=>window.copied.length);
  for(let attempt=0;attempt<3 && await page.evaluate(length=>window.copied.length===length,copiedCompactBefore);attempt++) {
    await page.locator('#copyFreeSlots').click();
    await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  }
  assert.equal(await page.evaluate(()=>window.copied.at(-1)),await text(),'Copied compact text must match the preview');
  await page.evaluate(()=>{window.generalWindows=null;window.copied=[];});
  await page.locator('[name="freeSlotsPeriod"][value="day"]').check();
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('10:00, 11:00'));
  await page.locator('#freeSlotsText').fill('Мой текст для клиента');
  assert.equal(await page.locator('#resetFreeSlotsText').isVisible(),true);
  await page.locator('#freeSlotsShowHeading').uncheck();
  assert.equal(await text(),'Мой текст для клиента','Manual text must survive presentation changes');
  assert.equal(await page.locator('#freeSlotsManualNotice').isVisible(),true);
  await page.locator('#keepFreeSlotsText').click();
  assert.equal(await page.locator('#freeSlotsManualNotice').isVisible(),false);
  await page.locator('#resetFreeSlotsText').click();
  assert.ok((await text()).startsWith('вс, 6 сентября, 10:00'));
  await page.locator('#freeSlotsShowHeading').check();
  await page.locator('[name="freeSlotsTextLayout"][value="detailed"]').check();
  assert.equal(await page.evaluate(()=>localStorage.getItem('minuta:free-slots-format:master-a')),'hourly');
  await page.locator('[data-close-free-slots]').click();
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').isChecked(),true);
  // Preferences do not leak to a different signed-in master in the same browser.
  await page.locator('[data-close-free-slots]').click();
  await page.evaluate(()=>{window.testUser='master-b';});
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.locator('[name="freeSlotsTimeFormat"][value="intervals"]').isChecked(),true);
  await page.locator('[data-close-free-slots]').click();
  await page.evaluate(()=>{window.testUser='master-a';});
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').isChecked(),true);
  await page.locator('[name="freeSlotsTimeFormat"][value="intervals"]').check();
  await page.locator('[name="freeSlotsBookingMode"][value="service"]').check();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.locator('#freeSlotsFormatSettings').isVisible(),false);
  assert.ok((await text()).includes('Массаж'));
  assert.ok(!(await text()).includes('Рамиль'));
  await page.locator('#freeSlotsShowService').uncheck();
  assert.ok(!(await text()).includes('Массаж'));
  assert.ok(!(await text()).includes('Рамиль'));
  await page.locator('#freeSlotsShowService').check();
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
  await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').check();
  assert.ok((await text()).includes('16:00, 17:00, 18:00, 19:00'));
  assert.ok(!(await text()).includes('15:'));
  // A new booking before copying must change the preview, never silently send the old interval.
  const copiedBefore=await page.evaluate(()=>window.copied.length);
  await page.evaluate(()=>{window.generalWindows=[{booking_date:'2026-09-06',start_time:'17:00',end_time:'20:00',duration_minutes:180}];});
  await page.locator('#copyFreeSlots').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.equal(await page.evaluate(()=>window.copied.length),copiedBefore);
  assert.ok((await text()).includes('17:00, 18:00, 19:00'));
  assert.ok(!(await text()).includes('16:00'));
  for(let attempt=0;attempt<3 && await page.evaluate(length=>window.copied.length===length,copiedBefore);attempt++){
    await page.locator('#copyFreeSlots').click();
    await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  }
  assert.equal(await page.evaluate(()=>window.copied.length),copiedBefore+1);
  assert.ok(!(await page.evaluate(()=>window.copied.at(-1))).includes('Максимальный непрерывный интервал'));
  assert.ok(!(await page.evaluate(()=>window.copied.at(-1))).includes('16:00'));
  await page.locator('[name="freeSlotsTimeFormat"][value="intervals"]').check();
  assert.ok((await text()).includes('17:00–20:00 · 3 часа'));
  // The open dialog refreshes when its time boundary passes, without a new user click.
  await page.evaluate(()=>{window.testNow='2026-09-06T13:01:00Z';});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('18:00–20:00 · 2 часа'));
  await page.evaluate(()=>{window.serverFail=true;window.controller.refresh();});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('не опубликовано'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  await page.evaluate(()=>{window.serverFail=false;window.generalWindows=[];window.controller.refresh();});
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('На выбранный период свободных окон нет.'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true,'Empty general period must not be copied');
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#freeSlotsEmpty').isVisible(),true,'Empty period has a clear preview state');
  assert.equal(await page.locator('#freeSlotsEmptyPeriod').innerText(),'6 сентября 2026 г.');
  await page.locator('[name="freeSlotsPeriod"][value="range"]').check();
  await page.waitForFunction(()=>document.querySelector('#freeSlotsEmptyPeriod').textContent.includes('6–12 сентября 2026'));
  await page.locator('[name="freeSlotsPeriod"][value="day"]').check();
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').closest('.free-slots-text-label').hidden);
  assert.equal(await page.locator('#freeSlotsText').isVisible(),false,'Unpublishable text is not shown as a ready preview');
  await page.locator('#freeSlotsChangeDates').click();
  assert.equal(await page.locator('#freeSlotsFrom').evaluate(el=>document.activeElement===el),true);
  assert.ok((await page.locator('#freeSlotsShareStatus').innerText()).includes('свободных окон нет'));
  assert.ok((await text()).includes('день полностью занят'),'Empty state must preserve day status');
  await page.locator('[name="freeSlotsTextLayout"][value="compact"]').check();
  assert.ok((await text()).includes('На выбранный период свободных окон нет.'));
  assert.ok(!(await text()).includes('день полностью занят'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#copyFreeSlotsLink').isDisabled(),false);
  await page.locator('[name="freeSlotsTextLayout"][value="detailed"]').check();
  await page.evaluate(()=>{window.serverTimes=[];});
  await page.locator('[name="freeSlotsBookingMode"][value="service"]').check();
  await page.waitForFunction(()=>document.querySelector('#freeSlotsText').value.includes('На выбранный период свободных окон пока нет.'));
  assert.equal(await page.locator('#copyFreeSlots').isDisabled(),true,'Empty service period must not be copied');
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  // A new page/controller restores the saved format, not just a live radio state.
  await page.evaluate(()=>localStorage.setItem('minuta:free-slots-format:master-a','hourly'));
  await page.reload();
  await page.addScriptTag({content:script});
  await page.evaluate(setup);
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('\n10:00, 11:00'));
  assert.equal(await page.locator('[name="freeSlotsTimeFormat"][value="hourly"]').isVisible(),true);
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('Storage denied');};});
  await page.locator('[name="freeSlotsTimeFormat"][value="intervals"]').check();
  assert.ok((await text()).includes('10:00–20:00 · 10 часов'));
  assert.ok((await page.locator('#freeSlotsFormatHint').textContent()).includes('до перезагрузки'));
  await page.locator('[data-close-free-slots]').click();
  await page.locator('#open').click();
  await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
  assert.ok((await text()).includes('10:00–20:00 · 10 часов'),'In-memory fallback survives reopening with storage denied');
  await page.addStyleTag({content:readFileSync(new URL('../styles.css',import.meta.url),'utf8')});
  await page.addStyleTag({content:readFileSync(new URL('../free-slots-compact.css',import.meta.url),'utf8')});
  await page.evaluate(()=>{document.body.className='provider-body';document.body.dataset.providerTheme='pink-porcelain';for(const [key,value] of Object.entries({'--theme-surface':'#fff','--theme-surface-alt':'#fff5f9','--theme-line':'#eed3e0','--theme-ink':'#34343b','--theme-muted':'#77717a','--theme-accent':'#b9286c'})) document.body.style.setProperty(key,value);});
  for(const width of [320,390,760,1440]) {
    await page.setViewportSize({width,height:844});
    const layout=await page.locator('#freeSlotsDialog').evaluate(el=>({width:el.getBoundingClientRect().width,scroll:el.scrollWidth,client:el.clientWidth,columns:getComputedStyle(el.querySelector('.free-slots-main')).gridTemplateColumns.split(' ').length}));
    assert.ok(layout.width<=width && layout.scroll<=layout.client+1,`${width}px publication dialog must not overflow horizontally`);
    assert.equal(layout.columns,width<=700?1:2,`${width}px uses the intended responsive layout`);
    assert.equal(await page.locator('#copyFreeSlots').evaluate(el=>getComputedStyle(el).textAlign),'center');
    assert.equal(await page.locator('#copyFreeSlotsLink').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;}),1,`${width}px copy-link label stays on one line`);
    if(process.env.MINUTA_VISUAL_PREFIX) await page.screenshot({path:`${process.env.MINUTA_VISUAL_PREFIX}-${width}.png`});
    if(width===390) {await page.locator('#freeSlotsDialog').evaluate(el=>{el.scrollTop=el.scrollHeight;});assert.equal(await page.locator('#shareFreeSlots').isVisible(),true);if(process.env.MINUTA_VISUAL_PREFIX) await page.screenshot({path:`${process.env.MINUTA_VISUAL_PREFIX}-${width}-actions.png`});}
  }
  // Match the reported 25 Sep–1 Oct range and verify the actual copy/share payloads.
  await page.evaluate(()=>{
    window.generalWindows=[
      {booking_date:'2026-09-25',start_time:'10:00',end_time:'20:00',duration_minutes:600},
      {booking_date:'2026-09-26',start_time:'12:00',end_time:'20:00',duration_minutes:480}
    ];
  });
  if(!await page.locator('details.free-slots-extra').first().evaluate(el=>el.open)) await page.locator('details.free-slots-extra summary').first().click();
  await page.locator('[name="freeSlotsTextLayout"][value="detailed"]').check();
  await page.locator('[name="freeSlotsPeriod"][value="range"]').evaluate(input=>{
    input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('#freeSlotsFrom').fill('2026-09-25');
  await page.locator('#freeSlotsTo').fill('2026-10-01');
  for(const format of ['intervals','hourly']) {
    await page.locator(`[name="freeSlotsTimeFormat"][value="${format}"]`).evaluate(input=>{
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
    });
    await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled && document.querySelector('#freeSlotsText').value.includes('26 сентября'));
    const preview=await text();
    assert.ok(preview.includes(format==='intervals'?'10:00–20:00 · 10 часов':'10:00, 11:00'));
    assert.doesNotMatch(preview,/Максимальный непрерывный интервал|макс\./i);
    const copied=await page.evaluate(()=>window.copied.length);
    for(let attempt=0;attempt<3 && await page.evaluate(length=>window.copied.length===length,copied);attempt++) {
      await page.locator('#copyFreeSlots').click();
      await page.waitForFunction(()=>!document.querySelector('#copyFreeSlots').disabled);
    }
    assert.equal(await page.evaluate(()=>window.copied.length),copied+1);
    assert.equal(await page.evaluate(()=>window.copied.at(-1)),await text());
    assert.doesNotMatch(await page.evaluate(()=>window.copied.at(-1)),/Максимальный непрерывный интервал|макс\./i);
    const shared=await page.evaluate(()=>window.shared.length);
    for(let attempt=0;attempt<3 && await page.evaluate(length=>window.shared.length===length,shared);attempt++) {
      await page.locator('#shareFreeSlots').click();
      await page.waitForFunction(()=>!document.querySelector('#shareFreeSlots').disabled);
    }
    assert.equal(await page.evaluate(()=>window.shared.length),shared+1);
    assert.doesNotMatch(await page.evaluate(()=>window.shared.at(-1)),/Максимальный непрерывный интервал|макс\./i);
  }
  await page.evaluate(()=>{window.generalWindows=[];window.controller.refresh();});
  await page.waitForFunction(()=>!document.querySelector('#freeSlotsEmpty').hidden);
  assert.equal(await page.locator('#shareFreeSlots').isDisabled(),true);
  assert.equal(await page.locator('#copyFreeSlotsLink').isDisabled(),false);
  for(const width of [390,1440]) {await page.setViewportSize({width,height:844});if(process.env.MINUTA_VISUAL_PREFIX) await page.screenshot({path:`${process.env.MINUTA_VISUAL_PREFIX}-empty-${width}.png`});}
  assert.deepEqual(errors,[]);
  console.log('PASS: both modes, 25 Sep–1 Oct copy/share without repeated maximum, catalog link, server gaps, manual/auto, clock rollover, fresh pre-send, fail-closed');
} finally {await browser.close();}
