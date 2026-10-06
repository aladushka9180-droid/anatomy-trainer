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
    // All records are synthetic: exercise snapshot disclosure/copy without
    // visiting a cabinet, sending a message or changing an actual delivery.
    const fullText=await page.evaluate(async()=>{
      const message=retentionFixture.fullText('draft')+'\n'+('https://booking.synthetic.test/'+ 'long-path/'.repeat(45));
      retentionFixture.deliveries[0].message_snapshot=message;
      retentionFixture.deliveries.push({...retentionFixture.deliveries[0],id:'cancelled-history',status:'cancelled'});
      await retentionController.load();
      return message;
    });
    const delivery=page.locator('.retention-delivery-row').first();
    const disclosure=delivery.locator('.retention-message-disclosure');
    await disclosure.waitFor({state:'attached'});
    assert.equal(await disclosure.evaluate(e=>e.open),false,'long snapshot starts collapsed at every width');
    assert.equal(await delivery.locator('.retention-message-snapshot').textContent(),fullText,'original snapshot remains intact');
    assert.equal(await page.locator('.retention-delivery-row').count(),2,'cancelled history remains visible');
    assert.equal(await page.locator('#retentionPreparedCount').textContent(),'1','history does not inflate prepared count');
    const excerpt=await delivery.locator('.retention-message-excerpt').evaluate(e=>({height:e.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(e).lineHeight)}));
    assert.ok(excerpt.height<=2*excerpt.lineHeight+1,'long preview occupies at most two lines');
    await disclosure.locator('summary').click();
    assert.ok(await delivery.locator('.retention-message-snapshot').isVisible(),'complete text can be opened');
    await page.setViewportSize({width:width<1000?1440:390,height:1000});
    assert.equal(await disclosure.evaluate(e=>e.open),true,'resize preserves the user disclosure choice');
    await page.setViewportSize({width,height:1000});
    await disclosure.locator('summary').click();
    await delivery.locator('[data-retention-copy]').click();
    await page.waitForFunction(()=>retentionFixture.copied.length===1);
    assert.equal(await page.evaluate(()=>retentionFixture.copied[0]),fullText,'copy uses the complete original snapshot');
    await delivery.locator('.retention-delivery-options>summary').click();
    const controls=await delivery.locator('.retention-row-actions').evaluate(e=>[...e.children].map(control=>{
      const r=control.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right,underlined:getComputedStyle(control).textDecorationLine};
    }));
    assert.equal(controls.length,3,'all manual actions remain available');
    for(const control of controls){assert.ok(control.height>=44,'manual action has a 44px target');assert.ok(control.left>=0&&control.right<=width,'manual action fits viewport');assert.equal(control.underlined,'none','action link has the same button presentation');}
    const toolbar=await delivery.evaluate(row=>{
      const copy=row.querySelector('[data-retention-copy]').getBoundingClientRect(),more=row.querySelector('.retention-delivery-options>summary').getBoundingClientRect();
      return {copyRight:copy.right,moreLeft:more.left};
    });
    assert.ok(toolbar.copyRight<=toolbar.moreLeft,'copy and menu controls do not overlap when expanded');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'expanded delivery has no page overflow');
    assert.equal(await page.evaluate(()=>retentionFixture.calls.filter(c=>c.name!=='get_minuta_retention_workspace').length),0,'disclosure and copy do not prepare, send or cancel');
    await page.close();
    console.log(`PASS retention cascade ${width}px, base CSS ${lateBase?'after':'before'} mobile CSS`);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
} finally {await browser.close();}
