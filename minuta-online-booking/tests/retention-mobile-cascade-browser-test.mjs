import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildRetentionFixture} from './retention-delta-fixture.mjs';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const errors=[],outbound=[];
try {
  for(const lateBase of [false,true]) for(const width of [390,760,1440]) {
    const css=read('retention-mobile-ui.css')+(lateBase?'\n'+read('retention-soft-ui.css'):'');
    let fixture=buildRetentionFixture().replace('<main class="fixture-wrap">','<main class="fixture-wrap retention-mobile-active" id="organizationWorkspace" data-organization-groups-ready>');
    fixture=fixture.replace('</style>',css+'\n</style>').replace('</body>','<script>'+read('retention-mobile-ui.js').replace(/<\/script/gi,'<\\/script')+'</script></body>');
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>{if(r.request().url()==='https://retention-cascade.synthetic.test/')return r.fulfill({contentType:'text/html',body:fixture});outbound.push(r.request().url());return r.abort();});
    await page.goto('https://retention-cascade.synthetic.test/');
    await page.evaluate(()=>retentionReady);
    await page.waitForSelector('.retention-consent-mobile',{state:'attached'});
    const rows=await page.locator('.retention-client-row').evaluateAll(nodes=>nodes.map(row=>{
      const box=e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      return{main:box(row.querySelector('.organization-row-main')),status:box(row.querySelector('.retention-client-status')),options:box(row.querySelector('.retention-client-options')),columns:getComputedStyle(row).gridTemplateColumns};
    }));
    assert.equal(rows.length,7);
    for(const [i,row] of rows.entries()) {
      assert.ok(row.status.x>=row.main.right-1,`width ${width}, late CSS ${lateBase}, row ${i}: status overlaps client`);
      assert.ok(row.options.x>=row.main.right-1,`width ${width}, late CSS ${lateBase}, row ${i}: consent overlaps client`);
    }
    await page.locator('.retention-client-options>summary').first().click();
    if(width<1000) {
      const open=await page.locator('.retention-client-row').first().evaluate(row=>({mainBottom:row.querySelector('.organization-row-main').getBoundingClientRect().bottom,optionsTop:row.querySelector('.retention-client-options').getBoundingClientRect().top}));
      assert.ok(open.optionsTop>=open.mainBottom-1,'opened consent follows the full client details');
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal page overflow');
    assert.equal(await page.evaluate(()=>retentionFixture.calls.filter(c=>c.name!=='get_minuta_retention_workspace').length),0,'layout/disclosure never writes');
    await page.close();
    console.log(`PASS retention cascade ${width}px, base CSS ${lateBase?'after':'before'} mobile CSS`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
} finally {await browser.close();}
