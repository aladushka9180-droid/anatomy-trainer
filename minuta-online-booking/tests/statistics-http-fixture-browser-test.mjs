import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serveHttpFixture} from './statistics-http-fixture-server.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await serveHttpFixture(),origin=new URL(fixture.url).origin;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const output=process.env.MINUTA_VISUAL_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const compact=value=>value.replace(/\s/g,'');
const failures=[],checks=[],unexpected=[];
async function check(name,action){try{await action();checks.push({name,status:'pass'});}catch(error){checks.push({name,status:'fail',error:error.message});failures.push(name+': '+error.message);}finally{if(await dialog.isVisible())await dialog.locator('[data-finance-detail-close]').click();}}
const page=await browser.newPage({viewport:{width:390,height:1000},serviceWorkers:'block'});
page.on('pageerror',error=>failures.push(error.message));
await page.route('**/*',route=>{
  const request=route.request();if(new URL(request.url()).origin!==origin||request.method()!=='GET'){unexpected.push(request.url());return route.abort();}
  return route.continue();
});
const overview=page.locator('#reportFinanceOverview'),dialog=page.locator('[data-finance-detail-dialog]');
async function ready(value){await page.waitForFunction(expected=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent.replace(/\s/g,'')===expected,value);}
async function period(name){if(await page.locator('#reportFilterToggle').getAttribute('aria-expanded')!=='true')await page.locator('#reportFilterToggle').click();await page.getByRole('button',{name,exact:true}).click();}
async function openSelectedDay(){
  const selected=overview.locator('.finance-dashboard__selected');
  // Centre the control before a real pointer click: sticky tabs/nav must not cover it.
  await selected.evaluate(button=>button.scrollIntoView({block:'center',behavior:'instant'}));
  assert.ok(await selected.evaluate(button=>{const r=button.getBoundingClientRect();return button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'selected day is not covered by navigation');
  await selected.click();
}
try{
  await page.goto(fixture.url,{waitUntil:'networkidle'});await ready('3500₽');
  await check('cross-month, partial payment, goods and refund',async()=>{
    assert.equal(compact(await overview.locator('[data-finance-expense]').textContent()),'18000₽');
    assert.equal(compact(await overview.locator('[data-finance-rent]').textContent()),'18000₽');
    assert.equal((await overview.locator('[data-finance-goods]').textContent()).trim(),'2 шт.');
    assert.equal((await overview.locator('[data-finance-profit]').textContent()).trim(),'—');
    const slider=overview.getByRole('slider');await slider.press('End');
    assert.match(compact(await overview.locator('.finance-dashboard__selected').innerText()),/−500₽/);
    const points=(await overview.locator('polyline').getAttribute('points')).split(' ').map(p=>p.split(',').map(Number));
    assert.equal(points.length,3);assert.ok(points[2][1]>points[0][1],'refund-only day must be below zero');
    await openSelectedDay();
    assert.match(await dialog.innerText(),/Возврат/);assert.match(compact(await dialog.innerText()),/−500₽/);
    assert.equal(await dialog.locator('.finance-center__operation').count(),1);await dialog.locator('[data-finance-detail-close]').click();
    if(output)await page.screenshot({path:resolve(output,'http-cash-390.png'),fullPage:true});
  });
  await check('week and month grouping preserve total',async()=>{
    await period('Год');await ready('6500₽');
    assert.match(await overview.locator('#financeOverviewMovementTitle').innerText(),/недел/);
    await period('Свои даты');await ready('6500₽');
    assert.match(await overview.locator('#financeOverviewMovementTitle').innerText(),/месяц/);
    const slider=overview.getByRole('slider');await slider.press('End');await openSelectedDay();
    assert.match(await dialog.innerText(),/1–3 окт./);
    assert.match(await dialog.locator('[data-finance-detail-scope]').textContent(),/1 января 2024 г. — 3 октября 2026 г./);
    assert.match(compact(await dialog.innerText()),/3500₽/);await dialog.locator('[data-finance-detail-close]').click();
  });
  await period('Этот месяц');await ready('3500₽');
  await check('real ledger HTTP 503 preserves summary',async()=>{
    await page.locator('#fixtureMode').selectOption('partial');await ready('3500₽');await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-overview-chart]')?.textContent.includes('не подтверждено'));
    assert.equal(compact(await overview.locator('[data-finance-received]').textContent()),'3500₽');
    assert.equal(compact(await overview.locator('[data-finance-expense]').textContent()),'18000₽');
    assert.equal(await overview.locator('polyline').count(),0);
    assert.ok(fixture.requests.some(r=>r.path==='/qa/table'&&r.status===503),'source must return actual HTTP 503');
    if(output)await page.screenshot({path:resolve(output,'http-ledger-failure-390.png'),fullPage:true});
    await page.locator('#fixtureMode').selectOption('scenario');await ready('3500₽');
    await page.waitForFunction(()=>!!document.querySelector('#reportFinanceOverview polyline'));
  });
  await check('same-scope summary HTTP 503 is visible with known sums',async()=>{
    await page.locator('#qaFailSummary').click();await page.waitForFunction(()=>document.querySelector('#qaResult')?.textContent==='GET /qa/rpc → HTTP 503');
    assert.equal(compact(await overview.locator('[data-finance-received]').textContent()),'3500₽');
    assert.equal(compact(await overview.locator('[data-finance-expense]').textContent()),'18000₽');
    if(output)await page.screenshot({path:resolve(output,'http-summary-failure-390.png'),fullPage:true});
    assert.match(await overview.innerText(),/Не удалось.*(данные|обновить)|не обновлены|Источник.*недоступ/i,'source failure must be visible in the open overview');
  });
  await check('failed new period does not retain another period money',async()=>{
    await period('Год');await ready('—');
    assert.match(await overview.innerText(),/Не удалось загрузить данные за выбранные даты/);
    assert.doesNotMatch(await overview.innerText(),/Показаны последние подтверждённые суммы/);
  });
  await page.locator('#qaRestore').click();await overview.getByRole('button',{name:'Повторить',exact:true}).click();await ready('6500₽');
  await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-read-status]')?.hidden===true);
  await period('Этот месяц');await ready('3500₽');
  for(const width of [376,390,760,1440])await check('200% text '+width,async()=>{
    await page.setViewportSize({width,height:1000});await page.locator('#qaTextScale').selectOption('200');
    await page.locator('#qaFailSummary').click();await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-read-status]')?.hidden===false);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).fontSize),'32px');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow at 200%');
    assert.equal(compact(await overview.locator('[data-finance-received]').textContent()),'3500₽');
    const retry=overview.getByRole('button',{name:'Повторить',exact:true});
    assert.ok(await retry.evaluate(button=>button.getBoundingClientRect().height>=44),'retry remains a usable touch target');
    await overview.locator('[data-finance-detail="received"]').click();assert.ok(await dialog.isVisible());
    assert.match(await dialog.innerText(),/последние подтверждённые суммы/);
    await dialog.locator('[data-finance-detail-close]').click();
    if(output)await page.screenshot({path:resolve(output,'http-text-200-'+width+'.png'),fullPage:true});
    await page.locator('#qaRestore').click();await retry.click();await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-read-status]')?.hidden===true);
    await page.locator('#qaTextScale').selectOption('100');
  });
  assert.deepEqual(unexpected,[],'no external requests or writes');
}catch(error){failures.push(error.message);}finally{
  if(output)writeFileSync(resolve(output,'HTTP-CHECKS.json'),JSON.stringify({checks,failures,unexpected,http:fixture.requests.filter(r=>r.path.startsWith('/qa/'))},null,2));
  await browser.close();await new Promise(resolve=>fixture.server.close(resolve));
}
assert.deepEqual(failures,[]);
console.log('PASS: real HTTP source, cash/refund/grouping, known sums on failure, 200% and safe clicks.');
