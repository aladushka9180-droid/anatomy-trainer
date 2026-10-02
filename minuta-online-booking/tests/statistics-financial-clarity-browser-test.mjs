import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {serveFixture} from './statistics-clarity-fixture-server.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await serveFixture();
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const output=process.env.MINUTA_VISUAL_OUTPUT,errors=[],unexpected=[];
if(output)mkdirSync(output,{recursive:true});
try {
  for(const width of [376,390,760,1440]){
    const page=await browser.newPage({viewport:{width,height:width<=390?772:1000},serviceWorkers:'block'});
    page.on('pageerror',error=>errors.push(`${width}: ${error.message}`));
    await page.route('**/*',route=>{
      if(!route.request().url().startsWith(new URL(fixture.url).origin)||route.request().method()!=='GET'){
        unexpected.push(route.request().url());return route.abort();
      }
      return route.continue();
    });
    await page.goto(fixture.url);
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-rent]')?.textContent==='18\u00a0000\u00a0₽');
    await page.evaluate(async()=>{await document.fonts.ready;});
    const geometry=await page.evaluate(()=>{
      const cards=document.querySelector('#reportFinanceOverview');
      const tabs=[...document.querySelectorAll('.report-view-tabs button')];
      const nav=document.querySelector('.provider-mobile-nav');
      return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        cardsBottom:cards.querySelector('[data-finance-detail="goods"]').getBoundingClientRect().bottom,
        statusBottom:cards.querySelector('[data-finance-detail="completeness"]').getBoundingClientRect().bottom,
        navTop:getComputedStyle(nav).display==='none'?innerHeight:nav.getBoundingClientRect().top,
        tabTops:tabs.map(node=>Math.round(node.getBoundingClientRect().top)),
        icons:cards.querySelectorAll('.finance-center__metric-icon').length,
        sourceHeight:document.querySelector('#reportDataSource').getBoundingClientRect().height,
        filterHeight:document.querySelector('.report-filters').getBoundingClientRect().height,
        toolbarHeight:document.querySelector('.report-toolbar').getBoundingClientRect().height,
        periodTouch:[...document.querySelectorAll('.report-periods button')].map(node=>node.getBoundingClientRect().height)};
    });
    assert.ok(geometry.overflow<=1,`${width}: horizontal overflow`);
    assert.equal(geometry.icons,5);
    assert.ok(geometry.sourceHeight<60,'compact source selector');
    const sourcePaint=await page.locator('#reportDataSource button').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));
    assert.notEqual(sourcePaint[0],sourcePaint[1],'the chosen data source remains visually distinct under theme overrides');
    if(width===1440){
      assert.ok(geometry.filterHeight<=110,`desktop filters should leave room for the financial result: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.toolbarHeight<=56,'period and employee share one compact row');
      assert.ok(geometry.periodTouch.every(height=>height>=44),'compact periods keep accessible click targets');
    }
    assert.equal(await page.locator('.report-summary').isVisible(),false,'visit metrics stay inside the closed disclosure');
    if(width<=390){
      assert.equal(new Set(geometry.tabTops).size,1,'four tabs in one row');
      assert.ok(geometry.cardsBottom<=geometry.navTop,`${width}: rent and goods must be above the fixed navigation`);
      assert.ok(geometry.statusBottom<=geometry.navTop,`${width}: completeness action must stay above the fixed navigation: ${JSON.stringify(geometry)}`);
    }
    if(output)await page.screenshot({path:resolve(output,`statistics-soft-${width}.png`)});
    await page.locator('#reportFinanceOverview [data-finance-detail="completeness"]').click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/у 1 из 36 визитов/);
    assert.doesNotMatch(await page.locator('[data-finance-detail-body]').innerText(),/20 из 37/,'old manual-only RPC qualification is not visit completeness');
    await page.getByRole('button',{name:'Визиты без отметки оплаты',exact:true}).click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/1 визит · 3\s000\s₽/);
    assert.equal(await page.locator('[data-finance-detail-body] .finance-center__operation').count(),1);
    await page.getByRole('button',{name:'Закрыть детализацию',exact:true}).click();
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-detail="completeness"]').evaluate(node=>node===document.activeElement),true);
    const filter=page.locator('#reportFilterToggle');
    if(await filter.isVisible())await filter.click();
    await page.getByRole('button',{name:'Этот месяц',exact:true}).click();
    if(await filter.isVisible())await filter.click();
    await page.locator('#reportTabMoney').click();
    await page.waitForFunction(()=>document.querySelector('[data-finance-services]')?.textContent==='5\u00a0800\u00a0₽');
    assert.equal(await page.locator('#financeCenterRoot [data-finance-received]').innerText(),'0\u00a0₽','visit service price is not cash receipt');
    assert.equal(await page.locator('[data-finance-comparison-period="received"]').last().innerText(),'к 1–2 сент.');
    await page.locator('[data-finance-detail="visits"]').click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/1 визит · 5\s800\s₽/);
    await page.getByRole('button',{name:'Закрыть детализацию',exact:true}).click();
    await page.locator('#reportTabOverview').click();
    await page.locator('#reportVisitOverview>summary').click();
    assert.equal(await page.locator('#reportCompletedValue').innerText(),'5\u00a0800\u00a0₽');
    await page.locator('#reportVisitOverview>summary').click();
    if(await filter.isVisible())await filter.click();
    await page.locator('#reportPerformerFilter').selectOption('33333333-3333-4333-8333-333333333333');
    await page.getByRole('button',{name:'Всё время',exact:true}).click();
    assert.equal(await page.locator('#reportPerformerFilter').inputValue(),'33333333-3333-4333-8333-333333333333','all cannot reset the employee');
    assert.match(await page.locator('#reportFilterSummary').innerText(),/Сотрудник/);
    if(await filter.isVisible())await filter.click();
    await page.locator('#reportFinanceOverview [data-finance-detail="profit"]').click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/себестоимости, налогов/);
    assert.equal(await page.getByRole('button',{name:'Проверить оплаченные расходы',exact:true}).count(),1);
    await page.getByRole('button',{name:'Закрыть детализацию',exact:true}).click();
    if(await filter.isVisible())await filter.click();
    await page.getByRole('button',{name:'Этот месяц',exact:true}).click();
    await page.locator('#reportPerformerFilter').selectOption('all');
    if(await filter.isVisible())await filter.click();
    await page.locator('#fixtureMode').selectOption('scenario');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent==='3\u00a0500\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-expense]').innerText(),'12\u00a0000\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-rent]').innerText(),'10\u00a0000\u00a0₽');
    assert.equal(await page.locator('#reportFinanceOverview [data-finance-goods]').innerText(),'2 шт.');
    await page.locator('#reportFinanceOverview [data-finance-detail="received"]').click();
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/Возврат/);
    await page.getByRole('button',{name:'Закрыть детализацию',exact:true}).click();
    if(await filter.isVisible())await filter.click();
    await page.getByRole('button',{name:'30 дней',exact:true}).click();
    if(await filter.isVisible())await filter.click();
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent==='6\u00a0500\u00a0₽');
    await page.locator('#fixtureMode').selectOption('empty');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent==='0\u00a0₽'&&document.querySelector('#reportFinanceOverview [data-finance-expense]')?.textContent==='0\u00a0₽');
    if(await filter.isVisible())await filter.click();
    await page.locator('#reportPerformerFilter').selectOption('33333333-3333-4333-8333-333333333333');
    if(await filter.isVisible())await filter.click();
    await page.locator('#fixtureMode').selectOption('unavailable');
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]')?.textContent==='—');
    await page.locator('#reportFinanceOverview [data-finance-detail="completeness"]').click();
    assert.match(await page.locator('[data-finance-detail-scope]').innerText(),/3 сент.*2 окт.*Сотрудник/,'unavailable detail keeps the selected dates and employee');
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/Не удалось загрузить данные за выбранные даты/);
    await page.getByRole('button',{name:'Закрыть детализацию',exact:true}).click();
    await page.close();
  }
} finally {await browser.close();await new Promise(resolve=>fixture.server.close(resolve));}
assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
console.log('Soft statistics at 376/390/760/1440: visible priorities, exact visit drilldown, service reconciliation, shared dates/master, empty/unavailable and keyboard return passed.');
