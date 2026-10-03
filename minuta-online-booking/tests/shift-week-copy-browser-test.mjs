import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtureHtml } from './team-schedule-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true});
let checks=0;
const check=(condition,label)=>{assert.ok(condition,label);checks++;};
const output=process.env.COPY_WEEK_UI_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
async function fixture(width,role='owner',theme='pink-porcelain'){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'}),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!=='https://copy-week.test'){external.push(url.href);return route.abort();}
    const path=resolve(root,'.'+decodeURIComponent(url.pathname));if(url.pathname!=='/' && !path.startsWith(root))return route.abort();
    try{return route.fulfill({body:url.pathname==='/'?fixtureHtml({role,theme}):readFileSync(path),contentType:({'/':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[url.pathname==='/'?'/':extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://copy-week.test/');await page.locator('#teamScheduleCalendar .ts-person:visible').first().waitFor();
  return {page,errors,external};
}
async function open(page){await page.locator('[data-shift-copy-open]').click();await page.getByRole('dialog').waitFor();}
async function preview(page){await page.getByRole('button',{name:'Показать предварительный просмотр',exact:true}).click();await page.locator('#shiftCopyPreview:not([hidden])').waitFor();}
async function chooseAnna(page){await page.locator('#teamSchedulePerson').selectOption('u1',{force:true});}
try{
  for(const width of [390,760,1440]){
    const {page,errors,external}=await fixture(width);
    if(width===390){
      await page.locator('#teamScheduleFilters > summary').click();
      const filterWidth=await page.locator('.ts-filter-fields').evaluate(n=>n.getBoundingClientRect().width);
      check(filterWidth>240,'expanded mobile filters retain full usable width');
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded filter bar does not overflow');
      if(output)await page.screenshot({path:resolve(output,'copy-expanded-filters-390.png')});
      await page.locator('#teamScheduleFilters > summary').click();
    }
    await chooseAnna(page);
    await open(page);check((await page.locator('#shiftCopyScope').innerText()).includes('Анна'),'selected copy scope is explicit');
    check(!await page.locator('#shiftCopyConfirm').isEnabled(),'saving requires server preview');
    await preview(page);check(await page.locator('.ts-copy-row').count()===4,'preview lists selected staff shifts and breaks');
    check(await page.locator('#shiftCopyConfirm').isEnabled(),'ready preview enables confirmation');
    const metrics=await page.evaluate(()=>({page:document.documentElement.scrollWidth,width:innerWidth,dialog:document.querySelector('dialog[open]').scrollWidth,client:document.querySelector('dialog[open]').clientWidth}));
    check(metrics.page<=metrics.width && metrics.dialog<=metrics.client+1,'page and drawer do not overflow');
    if(output)await page.screenshot({path:resolve(output,`copy-preview-${width}.png`)});
    await page.locator('#shiftCopyTarget').fill('');check(!await page.locator('#shiftCopyConfirm').isEnabled(),'editing dates invalidates preview');
    await page.getByRole('button',{name:'Закрыть форму',exact:true}).press('Escape');check(!await page.getByRole('dialog').isVisible(),'Escape closes drawer');
    check(await page.locator('[data-shift-copy-open]').evaluate(n=>n===document.activeElement),'focus returns to copy action');
    await open(page);await preview(page);await page.locator('#shiftCopyConfirm').click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const calls=JSON.parse(await page.locator('#testCalls').textContent()),saved=calls.filter(x=>x.name==='copy_minuta_staff_shift_week');
    check(saved.length===1 && /^[a-f0-9-]{36}$/.test(saved[0].parameters.p_request_id),'confirmation sends one UUID request and preview token');
    check((await page.locator('#testStatus').textContent()).includes('Добавлено смен: 4'),'success shown only after confirmed server result');
    const target=saved[0].parameters.p_target_start;check(await page.locator('#shiftStartDate').inputValue()===target,'calendar moves to saved week');
    await page.reload();await page.locator('#teamScheduleCalendar .ts-person:visible').first().waitFor();await chooseAnna(page);
    await open(page);await preview(page);check(!await page.locator('#shiftCopyConfirm').isEnabled(),'persisted exact matches cannot be duplicated');
    check((await page.locator('#shiftCopyPreview').textContent()).includes('Все смены уже есть'),'duplicates explained');
    check(errors.length===0 && external.length===0,'isolated page has no JS errors or external requests');await page.close();
  }
  // A transport exception after fixture commit must retain the exact request
  // for retry; no date edits or second preview while its outcome is unknown.
  const lost=await fixture(390);await chooseAnna(lost.page);await open(lost.page);await preview(lost.page);
  await lost.page.evaluate(()=>document.querySelector('[data-test-mode=ok]').dataset.testMode='unknown');
  await lost.page.evaluate(()=>document.querySelector('[data-test-mode=unknown]').click());
  await lost.page.locator('#shiftCopyConfirm').click();await lost.page.getByRole('button',{name:'Повторить подтверждение',exact:true}).waitFor();
  check(!await lost.page.locator('#shiftCopySource').isEnabled(),'unknown result freezes requested dates');
  await lost.page.locator('#shiftCopyConfirm').click();await lost.page.getByRole('dialog').waitFor({state:'hidden'});
  const lostCalls=JSON.parse(await lost.page.locator('#testCalls').textContent()).filter(x=>x.name==='copy_minuta_staff_shift_week');
  check(lostCalls.length===2 && lostCalls[0].parameters.p_request_id===lostCalls[1].parameters.p_request_id,'unknown response retries exact same idempotency key');
  check(lost.errors.length===0,'unknown response handled without JS error');await lost.page.close();
  const refused=await fixture(760);await chooseAnna(refused.page);await open(refused.page);await preview(refused.page);
  await refused.page.evaluate(()=>document.querySelector('[data-test-mode=error]').click());
  await refused.page.locator('#shiftCopyConfirm').click();await refused.page.locator('#shiftCopyError:not([hidden])').waitFor();
  check(!await refused.page.locator('#shiftCopyConfirm').isEnabled() && await refused.page.locator('#shiftCopySource').isEnabled(),'definite refusal clears preview and allows correction');
  check(await refused.page.getByRole('dialog').isVisible(),'refusal retains form');
  await refused.page.getByRole('button',{name:'Закрыть форму',exact:true}).click();
  await refused.page.locator('[data-test-logout]').click();
  check(await refused.page.locator('#shiftCopyScope').textContent()==='' && await refused.page.locator('#shiftCopyPreview').textContent()==='','logout clears private copy context');
  check(refused.errors.length===0,'refusal and logout handled');await refused.page.close();
  const specialist=await fixture(390,'specialist');await open(specialist.page);await preview(specialist.page);
  check((await specialist.page.locator('#shiftCopyScope').textContent()).includes('Только мои'),'specialist scope visible');
  check((await specialist.page.locator('.ts-copy-row').allTextContents()).every(x=>x.includes('Анна')),'specialist preview limited to self');
  check(specialist.errors.length===0,'specialist dialog works');if(output)await specialist.page.screenshot({path:resolve(output,'copy-preview-specialist-390.png')});await specialist.page.close();
  console.log(`Shift week copy browser: ${checks} checks PASS; 390/760/1440, scope, preview invalidation, idempotent lost response, Escape/focus; productionWrites=false`);
}finally{await browser.close();}
