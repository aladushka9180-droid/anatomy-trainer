import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const take=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const dialog=html.slice(html.indexOf('<dialog class="waitlist-dialog"'),html.indexOf('</dialog>',html.indexOf('<dialog class="waitlist-dialog"'))+9);
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const ids=['dates','moreDates','durationNote','timePeriods','timeHours','minutePicker','times','noTimes'];
  const cta=html.split(/\r?\n/).find(line=>line.includes('id="waitlistCta"'));
  assert.ok(cta.includes('Встать в лист ожидания'));
  await page.route('https://example.test/**',route=>route.fulfill({contentType:'text/html',body:ids.map(id=>`<div id="${id}"></div>`).join('')+cta+'<button id="continueBooking"></button>'+dialog}));
  await page.goto('https://example.test/');
  await page.addStyleTag({content:readFileSync(new URL('../styles.css',import.meta.url),'utf8')});
  await page.addScriptTag({content:`
    const $=selector=>document.querySelector(selector);
    let waitlistContext=null,waitlistSubmissionPending=false;
    const dates=[{iso:'2026-09-06',label:'6 сентября',weekday:'вс',day:'6'}];
    const state=window.state={date:'2026-09-06',serviceId:'service-a',locationId:'location-a',teamMode:true,
      organization:{public_slug:'org-a'},locations:[{id:'location-a',name:'Центр'}],
      availability:new Map([['2026-09-06',['14:00']]]),loadingAvailability:false,availabilityError:false};
    const service={id:'service-a',name:'Массаж',duration_minutes:90,performer_profiles:{display_name:'Мастер А'}};
    const selectedService=()=>service,selectedDate=()=>dates[0],serviceName=name=>name,escapeHtml=value=>value;
    const timeRange=time=>time+'–15:30',durationLabel=()=> '90 мин',renderAvailabilitySuggestion=()=>false;
    window.rpcCalls=[];
    const db={rpc:async(name,args)=>{window.rpcCalls.push({name,args});if(window.hold)await new Promise(resolve=>window.release=resolve);
      if(window.fail==='throw')throw Error('Offline');return window.fail ? {error:{code:window.fail}} : {data:[{request_code:'WAIT-TEST',manage_token:'12345678-1234-1234-1234-123456789012'}]};}};
    ${take('function renderDates()', 'function renderAvailabilitySuggestion(')}
    ${take('function openWaitlistDialog()', 'async function showStep(')}
    window.openForm=openWaitlistDialog;window.render=()=>{renderDates();renderTimes();};window.submit=()=>submitWaitlist({preventDefault(){}});
    $('#waitlistForm').addEventListener('submit',submitWaitlist);
    $('[data-close-waitlist]').addEventListener('click',()=>$('#waitlistDialog').close());
  `});
  await page.evaluate(()=>window.render());
  assert.equal(await page.locator('#waitlistCta').evaluate(el=>el.hidden),false,'Available slots must not hide CTA');
  await page.locator('#openWaitlist').waitFor({state:'visible'});
  await page.evaluate(()=>{state.availability.set(state.date,[]);window.render();});
  assert.equal(await page.locator('#waitlistCta').evaluate(el=>el.hidden),false,'Sold-out day remains eligible');
  assert.equal(await page.locator('[data-date]').isDisabled(),false,'No-slots dates can be selected for waiting');
  await page.evaluate(()=>{state.loadingAvailability=true;window.render();});
  assert.equal(await page.locator('#waitlistCta').evaluate(el=>el.hidden),true);
  await page.evaluate(()=>{state.loadingAvailability=false;state.availabilityError=true;window.render();});
  assert.equal(await page.locator('#waitlistCta').evaluate(el=>el.hidden),true);
  await page.evaluate(()=>{state.availabilityError=false;window.openForm();});
  assert.ok((await page.locator('#waitlistService').textContent()).includes('Мастер А · Центр'));
  const closeBox=await page.locator('[data-close-waitlist]').boundingBox();
  assert.ok(closeBox.width>=44 && closeBox.height>=44,'Mobile dialog close target must be at least 44px');
  const fill=async()=>{
    await page.locator('#waitlistName').fill('Тест Клиент');await page.locator('#waitlistPhone').fill('79999999999');
    await page.locator('#waitlistConsent').check();await page.locator('#waitlistPeriod').selectOption('evening');
  };
  await fill();
  await page.evaluate(()=>window.submit());
  const first=(await page.evaluate(()=>rpcCalls))[0];
  assert.equal(first.name,'join_minuta_waitlist_v111');
  assert.deepEqual(first.args,{p_service:'service-a',p_date:'2026-09-06',p_time_period:'evening',p_client_name:'Тест Клиент',p_client_phone:'79999999999',p_slug:'org-a',p_location:'location-a'});
  assert.ok((await page.locator('#waitlistManageLink').getAttribute('href')).includes('?scope=organization#token='));
  await page.locator('[data-close-waitlist]').click();
  await page.evaluate(()=>{window.openForm();window.fail='PGRST202';});await fill();
  await page.evaluate(()=>window.submit());
  assert.ok((await page.locator('#waitlistError').textContent()).includes('пока не подключён'));
  assert.equal(await page.locator('#submitWaitlist').isDisabled(),false);
  assert.equal((await page.evaluate(()=>rpcCalls)).length,2,'No unsafe legacy fallback for organizations');
  await page.evaluate(()=>{window.fail='throw';});await page.evaluate(()=>window.submit());
  assert.equal(await page.locator('#submitWaitlist').isDisabled(),false,'Network failure restores submit');
  await page.evaluate(()=>{window.fail='';window.hold=true;void window.submit();void window.submit();});
  assert.equal((await page.evaluate(()=>rpcCalls)).length,4,'Double submit is suppressed');
  await page.evaluate(()=>{window.hold=false;window.release();});
  await page.waitForFunction(()=>!document.querySelector('#submitWaitlist').disabled);
  await page.locator('[data-close-waitlist]').click();
  await page.evaluate(()=>{window.openForm();state.locationId='location-b';});await fill();await page.evaluate(()=>window.submit());
  assert.equal((await page.evaluate(()=>rpcCalls)).length,4,'Stale branch context cannot be sent');
  await page.locator('[data-close-waitlist]').click();
  await page.evaluate(()=>{state.teamMode=false;state.organization=null;state.locationId='';window.openForm();});
  await fill();await page.evaluate(()=>window.submit());
  assert.equal((await page.evaluate(()=>rpcCalls)).at(-1).name,'join_booking_waitlist');
  assert.ok(!(await page.locator('#waitlistManageLink').getAttribute('href')).includes('scope=organization'));
  assert.deepEqual(errors,[]);
  console.log('PASS: CTA visibility, selectable unavailable dates, scoped submission, context guard, duplicate prevention, network/missing RPC and legacy compatibility');
} finally {await browser.close();}
