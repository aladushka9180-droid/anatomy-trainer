import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const providerSource=readFileSync(new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const initStart=providerSource.indexOf('function initializeProviderUx() {');
const initialize=providerSource.slice(initStart,providerSource.indexOf('\n}',initStart)+2);
const filterSelector=providerSource.match(/root:\$\('(#[^']+)'\),\n\s+refresh:\(\) => \{ clientRenderLimit/)[1];
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chromium'});
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:850}});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<body class="provider-body" data-provider-theme="snow-leopard" data-provider-layout="linear"></body>');
    await page.evaluate(html=>{
      const doc=new DOMParser().parseFromString(html,'text/html');
      const section=doc.querySelector('#clientsLayout').parentElement;
      section.hidden=false;section.style.display='block';
      document.body.append(document.importNode(section,true));
      document.querySelectorAll('#clientImportPanel,#clientFieldsSettings').forEach(node=>node.hidden=true);
    },readFileSync(new URL('../provider.html',import.meta.url),'utf8'));
    await page.addScriptTag({content:`var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];${initialize};initializeProviderUx();`});
    await page.evaluate(selector=>{window.filterRoot=document.querySelector(selector);},filterSelector);
    for (const file of ['styles.css','provider-themes-signature.css']) await page.addStyleTag({content:readFileSync(new URL(`../${file}`,import.meta.url),'utf8')});
    await page.addStyleTag({content:readFileSync(new URL('../client-directory.css',import.meta.url),'utf8')});
    await page.addScriptTag({content:readFileSync(new URL('../client-directory.js',import.meta.url),'utf8')});
    await page.evaluate(()=>{
      const booking=(date,status='completed',extra={})=>({booking_date:date,booking_time:'10:00',visit_status:status,status:'confirmed',services:{name:'Массаж'},service_id:'massage',...extra});
      window.clients=[
        {phone:'1',name:'Анна',displayPhone:'1',bookings:[booking('2020-01-01'),booking('2020-01-02','no_show'),booking('2020-01-03','completed',{status:'cancelled'}),booking('2099-01-01','scheduled')]},
        {phone:'2',name:'Борис',displayPhone:'2',imported:{visit_count:5,last_visit_on:'2020-01-02'},bookings:[booking('2020-01-01','completed',{is_imported_history:true}),booking('2020-01-02')]},
        {phone:'3',name:'Вера',displayPhone:'3',bookings:[]}
      ];
      window.context='A'; window.search='';
      window.refresh=()=>{window.result=window.controller.apply(clients,search,context);};
      window.controller=MinutaClientDirectory.create({root:filterRoot,refresh,outcome:b=>b,getLabels:p=>({vip:p==='2'}),services:()=>[{id:'massage',name:'Массаж'}],nameKey:s=>s.toLowerCase(),today:()=> '2026-09-06'});
      refresh();
    });
    assert.equal(await page.locator('[data-client-filters]').isVisible(),true,'Filters must remain visible after real provider UX initialization');
    assert.equal(await page.locator('#clientDirectoryTools').count(),1,'Import controls retain their unique ID');
    assert.equal(await page.locator('#clientDirectoryTools #clientImportPanel').count(),1,'Filters must not replace import settings');
    assert.deepEqual(await page.evaluate(()=>result.map(c=>[c.name,c.directoryVisitCount])),[['Борис',6],['Анна',1],['Вера',0]]);
    await page.selectOption('[data-client-sort]','next');
    assert.equal(await page.evaluate(()=>result[0].name),'Анна');
    await page.click('[data-client-filters]');
    await page.check('[name=services]'); await page.check('[value=vip]');
    await page.fill('[name=min]','5'); await page.fill('[name=absent]','60');
    await page.selectOption('[name=upcoming]','no');
    assert.match(await page.textContent('[data-client-apply]'),/1$/);
    await page.click('[data-client-apply]');
    assert.deepEqual(await page.evaluate(()=>result.map(c=>c.name)),['Борис']);
    await page.click('[data-clear-client-filter=all]');
    assert.equal(await page.evaluate(()=>result.length),3);
    await page.click('[data-client-filters]');
    await page.fill('[name=from]','2020-01-03'); await page.fill('[name=to]','2020-01-01');
    assert.equal(await page.$eval('.client-directory-dialog form',f=>f.checkValidity()),false);
    await page.fill('[name=from]','2020-01-02'); await page.fill('[name=to]','2020-01-02');
    await page.click('[data-client-apply]');
    assert.deepEqual(await page.evaluate(()=>result.map(c=>c.name)),['Борис']);
    await page.evaluate(()=>{context='B';refresh();});
    assert.equal(await page.evaluate(()=>result.length),3);
    await page.click('[data-client-filters]');
    const box=await page.locator('.client-directory-dialog').boundingBox();
    assert.ok(box.x>=0 && box.x+box.width<=width+1,'Dialog must fit viewport');
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('.client-directory-dialog',d=>d.open),false);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('Client directory: counts, combined filters, dates, sorting, scope reset and mobile dialog PASS (synthetic data)');
} finally {await browser.close();}
