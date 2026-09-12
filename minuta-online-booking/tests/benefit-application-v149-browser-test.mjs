import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=readFileSync(resolve(root,'benefit-management.js'),'utf8');
const baseline=execFileSync('git',['show','HEAD:minuta-online-booking/benefit-management.js'],{cwd:root,encoding:'utf8'});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const url='https://benefit-application.test/minuta-online-booking/provider.html';
const errors=[],unexpected=[];
const mime={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.html':'text/html'};

async function fixture(width,code=source){
  const page=await browser.newPage({bypassCSP:true,serviceWorkers:'block',viewport:{width,height:960}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const request=new URL(route.request().url());
    if(request.origin!=='https://benefit-application.test'||route.request().method()!=='GET'){unexpected.push(request.href);return route.abort();}
    if(request.pathname.endsWith('/provider.html'))return route.fulfill({contentType:'text/html',body:html});
    const relative=decodeURIComponent(request.pathname.replace('/minuta-online-booking/',''));
    if(relative.includes('..'))return route.abort();
    try{return route.fulfill({contentType:mime[extname(relative)]||'application/octet-stream',body:readFileSync(resolve(root,relative))});}catch{return route.abort();}
  });
  await page.goto(url,{waitUntil:'networkidle'});
  await page.evaluate(()=>{
    document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');document.querySelector('#providerBoot')?.remove();
    document.body.dataset.providerTheme='default';document.body.dataset.providerLayout='split';
    document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
    document.querySelector('#dashboard').dataset.activeView='organization';
    document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='organization';panel.classList.toggle('active',!panel.hidden);});
    document.querySelector('#organizationWorkspace').hidden=false;document.querySelector('#organizationLoading').hidden=true;
    document.querySelector('#organizationOverviewSection').hidden=true;document.querySelector('#organizationPeopleSection').hidden=true;
    document.querySelector('#organizationSectionSelect').value='benefitsPanel';
    document.querySelectorAll('#organizationSectionNav button').forEach(button=>button.classList.toggle('active',button.dataset.sectionTarget==='benefitsPanel'));
    document.querySelectorAll('[data-provider-panel="organization"] .organization-section').forEach(panel=>panel.hidden=panel.id!=='benefitsPanel');
  });
  await page.addScriptTag({content:code});
  await page.evaluate(async()=>{
    const payload=window.applicationPayload={organization_id:'org-a',current_role:'owner',enabled:true,
      services:[{id:'service-a',name:'Массаж спины'},{id:'service-b',name:'Массаж лица'}],
      clients:[{id:'client-a',client_name:'Тестовый клиент',client_phone:'+7 (000) 000-00-00'}],
      products:[],audit:[],redemptions:[],
      bookings:[
        {id:'booking-a',client_account_id:'client-a',client_name:'Тестовый клиент',service_id:'service-a',service_name:'Массаж спины',booking_date:'2026-09-20',status:'confirmed'},
        {id:'booking-b',client_account_id:'client-a',client_name:'Тестовый клиент',service_id:'service-b',service_name:'Массаж лица',booking_date:'2026-09-21',status:'confirmed'}
      ],
      instruments:[
        {id:'pass-a',product_id:'product-pass',client_account_id:'client-a',public_code:'MIN-PASS',status:'active',expires_on:'2026-12-01',remaining_visits:3,remaining_amount_rub:0,product_snapshot:{name:'Абонемент',kind:'visit_pass',services:[{service_id:'service-a'}]},service_balances:[]},
        {id:'package-a',product_id:'product-package',client_account_id:'client-a',public_code:'MIN-PACK',status:'active',expires_on:'2026-12-01',remaining_visits:2,remaining_amount_rub:0,product_snapshot:{name:'Пакет',kind:'package'},service_balances:[{service_id:'service-a',remaining_units:2}]},
        {id:'certificate-a',product_id:'product-certificate',client_account_id:'client-a',public_code:'MIN-CERT',status:'active',expires_on:'2026-12-01',remaining_visits:0,remaining_amount_rub:5000,product_snapshot:{name:'Сертификат',kind:'certificate'},service_balances:[]}
      ]};
    const state=window.applicationState={calls:[],notices:[]};
    const db={rpc:async(name,args)=>{
      if(name==='get_minuta_benefit_workspace')return {data:structuredClone(payload),error:null};
      if(name==='apply_minuta_benefit_v149'){
        state.calls.push(structuredClone(args));
        payload.redemptions.push({id:'redemption-a',instrument_id:args.p_instrument,booking_id:args.p_booking,status:'reserved',amount_rub:args.p_amount_rub||0,units:args.p_amount_rub?0:1});
        return {data:{id:'redemption-a',organization_id:'org-a',status:'reserved',request_id:args.p_request_id,replayed:false},error:null};
      }
      throw Error(`Unexpected RPC: ${name}`);
    },from(){throw Error('Unexpected direct table read');}};
    window.benefitController=MinutaBenefits.createController({db,$:selector=>document.querySelector(selector),
      escapeHtml:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
      notify:message=>state.notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:'owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){}});
    benefitController.bind();await benefitController.setOrganization({id:'org-a',current_role:'owner'});
    document.querySelector('#benefitApplyCreator').open=true;
  });
  return page;
}

async function visual(page,label,width){
  await page.evaluate(()=>scrollTo(0,document.querySelector('#benefitsPanel').offsetTop));
  const metrics=await page.evaluate(()=>({innerWidth,scrollWidth:document.documentElement.scrollWidth,buttonHeight:document.querySelector('#benefitApplyForm button[type=submit]').getBoundingClientRect().height}));
  assert.ok(metrics.scrollWidth<=metrics.innerWidth,'benefit application must not overflow horizontally');
  if(width<=760)assert.ok(metrics.buttonHeight>=44,'mobile application action must remain touchable');
  if(process.env.MINUTA_AUDIT_SCREENSHOT_DIR)await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOT_DIR,`benefit-application-${label}-${width}.png`),fullPage:true});
}

