import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {startServer} from './certificate-designer-fixture-server.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.MINUTA_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.MINUTA_CERTIFICATE_OUTPUT||fileURLToPath(new URL('../../outputs/certificate-designer/',import.meta.url));mkdirSync(output,{recursive:true});
const {server,url}=await startServer(),browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true});
const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));let checks=0;
try {
  await page.goto(url+'/fixture.html?store=library-'+crypto.randomUUID());await page.locator('[data-canvas]').waitFor({state:'visible'});
  assert.equal(requests.some(u=>u.includes('template-library')),false);checks++;
  await page.locator('[data-content-mode]').selectOption('custom');await page.locator('[data-custom-text]').fill('Любая услуга на ваш выбор\nОдин сеанс');
  await page.locator('[data-open-library]').click();await page.locator('[data-preset="original-panorama"]').waitFor();
  assert.equal(await page.locator('[data-preset]').count(),3);assert.equal(new Set(await page.locator('[data-preset]').allTextContents()).size,3);checks++;
  const source=readFileSync(new URL('../certificate-template-library.js',import.meta.url),'utf8');assert.doesNotMatch(source,/для тебя|ваш подарок|minimal-/i);assert.match(source,/original-atelier/);checks++;
  assert.equal(await page.evaluate(()=>{try{MinutaCertificateTemplateLibrary.create('minimal-01');return false}catch{return true}}),true);checks++;
  for(const width of [390,760,1440]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>{const d=document.querySelector('[data-library]');return document.documentElement.scrollWidth<=innerWidth&&d.scrollWidth<=d.clientWidth}),true);
    await page.screenshot({path:output+`/library-${width}.png`});checks++;
  }
  await page.keyboard.press('Escape');assert.equal(await page.locator('[data-library]').evaluate(d=>d.open),false);checks++;
  // All actual originals are loaded and filled, rather than checking only metadata or thumbnails.
  const proofs=await page.evaluate(async()=>{
    const L=MinutaCertificateTemplateLibrary,R=MinutaCertificateRenderer,sheet=document.createElement('canvas');sheet.width=1500;sheet.height=800;const sc=sheet.getContext('2d');sc.fillStyle='#eeeeeb';sc.fillRect(0,0,sheet.width,sheet.height);
    const results=[];
    for(const item of L.items){
      const t=L.create(item.id),image=await R.loadImage(t.image_data),canvas=document.createElement('canvas');
      const record={procedure:'Индивидуальная фотосессия с подготовкой и обработкой снимков (1 час/1 сеанс)',number:'267',issued_on:'2026-10-03',expires_on:'2027-04-03'};
      const info=R.render(canvas,image,record,t.layout);
      const custom=R.render(document.createElement('canvas'),image,{...record,procedure:'Любая услуга на ваш выбор\nОдин сеанс'},t.layout);
      R.render(canvas,image,{...record,procedure:'Любая услуга на ваш выбор'},t.layout);
      const col=item.index,scale=Math.min(450/canvas.width,655/canvas.height),w=canvas.width*scale,h=canvas.height*scale;
      sc.drawImage(canvas,col*500+(500-w)/2,30+(655-h)/2,w,h);sc.fillStyle='#26312e';sc.font='22px Arial';sc.textAlign='center';sc.fillText(item.name,col*500+250,745);
      results.push({id:item.id,name:item.name,width:image.width,height:image.height,bytes:t.image_data.length,layout:t.layout,info,custom,hashSource:t.image_data,filled:canvas.toDataURL()});
    }
    return {results,sheet:sheet.toDataURL()};
  });
  assert.equal(proofs.results.length,3);assert.equal(new Set(proofs.results.map(r=>createHash('sha256').update(r.hashSource).digest('hex'))).size,3);checks++;
  for(const r of proofs.results){
    assert.deepEqual([r.width,r.height],r.id==='original-outline'?[2480,3508]:[3508,2480]);assert.ok(r.bytes<11200000);
    for(const f of Object.values(r.layout)){assert.ok(f.x>=.025&&f.x<=.975&&f.y>=.025&&f.y<=.975&&f.width<=2*Math.min(f.x,1-f.x)&&f.size>=.005&&f.size<=.1)}
    assert.ok(r.info.procedure.lines.length<=2);assert.equal(r.custom.procedure.lines.length,2);checks++;
    if(r.filled)writeFileSync(output+`/${r.id}-filled.png`,Buffer.from(r.filled.split(',')[1],'base64'));
    delete r.hashSource;delete r.filled;
  }
  writeFileSync(output+'/certificate-3-designs.png',Buffer.from(proofs.sheet.split(',')[1],'base64'));
  const initial=await page.evaluate(()=>window.certificateFixture.getState());
  await page.locator('[data-open-library]').click();await page.locator('[data-preset="original-panorama"]').click();await page.locator('[data-save-preset]').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('[data-canvas]').width===3508&&!document.querySelector('[data-save-preset]').disabled);
  assert.equal(await page.locator('[data-custom-text]').inputValue(),'Любая услуга на ваш выбор\nОдин сеанс');assert.equal(await page.locator('[data-date]').inputValue(),'2026-10-03');assert.equal(await page.locator('[data-number]').inputValue(),'267');checks++;
  assert.equal(await page.locator('[data-issue]').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>window.certificateFixture.getState()),initial);checks++;
  await page.locator('[data-paper]').selectOption('a4');assert.match(await page.locator('[data-print-quality]').textContent(),/300 dpi/);checks++;
  for(const format of ['png','jpg','pdf','webp']){
    await page.locator('[data-format]').selectOption(format);const pending=page.waitForEvent('download');await page.locator('[data-download]').click();const file=await pending;await file.saveAs(output+`/library-certificate-267.${format}`);
    assert.equal(file.suggestedFilename(),`certificate-267.${format}`);const bytes=readFileSync(output+`/library-certificate-267.${format}`);assert.ok(bytes.length>1000);checks++;
  }
  await page.locator('[data-save-preset]').click();await page.locator('[data-issue]').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('[data-issue]').disabled);
  const id=await page.locator('[data-template]').inputValue();assert.equal(await page.evaluate(()=>window.certificateFixture.getState().templates.length),initial.templates.length+1);checks++;
  await page.locator('[data-issue]').click();await page.locator('[data-new]').waitFor({state:'visible'});assert.equal(await page.locator('[data-open-library]').isDisabled(),true);checks++;
  const snapshot=await page.evaluate(()=>window.certificateFixture.getState().records[0]);assert.equal(snapshot.template_id,id);checks++;
  await page.locator('[data-new]').click();await page.locator('[data-number]').fill('268');await page.locator('[data-open-library]').click();await page.locator('[data-preset="original-outline"]').click();await page.waitForFunction(()=>document.querySelector('[data-canvas]').width===2480&&!document.querySelector('[data-save-preset]').disabled);
  assert.deepEqual(await page.evaluate(()=>window.certificateFixture.getState().records[0]),snapshot);checks++;
  await page.getByRole('tab',{name:'История',exact:true}).click();await page.getByRole('button',{name:'Открыть',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-canvas]').width===3508);assert.equal(await page.locator('[data-number]').inputValue(),'267');checks++;
  await page.locator('[data-new]').click();await page.locator('[data-open-library]').click();await page.evaluate(()=>window.certificateFixture.controller.setOrganization(null));assert.equal(await page.locator('[data-library]').evaluate(d=>d.open),false);checks++;
  const empty=await context.newPage();empty.on('pageerror',e=>errors.push(e.message));await empty.goto(url+'/fixture.html?store=empty-library-'+crypto.randomUUID());await empty.locator('[data-canvas]').waitFor({state:'visible'});
  await empty.evaluate(async()=>{const repo=window.certificateFixture.repository,original=repo.workspace;repo.workspace=async(...args)=>({...await original(...args),templates:[]});await window.certificateFixture.controller.reload()});
  assert.equal(await empty.locator('[data-canvas]').isVisible(),false);await empty.locator('[data-open-library]').click();await empty.locator('[data-preset="original-outline"]').click();await empty.locator('[data-save-preset]').waitFor({state:'visible'});await empty.waitForFunction(()=>!document.querySelector('[data-save-preset]').disabled);
  assert.equal(await empty.locator('[data-canvas]').evaluate(c=>c.width),2480);checks++;await empty.close();
  const delayed=await context.newPage();delayed.on('pageerror',e=>errors.push(e.message));let releaseLibrary;
  await delayed.route('**/certificate-template-library.js',route=>new Promise(resolve=>{releaseLibrary=async()=>{await route.continue();resolve()}}));
  await delayed.goto(url+'/fixture.html?store=delayed-library-'+crypto.randomUUID());await delayed.locator('[data-canvas]').waitFor({state:'visible'});await delayed.locator('[data-open-library]').click();
  await delayed.evaluate(()=>window.certificateFixture.controller.setOrganization(null));await releaseLibrary();await delayed.waitForFunction(()=>Boolean(window.MinutaCertificateTemplateLibrary));
  assert.equal(await delayed.locator('[data-library]').evaluate(d=>d.open),false);assert.equal(await delayed.locator('[data-preset]').count(),0);assert.equal(await delayed.locator('#certificateDesignerPanel').isVisible(),false);checks++;await delayed.close();
  const retry=await context.newPage();retry.on('pageerror',e=>errors.push(e.message));let attempts=0;
  await retry.route('**/certificate-template-library.js',route=>++attempts===1?route.fulfill({status:404,body:''}):route.continue());
  await retry.goto(url+'/fixture.html?store=retry-library-'+crypto.randomUUID());await retry.locator('[data-canvas]').waitFor({state:'visible'});await retry.locator('[data-open-library]').click();await retry.getByRole('alert').waitFor();await retry.locator('[data-close-library]').click();
  await retry.locator('[data-open-library]').click();await retry.locator('[data-preset="original-panorama"]').waitFor();assert.equal(attempts,2);checks++;await retry.close();
  assert.deepEqual(errors,[]);assert.equal(requests.every(u=>u.startsWith(url)),true);checks++;
  writeFileSync(output+'/library-checks.json',JSON.stringify({checks,designs:proofs.results,widths:[390,760,1440],pageErrors:errors,liveAcceptance:false},null,2));
  console.log(`Certificate library: ${checks} PASS; 3 independent originals, rejected 30 removed; isolated fixture only.`);
} finally {await browser.close();server.close()}
