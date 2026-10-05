import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { serveNativeCaptureFixture, appRoot, date as fixtureDate } from './native-capture-fixture.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.MINUTA_PLAYWRIGHT_PACKAGE||'playwright');
const sharp=require('sharp');
const output=resolve(process.env.NATIVE_CAPTURE_OUTPUT||resolve(appRoot,'help/images/native-local'));
const rawOutput=resolve(appRoot,'../outputs/native-provider-capture/raw');
mkdirSync(output,{recursive:true});
mkdirSync(rawOutput,{recursive:true});
const fixture=await serveNativeCaptureFixture();
console.log('Local fixture started');
const plan=JSON.parse(readFileSync(resolve(appRoot,'help/tools/native-article-shot-map.json'),'utf8').replace(/^\uFEFF/,''));
const browser=await chromium.launch({headless:true,...(process.env.MINUTA_BROWSER_EXECUTABLE?{executablePath:process.env.MINUTA_BROWSER_EXECUTABLE}:{})});
console.log('Local browser started');
const manifest={kind:'local-native-ui-test-fixture',liveVerified:false,domModified:false,rendererModified:false,productionRequests:0,theme:'pink-porcelain',fixtureDate,capturedAt:new Date().toISOString(),sources:{},captures:[],failures:[],unsupportedFixtureReads:[]};
if(process.env.NATIVE_CAPTURE_MERGE==='1'&&existsSync(resolve(output,'native-capture-manifest.json'))){const previous=JSON.parse(readFileSync(resolve(output,'native-capture-manifest.json'),'utf8'));assert.equal(previous.fixtureDate||previous.date,fixtureDate,'Merged captures share the same fixture date');for(const [file,hash]of Object.entries(previous.sources||{}))assert.equal(createHash('sha256').update(readFileSync(resolve(appRoot,file))).digest('hex'),hash,'Cannot merge captures from a different original source: '+file);manifest.captures=previous.captures;manifest.sources=previous.sources;manifest.capturePasses=previous.capturePasses||[];}
for(const file of ['provider.html','provider.js','vendor/supabase-2.112.4.min.js'])manifest.sources[file]=createHash('sha256').update(readFileSync(resolve(appRoot,file))).digest('hex');
try {
 for(const width of process.env.NATIVE_CAPTURE_PROBE?[1440]:process.env.NATIVE_CAPTURE_WIDTHS?.split(',').map(Number)||[390,760,1440]) {
  const context=await browser.newContext({viewport:{width,height:1000},timezoneId:'Europe/Samara',serviceWorkers:'block'});
  const blocked=[],errors=[],consoleErrors=[];
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():(blocked.push(new URL(route.request().url()).origin),route.abort()));
  await context.routeWebSocket('**/*',socket=>new URL(socket.url()).host===new URL(fixture.origin).host?socket.connectToServer():(blocked.push(socket.url()),socket.close()));
  const page=await context.newPage();page.on('pageerror',error=>{errors.push(error.message);console.log('Native page error: '+error.message);});
  page.on('console',message=>{if(['warning','error'].includes(message.type()))consoleErrors.push(message.text());});
  page.setDefaultTimeout(5000);

  await page.goto(fixture.origin+'/minuta-online-booking/provider.html');
  console.log('Native login loaded');
  await page.locator('#loginEmail').fill(fixture.credentials.email);
  await page.locator('#loginPassword').fill(fixture.credentials.password);
  await page.locator('#loginForm button[type=submit]').click();
  await page.locator('#dashboard').waitFor({state:'visible',timeout:20000});
  console.log('Native dashboard loaded');
  await page.waitForFunction(()=>document.querySelector('#serviceManageList .managed-service'));
  console.log('Native services loaded');
  await page.waitForFunction(()=>!synchronizationPromise,{},{timeout:15000});
  console.log(JSON.stringify(await page.evaluate(()=>({writesAllowed,providerSessionTrust,bookingCreationReady}))));
  if(process.env.NATIVE_CAPTURE_PROBE) {
   await page.screenshot({path:resolve(rawOutput,'probe-1440.png'),fullPage:true});
   console.log(JSON.stringify({errors,blocked,unsupported:fixture.unsupported,mutations:fixture.mutations,requests:fixture.requests.filter(x=>x.path.startsWith('/rest/')),text:(await page.locator('#dashboard').innerText()).slice(0,1500)}));
   await context.close();continue;
  }
  assert.equal(await page.locator('body').getAttribute('data-provider-theme'),'pink-porcelain');
  assert.equal(await page.locator('input[name=providerTheme][value=pink-porcelain]').isChecked(),true,'Native persisted theme matches its standard UI choice');
  async function navigate(view) {
   await page.keyboard.press('Escape');
   const close=page.locator('.booking-sheet-panel [data-close-booking-sheet]:visible');if(await close.count())await close.click();
   await page.goto(fixture.origin+'/minuta-online-booking/provider.html?view='+view);
   await page.locator('#dashboard').waitFor({state:'visible'});
   await page.locator('[data-provider-panel="'+view+'"]:visible').waitFor();
   await page.waitForFunction(()=>document.querySelector('#serviceManageList .managed-service'));
   await page.waitForFunction(()=>!synchronizationPromise,{},{timeout:15000});
   await page.waitForTimeout(450);
   if(view==='bookings'){const personal=page.locator('[data-calendar-mode=personal]');if(await personal.getAttribute('aria-pressed')!=='true')await personal.click();await page.locator('#scheduleDatePicker').fill(fixtureDate);await page.waitForTimeout(300);}
  }
  async function newBooking(){const launcher=page.locator('#newBookingButton:visible, #mobileNewBookingButton:visible').first();if(await launcher.count())await launcher.click();else {const stage=page.locator('[data-create-booking-at]:visible');await stage.focus();await stage.press('Enter');}await page.locator('#newBookingForm').waitFor({state:'visible'});}
  async function journal(mode){let button=page.locator('[data-journal-mode="'+mode+'"]:visible').first();if(!await button.count()){await page.locator('#scheduleViewMenu > summary').click();button=page.locator('#scheduleViewMenu [data-journal-mode="'+mode+'"]');}await button.click();if(await page.locator('#scheduleViewMenu').getAttribute('open')!==null)await page.locator('#scheduleViewMenu > summary').click();}
  async function shot(id,selector,articleSlugs,actions,screenKey=id) {
   const target=page.locator(selector);
   await target.waitFor({state:'visible'});
   await page.waitForTimeout(50);await page.waitForTimeout(100);
   const horizontalOverflow=await target.evaluate(el=>el.scrollWidth>el.clientWidth+1);
   const rawFile=id+'-'+width+'.png',file=id+'-'+width+'.webp';
   await target.scrollIntoViewIfNeeded();
   if(id==='team-calendar'){await page.locator('#dateStrip [data-booking-date="'+fixtureDate+'"]').scrollIntoViewIfNeeded();await page.waitForTimeout(300);assert.equal(await page.locator('#dateStrip [data-booking-date="'+fixtureDate+'"]').evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right;}),true,'Selected calendar date must be visible');}
   let box=await target.boundingBox();
   if(id==='booking-card-settings'){await target.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));box=await target.boundingBox();box={x:Math.max(0,box.x),y:Math.max(0,box.y),width:box.width,height:Math.min(900,box.height)};await page.screenshot({path:resolve(rawOutput,rawFile),clip:box});}
   else if(id==='schedule-week'){const step=page.locator('.booking-step-setting');await step.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));const a=await step.boundingBox(),b=await page.locator('[data-schedule-day="2"]').boundingBox();box={x:Math.max(0,box.x),y:Math.max(0,a.y),width:box.width,height:Math.min(900,b.y+b.height+12-Math.max(0,a.y))};await page.screenshot({path:resolve(rawOutput,rawFile),clip:box});}
   else if(id==='booking-detail-actions'){await page.locator('.booking-delete-zone').scrollIntoViewIfNeeded();const a=await page.locator('#bookingSheet [data-booking-status=confirmed]').boundingBox(),b=await page.locator('.booking-delete-zone').boundingBox();box={x:Math.max(0,box.x),y:Math.max(0,a.y-16),width:box.width,height:b.y+b.height+8-Math.max(0,a.y-16)};await page.screenshot({path:resolve(rawOutput,rawFile),clip:box});}
   else if(id==='team-calendar'||id==='statistics-overview-filter'||(width<=760&&box.height>900)){if(id==='team-calendar')await page.locator('#teamCalendarFilters').scrollIntoViewIfNeeded();else await target.evaluate(el=>el.scrollIntoView({block:'start',behavior:'instant'}));box=await target.boundingBox();const navTarget=page.locator('.provider-mobile-nav:visible');const nav=await navTarget.count()?await navTarget.boundingBox():null;const bottom=nav?.y||950;const clip={x:Math.max(0,box.x),y:Math.max(0,box.y),width:box.width,height:Math.min(900,box.height,bottom-Math.max(0,box.y)-8)};await page.screenshot({path:resolve(rawOutput,rawFile),clip});box=clip;}
   else if(await target.evaluate(el=>el.tagName==='DIALOG')&&await target.locator('form').count()){const formBox=await target.locator('form').last().boundingBox();if(formBox&&formBox.y+formBox.height+24<box.y+box.height){box={x:Math.max(0,box.x),y:Math.max(0,box.y),width:box.width,height:Math.min(box.height,formBox.y+formBox.height+24-box.y)};await page.screenshot({path:resolve(rawOutput,rawFile),clip:box});}else await target.screenshot({path:resolve(rawOutput,rawFile)});}
   else await target.screenshot({path:resolve(rawOutput,rawFile)});
   const png=readFileSync(resolve(rawOutput,rawFile));await sharp(png).webp({lossless:true}).toFile(resolve(output,file));
   assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(),await sharp(resolve(output,file)).ensureAlpha().raw().toBuffer(),'Lossless raster preservation');
   const metadata=await sharp(resolve(output,file)).metadata();box={...box,width:metadata.width,height:metadata.height};
   const planned=plan.screens.find(s=>s.screenKey===screenKey);
   let articleSteps=planned?Object.fromEntries(Object.entries(planned.articleSteps).filter(([slug])=>articleSlugs.includes(slug))):Object.fromEntries(articleSlugs.map(slug=>[slug,[]]));
   const overviewKeys=['service-create-form','booking-recurring-form','free-slots-dialog','schedule-date-exception','client-batch-form','client-import-preview','payment-settings','benefit-product-form','telegram-settings','booking-policy-settings','appearance-settings','mobile-navigation-settings','statistics-overview-filter','statistics-money'];
   if(overviewKeys.includes(screenKey))articleSteps=Object.fromEntries(articleSlugs.map(slug=>[slug,[]]));
   if(id==='inventory-catalog')articleSteps={'inventory-setup':[3]};
   if(id==='appearance-settings')articleSteps={'cabinet-layout-theme':[]};
   if(id==='booking-card-settings')articleSteps={'booking-card-appearance':[2]};
   if(id==='booking-text-scale')articleSteps={'booking-card-appearance':[1]};
   articleSlugs=Object.keys(articleSteps);
   manifest.captures=manifest.captures.filter(capture=>capture.id!==id||capture.viewportWidth!==width);
   manifest.captures.push({id,screenKey,src:'images/native-local/'+file,viewportWidth:width,width:Math.round(box.width),height:Math.round(box.height),file,articleSlugs,articleSteps,coverageExact:true,actions,horizontalOverflow,kind:'screenshot',environment:'isolated-local-native-fixture',caption:'Настоящий интерфейс Eldion Pro на изолированном локальном стенде с учебными данными. Тема «Розовый фарфор». Проверка живого сайта не выполнялась.',domModified:false,rendererModified:false,liveVerified:false,productionRequests:0,dimensions:{width:Math.round(box.width),height:Math.round(box.height)},sha256:createHash('sha256').update(readFileSync(resolve(output,file))).digest('hex')});
   console.log(JSON.stringify({captured:id,width,articles:Object.keys(articleSteps)}));
  }
  await page.locator('#scheduleDatePicker').fill(fixtureDate);
  await page.locator('[data-calendar-mode=team]').click();
  await page.locator('#teamCalendarFilters').waitFor({state:'visible'});
  await page.waitForTimeout(350);
  await page.locator('#dateStrip [data-booking-date="'+fixtureDate+'"]').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#dateStrip [data-booking-date="'+fixtureDate+'"]').getAttribute('aria-pressed'),'true');
  await shot('team-calendar','.schedule-card',['view-team-calendar'],['Войти в локальный учебный аккаунт','Выбрать учебную дату '+fixtureDate+' через штатный календарь','Нажать «Расписание команды»']);
  await navigate('schedule');
  await shot('work-hours','#scheduleWeekEditor',['set-regular-workweek'],['Открыть «Рабочие часы»','Открыть редактор обычной недели'],'schedule-week');
  await navigate('services');
  await page.locator('[data-open-service-creator]').click();
  await page.locator('[data-start-custom-service]').click();
  await shot('services','#serviceForm',['add-service'],['Открыть «Услуги»','Открыть добавление услуги без сохранения'],'service-create-form');
  await navigate('bookings');
  console.log(JSON.stringify({width,view:await page.locator('#dashboard').getAttribute('data-active-view'),manualLaunchers:await page.locator('#newBookingButton, #mobileNewBookingButton').evaluateAll(nodes=>nodes.map(n=>({id:n.id,hidden:n.hidden,display:getComputedStyle(n).display,rect:n.getBoundingClientRect().toJSON()})))}));
  await newBooking();
  await page.locator('#newBookingForm').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('#newBookingForm')?.innerText.includes('Не удалось проверить'));
  await page.locator('#newBookingName').fill('Новый учебный клиент');
  await page.locator('#newBookingPhone').fill('70000000004');
  await page.locator('[data-new-booking-time="16:00"]').first().click();
  await shot('manual-booking','.booking-sheet-panel',['create-manual-booking'],['Открыть «Записи»','Нажать «Новая запись»','Заполнить вымышленного нового клиента и выбрать время без сохранения'],'booking-new-client');
  await navigate('clients');
  await page.locator('.client-list-item[data-client-phone="70000000001"]').click();
  await page.locator('#clientQuickRepeat').click();
  if(await page.locator('#newBookingDate').inputValue()!==fixtureDate){await page.locator('#newBookingDateTimeEditor summary').click();await page.locator('#newBookingDate').fill(fixtureDate);}
  await page.locator('[data-new-booking-time="16:00"]').first().click();
  await shot('repeat-booking','.booking-sheet-panel',['repeat-client-booking'],['Выбрать существующего учебного клиента через штатные подсказки без сохранения'],'booking-new-client');
  if(process.env.NATIVE_CAPTURE_EXTENDED==='1') {
   async function details(selector) {const el=page.locator(selector);if(!(await el.isVisible())&&selector.startsWith('#')){const opener=page.locator('[data-people-open="'+selector.slice(1)+'"]:visible');if(await opener.count())await opener.click();}await el.waitFor({state:'visible'});if(!(await el.getAttribute('open')!==null))await el.locator('summary').first().click();}
   async function section(id) {
    await navigate('organization');
    const select=page.locator('#organizationSectionSelect');
    if(await select.isVisible())await select.selectOption(id);
    else {
     const groups={organizationOverviewSection:'overview',organizationPeopleSection:'team',resourcesPanel:'team',shiftsPanel:'team',inventoryPanel:'team',payrollPanel:'finance',paymentProviderPanel:'finance',commercePanel:'sales',benefitsPanel:'sales',loyaltyPanel:'sales',retentionPanel:'sales'};
     await page.locator('[data-organization-group="'+groups[id]+'"]:visible').click();
     await page.locator('#organizationSectionNav [data-section-target="'+id+'"]:visible').click();
    }
    await page.locator('#'+id).waitFor({state:'visible'});
    await page.waitForTimeout(350);await page.waitForTimeout(300);
   }
   async function capture(key,target,setup) {
    if(process.env.NATIVE_CAPTURE_KEYS&&!process.env.NATIVE_CAPTURE_KEYS.split(',').includes(key))return;
    try {await setup();const planned=plan.screens.find(s=>s.screenKey===key);await shot(key,target,Object.keys(planned?.articleSteps||{}),[planned?.nativeAction||key],key);}
    catch(error){manifest.failures.push({screenKey:key,viewportWidth:width,reason:error.message,runtime:await page.evaluate(()=>({writesAllowed,providerSessionTrust,bookingCreationReady})),visibleText:(await page.locator('[data-provider-panel]:visible').innerText()).slice(-3000)});console.log(JSON.stringify({unavailable:key,width,reason:error.message}));}
   }
   await capture('booking-block-form','.booking-sheet-panel',async()=>{await page.locator('[data-new-booking-mode=block]').click();});
   await capture('booking-recurring-form','.booking-sheet-panel',async()=>{await navigate('bookings');await newBooking();await details('#newBookingAdvanced');await page.locator('#newBookingOccurrences').selectOption('3');});
   await page.locator('.booking-sheet-panel [data-close-booking-sheet]').click();
   await capture('booking-detail-actions','#bookingSheetContent',async()=>{await navigate('bookings');await page.locator('[data-open-booking="88888888-8888-4888-8888-888888888888"]').first().click();await page.locator('.booking-delete-zone').scrollIntoViewIfNeeded();});
   await capture('booking-reschedule-series','.booking-sheet-panel',async()=>{await navigate('bookings');await page.locator('[data-open-booking="88888888-8888-4888-8888-888888888888"]').first().click();await page.locator('[data-edit-booking="88888888-8888-4888-8888-888888888888"]').click();});
   await capture('booking-outcome-form','#bookingOutcomeForm',async()=>{await navigate('bookings');await journal('list');await page.locator('#providerBookings [data-open-booking="77777777-7777-4777-8777-777777777777"]:visible').first().click();const summary=page.locator('#bookingSheet .booking-outcome-disclosure > summary');await summary.focus();await summary.press('Enter');await page.locator('#bookingOutcomeForm').waitFor({state:'visible'});await page.locator('#outcomeVisitStatus').selectOption('completed');await page.locator('#outcomePaymentMethod').selectOption('cash');await page.locator('#outcomeAmount').fill('2500');});
   await capture('booking-list-filters','.schedule-card',async()=>{await page.goto(fixture.origin+'/minuta-online-booking/provider.html?view=bookings&records=all&date='+fixtureDate);await page.locator('#dashboard').waitFor({state:'visible'});await page.waitForFunction(()=>bookingCreationReady&&!synchronizationPromise);await journal('list');await page.locator('#bookingStatusFilter').selectOption('new');});
   await capture('free-slots-dialog','#freeSlotsDialog',async()=>{await navigate('bookings');await details('#providerTopbarTools');await page.locator('#openFreeSlots').click();});
   await capture('schedule-date-exception','#monthlyScheduleEditor',async()=>{await navigate('schedule');await details('#monthlyScheduleEditor');await page.locator('[data-monthly-schedule-date="'+fixtureDate+'"]').click();});
   await capture('schedule-week','#scheduleWeekEditor',async()=>{await navigate('schedule');await details('#weeklyScheduleDetails');});
   await capture('client-card-summary','#clientPreferencesDisclosure',async()=>{await navigate('clients');await page.locator('.client-list-item[data-client-phone="70000000001"]').click();await page.locator('#clientProfileTabNotes').click();await details('#clientPreferencesDisclosure');});
   await capture('client-batch-form','#batchBookingComposer',async()=>{await navigate('clients');await page.locator('.client-list-item[data-client-phone="70000000001"]').click();await details('#batchBookingComposer');});
   await capture('client-import-preview','#clientImportPanel',async()=>{await navigate('clients');await details('#clientDirectoryTools');await details('#clientImportPanel');await page.locator('#clientImportFile').setInputFiles({name:'native-fixture.csv',mimeType:'text/csv',buffer:Buffer.from('Имя клиента;Телефон\nУчебный клиент импорта;70000000005\n')});await page.waitForTimeout(400);if(await page.locator('#clientImportMapping').isVisible()){await page.locator('#clientImportNameColumn').selectOption('0');await page.locator('#clientImportPhoneColumn').selectOption('1');await page.locator('#clientImportApplyMapping').click();}await page.locator('#clientImportPreview').waitFor({state:'visible'});});
   await capture('organization-main','#organizationOverviewSection',async()=>{await section('organizationOverviewSection');await page.locator('[data-org-action=rename]').click();});
   await capture('branch-create-form','#locationCreator',async()=>{await section('organizationPeopleSection');await details('#locationCreator');});
   await capture('employee-invite-form','#memberCreator',async()=>{await section('organizationPeopleSection');await details('#memberCreator');});
   await capture('employee-rights-form','[data-member-card="22222222-2222-4222-8222-222222222222"]',async()=>{await section('organizationPeopleSection');await details('[data-member-card="22222222-2222-4222-8222-222222222222"]');});
   await capture('resources-workspace','#resourcesPanel',()=>section('resourcesPanel'));
   await capture('staff-shift-form','dialog:has(#shiftCreator)',async()=>{await section('shiftsPanel');await page.locator('#teamScheduleActions [data-shift-new]').click();});
   await capture('staff-absence-form','dialog:has(#absenceCreator)',async()=>{await section('shiftsPanel');await page.locator('#teamScheduleActions [data-absence-new]').click();});
   await capture('staff-substitution-form','#shiftSubstitutionPanel',async()=>{await section('shiftsPanel');await details('.ts-substitution');});
   await capture('payroll-plan-form','#payrollPlanCreator',async()=>{await section('payrollPanel');await details('#payrollRulesDisclosure');await details('#payrollPlanCreator');});
   await capture('payroll-draft-review','#payrollPeriodsList',()=>section('payrollPanel'));
   await capture('payment-settings','#paymentProviderPanel',()=>section('paymentProviderPanel'));
   await capture('payment-refund-form','#paymentRefundForm',async()=>{await section('paymentProviderPanel');});
   await capture('loyalty-program','#loyaltyProgramForm',async()=>{await section('loyaltyPanel');await page.locator('#editLoyaltyProgram').click();});
   await capture('loyalty-progress-rewards','#loyaltyAdjustmentForm',async()=>{await section('loyaltyPanel');await details('details:has(#loyaltyAdjustmentForm)');});
   await capture('benefit-product-form','#benefitProductCreator',async()=>{await section('benefitsPanel');await details('#benefitProductCreator');});
   await capture('benefit-application-form','#benefitApplyCreator',async()=>{await section('benefitsPanel');await details('#benefitApplyCreator');});
   await capture('inventory-catalog','#inventoryItemDialog',async()=>{await section('inventoryPanel');await page.locator('[data-inventory-section=catalog]').click();await details('#inventoryItemCreator');await page.locator('#inventoryItemForm').waitFor({state:'visible'});});
   await capture('inventory-movement-form','#inventoryMovementForm',async()=>{await section('inventoryPanel');await page.locator('[data-inventory-section=operations]').click();});
   await capture('inventory-usage-form','#inventoryUsageForm',async()=>{await section('inventoryPanel');await page.locator('[data-inventory-section=operations]').click();});
   await navigate('settings');
   async function settings(id){await navigate('settings');const button=page.locator('[data-provider-panel=settings] .provider-section-nav [data-section-target="'+id+'"]');if(await button.isVisible())await button.click();else{await details('.settings-section-picker');await page.locator('[data-settings-section-target="'+id+'"]').click();}await page.waitForTimeout(200);}
   for(const [key,target,group]of [['telegram-settings','#telegramClientSettingsCard','telegramClientSettingsCard'],['booking-policy-settings','#bookingRulesCard','bookingRulesCard'],['visitor-alert-settings','#visitorAlertSettingsCard','telegramClientSettingsCard'],['appearance-settings','#appearanceSettingsCard','appearanceSettingsCard'],['mobile-navigation-settings','#appNavigationSettingsCard','installAppCard'],['install-guides','#installAppCard','installAppCard'],['batch-booking-settings','#batchBookingSettingsCard','bookingRulesCard']])await capture(key,target,async()=>{await settings(group);await page.locator(target).scrollIntoViewIfNeeded();});
   if(!process.env.NATIVE_CAPTURE_KEYS||process.env.NATIVE_CAPTURE_KEYS.split(',').includes('appearance-settings')){await settings('appearanceSettingsCard');await shot('booking-text-scale','.provider-text-scale-picker',['booking-card-appearance'],['Посмотреть сохранённый размер текста без изменений'],'appearance-settings');await details('.provider-schedule-preferences');await shot('booking-card-settings','.booking-card-settings:has(input[name=bookingCardDensity])',['booking-card-appearance'],['Открыть настройки карточки без изменения сохранённых значений'],'appearance-settings');}
   await capture('account-security-settings','.account-settings-card',async()=>{await settings('accountSettingsCard');await details('.account-settings-card');});
   async function statistics(){await navigate('analytics');await page.waitForFunction(()=>document.querySelector('#analyticsView')?.dataset.reportLoadState==='ready');}
   await capture('statistics-overview-filter','[data-provider-panel=analytics]',async()=>{await statistics();await page.locator('#reportFilterToggle').click();});
   await capture('statistics-money','#financeCenterRoot',async()=>{await statistics();await page.locator('#reportTabMoney').click();});
   await capture('statistics-clients','.report-clients',async()=>{await statistics();await page.locator('#reportTabClients').click();});
   await capture('statistics-team','#reportPerformers',async()=>{await statistics();await page.locator('#reportTabTeam').click();});
   await capture('statistics-export-dialog','#reportExportDialog',async()=>{await statistics();await page.locator('#exportBookings').click();});
   await capture('statistics-goals-dialog','#reportGoalsDialog',async()=>{await statistics();await page.locator('#reportTabOverview').click();await details('#reportVisitOverview');await page.locator('#reportGoalsOpen').click();});
   await capture('notification-templates-dialog','#notificationTemplatesDialog',async()=>{await navigate('notifications');await page.locator('[data-open-notification-templates]:visible').first().click();});
   async function portfolio(){await navigate('portfolio');const button=page.locator('[data-provider-view=portfolio]:visible').first();if(await button.count())await button.click();await page.locator('[data-portfolio-card]').first().waitFor({state:'visible',timeout:15000});}
   await capture('portfolio-editor','#portfolioEditorDialog',async()=>{await portfolio();await page.locator('[data-open-portfolio-editor]').click();});
   await capture('portfolio-actions','#portfolioActionDialog',async()=>{await portfolio();await page.locator('[data-portfolio-actions]').first().click();});
   await capture('portfolio-reviews','.provider-reviews-panel',()=>navigate('portfolio'));
   await capture('group-session-create-form','#groupEventDialog',async()=>{await navigate('bookings');await page.locator('#newGroupEvent').click();});
   await capture('notification-queue-card','.notification-card:has(.notification-preview):first-of-type',async()=>{await navigate('notifications');const preview=page.locator('.notification-card .notification-preview').first();if(!(await preview.getAttribute('open')!==null))await preview.locator('summary').click();});
   await capture('assistant-dialog','#voiceAssistantDialog',async()=>{await navigate('bookings');await details('#providerTopbarTools');await page.locator('#openVoiceAssistant').click();});
  }
  const close=page.locator('.booking-sheet-panel [data-close-booking-sheet]:visible');if(await close.count())await close.click();
  assert.deepEqual(errors,[],width+': original app has no uncaught JS errors');
  assert.deepEqual(blocked,[],width+': no non-local requests attempted');
  manifest.consoleErrors=consoleErrors;
  await context.close();
 }
} finally {
 manifest.sources={...manifest.sources,...fixture.sourceHashes};
 manifest.unsupportedFixtureReads=[...new Set(fixture.unsupported)];
 manifest.mutationAttempts=fixture.mutations;
 manifest.transportRequests=fixture.requests;
 const detailed=resolve(appRoot,'../outputs/native-provider-capture/validation.json');writeFileSync(detailed,JSON.stringify(manifest,null,2)+'\n');
 const {failures,unsupportedFixtureReads,mutationAttempts,transportRequests,consoleErrors,...compact}=manifest;
 compact.configOnlyTransport=true;compact.originalSupabaseSdk=true;compact.cssModified=false;compact.fixture='Explicit fictional local rows; all writes denied by transport';
 compact.unsupportedReadCount=manifest.unsupportedFixtureReads.length;compact.deniedMutationCount=manifest.mutationAttempts.length;compact.transportFailures=fixture.requests.filter(request=>request.status>=400).length;
 compact.diagnosticScope='latest-capture-pass';
 compact.capturePasses=[...(manifest.capturePasses||[]),{capturedAt:manifest.capturedAt,unsupportedReadCount:compact.unsupportedReadCount,deniedMutationCount:compact.deniedMutationCount,transportFailures:compact.transportFailures,captureFailures:failures.length,productionRequests:0}];
 const requiredArticles=[...new Set(plan.screens.filter(s=>s.route==='provider.html').flatMap(s=>Object.keys(s.articleSteps)))];
 const completeIds=[...new Set(compact.captures.map(c=>c.id))].filter(id=>[390,760,1440].every(width=>compact.captures.some(c=>c.id===id&&c.viewportWidth===width&&c.coverageExact)));
 compact.coveredArticles=[...new Set(compact.captures.filter(c=>completeIds.includes(c.id)).flatMap(c=>Object.keys(c.articleSteps)))];compact.pendingArticles=requiredArticles.filter(slug=>!compact.coveredArticles.includes(slug));compact.completeStateCount=completeIds.length;
 writeFileSync(resolve(output,'native-capture-manifest.json'),JSON.stringify(compact,null,2)+'\n');
 await browser.close();await new Promise(resolve=>fixture.server.close(resolve));
}