try{
  for(const width of [390,760,1440]){
    const before=await fixture(width,baseline);await visual(before,'before',width);await before.close();
    const page=await fixture(width);await visual(page,'after',width);
    const instruments=await page.locator('#benefitApplyInstrument option').allTextContents();
    assert.ok(instruments.some(text=>text.includes('3 посещ.')));
    assert.ok(instruments.some(text=>text.includes('5 000 ₽')||text.includes('5 000 ₽')));
    await page.locator('#benefitApplyInstrument').selectOption('pass-a');
    assert.deepEqual(await page.locator('#benefitApplyBooking option').allTextContents(),['20.09.2026 · Тестовый клиент · Массаж спины']);
    await page.locator('#benefitApplyInstrument').selectOption('package-a');
    assert.deepEqual(await page.locator('#benefitApplyBooking option').allTextContents(),['20.09.2026 · Тестовый клиент · Массаж спины']);
    await page.locator('#benefitApplyInstrument').selectOption('certificate-a');
    assert.equal(await page.locator('#benefitApplyBooking option').count(),2);
    await page.locator('#benefitApplyBooking').selectOption('booking-b');
    await page.locator('#benefitApplyAmount').fill('1000');
    await page.locator('#benefitApplyForm button[type=submit]').click();
    await page.waitForFunction(()=>applicationState.calls.length===1);
    const call=await page.evaluate(()=>applicationState.calls[0]);
    assert.equal(call.p_action,'reserve');assert.equal(call.p_amount_rub,1000);assert.match(call.p_request_id,/^[0-9a-f-]{36}$/i);
    assert.ok(await page.locator('#benefitRedemptionsList').getByText('Зарезервировано').isVisible());
    await visual(page,'reserved',width);
    console.log(`PASS native ${width}px: eligible visit pass/package/certificate choices, idempotency key, reservation render and no overflow`);
    await page.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
}finally{await browser.close();}
