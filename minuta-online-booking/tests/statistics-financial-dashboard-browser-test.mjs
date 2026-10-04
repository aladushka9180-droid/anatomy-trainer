import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serveFixture} from './statistics-clarity-fixture-server.mjs';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const fixture=await serveFixture(), origin=new URL(fixture.url).origin;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
const failures=[], unexpected=[];
const output=process.env.MINUTA_VISUAL_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const money=value=>value.replace(/\s/g,'');
try {
  for(const width of [376,390,760,1440]){
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
    page.on('pageerror',error=>failures.push(`${width}: ${error.message}`));
    await page.route('**/*',route=>{
      const request=route.request();
      if(new URL(request.url()).origin!==origin || request.method()!=='GET'){unexpected.push(request.url());return route.abort();}
      return route.continue();
    });
    await page.goto(fixture.url,{waitUntil:'networkidle'});
    await page.locator('#fixtureMode').selectOption('dashboard');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent.replace(/\s/g,'')==='60000₽');
    const overview=page.locator('#reportFinanceOverview'), dialog=page.locator('[data-finance-detail-dialog]');
    assert.equal(money(await overview.locator('[data-finance-expense]').textContent()),'40000₽');
    assert.equal(money(await overview.locator('[data-finance-rent]').textContent()),'20000₽');
    assert.equal((await overview.locator('[data-finance-goods]').textContent()).trim(),'8 шт.');
    assert.equal((await overview.locator('[data-finance-profit]').textContent()).trim(),'—');
    assert.equal(await overview.locator('.finance-dashboard__surface polyline').count(),1);
    assert.doesNotMatch(await overview.innerText(),/%/);
    assert.ok(await page.locator('#reportTabOverview').evaluate(node=>{
      const style=getComputedStyle(node);
      return parseFloat(style.borderBottomWidth)>0 && style.borderBottomStyle==='solid' && style.borderBottomColor!=='rgba(0, 0, 0, 0)' && style.boxShadow==='none';
    }),'selected tab retains the reference underline through theme overrides');
    const geometry=await overview.evaluate(node=>{
      const rect=selector=>node.querySelector(selector).getBoundingClientRect().toJSON();
      return {hero:rect('.finance-center__hero'),goods:rect('[data-finance-detail="goods"]'),chart:rect('.finance-dashboard__movement'),
        buttons:[...node.querySelectorAll('.finance-dashboard button')].map(button=>({label:button.textContent,rect:button.getBoundingClientRect().toJSON()})),
        overflow:document.documentElement.scrollWidth>window.innerWidth+1};
    });
    assert.ok(!geometry.overflow,`${width}: page overflow`);
    assert.ok(geometry.chart.y>geometry.goods.bottom,`${width}: headline metrics must precede chart`);
    for(const button of geometry.buttons)assert.ok(button.rect.width>=43.5 && button.rect.height>=43.5,`${width}: small touch target ${button.label}`);

    const category=overview.locator('[data-finance-overview-categories] button').first();
    await category.scrollIntoViewIfNeeded();
    const scrollBefore=await page.evaluate(()=>window.scrollY), periodBefore=await page.locator('#reportPeriodLabel').textContent();
    await category.click();
    assert.ok(await dialog.isVisible());
    assert.match(await dialog.innerText(),/Аренда/);assert.match(money(await dialog.innerText()),/20000₽/);
    assert.equal(await dialog.locator('[data-finance-detail-scope]').textContent(),'3 сентября 2026 г. — 2 октября 2026 г. · Вся команда');
    await dialog.locator('[data-finance-detail-close]').click();
    await page.waitForFunction(()=>document.activeElement?.matches('[data-finance-overview-categories] button'));
    assert.equal(await page.locator('#reportPeriodLabel').textContent(),periodBefore);
    assert.ok(Math.abs(await page.evaluate(()=>window.scrollY)-scrollBefore)<=2,`${width}: return scroll moved`);
    assert.ok(await category.evaluate(node=>node===document.activeElement),`${width}: return focus lost`);

    await overview.locator('[data-finance-overview-operations] button').first().click();
    assert.match(await dialog.innerText(),/Оплата визита/);assert.match(money(await dialog.innerText()),/2000₽/);
    assert.equal(await dialog.locator('.finance-center__operation').count(),1);
    await dialog.locator('[data-finance-detail-close]').click();
    const slider=overview.getByRole('slider');
    await slider.press('Home');
    assert.equal(await slider.getAttribute('aria-valuenow'),'0');
    await overview.locator('.finance-dashboard__selected').click();
    assert.match(money(await dialog.innerText()),/1200₽/);
    assert.equal(await dialog.locator('.finance-center__operation').count(),1);
    await dialog.locator('[data-finance-detail-close]').click();
    await slider.press('End');assert.equal(await slider.getAttribute('aria-valuenow'),'29');
    await slider.press('ArrowLeft');assert.equal(await slider.getAttribute('aria-valuenow'),'28');
    const path=await overview.locator('polyline').getAttribute('points');
    const moneyBefore=await overview.locator('[data-finance-received]').textContent();
    await page.locator('#reportTabMoney').click();await page.locator('#reportTabOverview').click();
    assert.equal(await overview.locator('[data-finance-received]').textContent(),moneyBefore);
    assert.equal(await overview.locator('polyline').getAttribute('points'),path);
    await page.evaluate(()=>window.scrollTo(0,0));
    if(output)await page.screenshot({path:resolve(output,`dashboard-${width}.png`),fullPage:true});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    const enlarged=await overview.evaluate(node=>({overflow:document.documentElement.scrollWidth>window.innerWidth+1,
      tabs:[...document.querySelectorAll('.report-view-tabs>button')].map(button=>{
        const range=document.createRange();range.selectNodeContents(button);
        return {button:button.getBoundingClientRect().toJSON(),text:range.getBoundingClientRect().toJSON()};
      }),
      rows:[...node.querySelectorAll('.finance-dashboard__row')].map(row=>({row:row.getBoundingClientRect().toJSON(),
        copy:row.querySelector('.finance-dashboard__row-copy').getBoundingClientRect().toJSON(),amount:row.querySelector('strong').getBoundingClientRect().toJSON()}))}));
    assert.ok(!enlarged.overflow,`${width}: overflow with 200% text`);
    for(const tab of enlarged.tabs)assert.ok(tab.text.left>=tab.button.left-1 && tab.text.right<=tab.button.right+1,`${width}: enlarged tab text overlaps its neighbour`);
    for(const row of enlarged.rows)assert.ok(row.copy.right<=row.amount.left+1,`${width}: enlarged label overlaps amount`);
    if(output)await page.screenshot({path:resolve(output,`dashboard-${width}-200.png`),fullPage:true});
    await page.evaluate(()=>document.documentElement.style.fontSize='');

    const initialTheme=await page.evaluate(()=>{
      const previous={style:document.body.style.cssText,theme:document.body.dataset.providerTheme};
      document.body.dataset.providerTheme='noir-safari';
      for(const name of [...document.body.style])if(name.startsWith('--theme-'))document.body.style.removeProperty(name);
      return previous;
    });
    assert.ok(await overview.locator('.finance-dashboard__panel').first().evaluate(node=>{
      const style=getComputedStyle(node), channels=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
      return channels(style.backgroundColor).every(value=>value<70) && channels(style.color).every(value=>value>120);
    }),`${width}: dashboard respects the established dark theme`);
    const receiptContrast=await overview.locator('.finance-dashboard__row strong.is-received').first().evaluate(node=>{
      const channels=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>value.startsWith('color(srgb') ? channel : channel/255);
      const luminance=value=>channels(value).map(channel=>channel<=.04045 ? channel/12.92 : ((channel+.055)/1.055)**2.4).reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
      const foreground=luminance(getComputedStyle(node).color),background=luminance(getComputedStyle(node.closest('.finance-dashboard__panel')).backgroundColor);
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    });
    assert.ok(receiptContrast>=4.5,`${width}: small receipt amount needs legible dark-theme contrast (${receiptContrast})`);
    if(output)await page.screenshot({path:resolve(output,`dashboard-${width}-noir.png`),fullPage:true});
    await page.evaluate(previous=>{document.body.style.cssText=previous.style;document.body.dataset.providerTheme=previous.theme;},initialTheme);

    await page.locator('#fixtureMode').selectOption('scenario');
    if(!await page.locator('[data-report-period="month"]').isVisible())await page.locator('#reportFilterToggle').click();
    await page.locator('[data-report-period="month"]').click();
    if(await page.locator('#reportFilterToggle').isVisible() && await page.locator('#reportFilterToggle').getAttribute('aria-expanded')==='true')await page.locator('#reportFilterToggle').click();
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent.replace(/\s/g,'')==='3500₽');
    assert.equal(money(await overview.locator('[data-finance-expense]').textContent()),'12000₽');
    assert.equal((await overview.locator('[data-finance-goods]').textContent()).trim(),'2 шт.');
    assert.match(await overview.locator('[data-finance-goods-note]').textContent(),/2\s000/);
    await overview.getByRole('slider').press('End');
    await overview.locator('.finance-dashboard__selected').evaluate(button=>button.scrollIntoView({block:'center',behavior:'instant'}));
    await overview.locator('.finance-dashboard__selected').click();
    assert.match(money(await dialog.innerText()),/3500₽/);assert.equal(await dialog.locator('.finance-center__operation').count(),3);
    assert.match(await dialog.innerText(),/Возврат/);
    await dialog.locator('[data-finance-detail-close]').click();

    await page.locator('#fixtureMode').selectOption('partial');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent.replace(/\s/g,'')==='2300₽');
    assert.equal(money(await overview.locator('[data-finance-expense]').textContent()),'18000₽','known expense amount survives missing ledger');
    assert.equal(await overview.locator('polyline').count(),0,'unconfirmed series cannot be a zero chart');
    assert.match(await overview.locator('[data-finance-overview-chart]').innerText(),/не подтверждено/);

    await page.locator('#fixtureMode').selectOption('empty');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent.replace(/\s/g,'')==='0₽');
    assert.equal(await overview.locator('polyline').count(),1,'confirmed zero receipts retain the date chart');
    const zeroPoints=(await overview.locator('polyline').getAttribute('points')).split(' ').map(pair=>pair.split(',').map(Number));
    assert.equal(zeroPoints.length,2);assert.ok(zeroPoints.flat().every(Number.isFinite));
    assert.ok(zeroPoints.every(point=>point[1]===zeroPoints[0][1]),'confirmed zero receipts form a horizontal line');
    assert.equal(money(await overview.locator('.finance-dashboard__axis').innerText()),'0₽');
    await overview.getByRole('slider').press('End');
    assert.equal(await overview.getByRole('slider').getAttribute('aria-valuenow'),'1');
    assert.match(await overview.getByRole('slider').getAttribute('aria-valuetext'),/2 окт.*0.*₽/);
    await overview.locator('.finance-dashboard__selected').evaluate(button=>button.scrollIntoView({block:'center',behavior:'instant'}));
    await overview.locator('.finance-dashboard__selected').click();
    assert.match(await dialog.locator('[data-finance-detail-scope]').textContent(),/1 октября.*2 октября/);
    assert.equal(await dialog.locator('.finance-center__operation').count(),0);
    assert.match(await dialog.innerText(),/операций.*нет/);
    await dialog.locator('[data-finance-detail-close]').click();
    if(output)await page.screenshot({path:resolve(output,`dashboard-${width}-zero.png`),fullPage:true});
    await page.evaluate(()=>document.documentElement.style.fontSize='200%');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'zero chart fits with 200% text');
    assert.equal(await overview.locator('polyline').count(),1);
    if(output)await page.screenshot({path:resolve(output,`dashboard-${width}-zero-200.png`),fullPage:true});
    await page.evaluate(()=>document.documentElement.style.fontSize='');
    assert.match(await overview.locator('[data-finance-overview-chart]').innerText(),/0 ₽/);
    assert.match(await overview.locator('[data-finance-overview-categories]').innerText(),/расходов.*нет/);
    assert.match(await overview.locator('[data-finance-overview-operations]').innerText(),/Операций.*нет/);
    await page.locator('#fixtureMode').selectOption('unavailable');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent==='—');
    assert.equal(await overview.locator('polyline').count(),0);assert.equal(await overview.locator('.finance-dashboard__row').count(),0);
    assert.match(await overview.locator('[data-finance-overview-chart]').innerText(),/не подтверждено/);
    await overview.locator('.finance-dashboard__notice-action').first().click();
    assert.match(await dialog.innerText(),/не подтвердил|недоступ|Обновить данные/);
    await dialog.locator('[data-finance-detail-close]').click();
    await page.close();
    console.log(`PASS: dashboard ${width}px, cash/date detail, scoped return, empty/unavailable states`);
  }
  assert.deepEqual(failures,[]);assert.deepEqual(unexpected,[]);
}finally{await browser.close();await new Promise(resolve=>fixture.server.close(resolve));}
