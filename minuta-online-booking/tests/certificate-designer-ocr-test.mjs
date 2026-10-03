import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {startServer} from './certificate-designer-fixture-server.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.MINUTA_PLAYWRIGHT_MODULE||'playwright');
const output=process.env.MINUTA_CERTIFICATE_OUTPUT||fileURLToPath(new URL('../../outputs/certificate-designer/',import.meta.url));mkdirSync(output,{recursive:true});
const vendor=fileURLToPath(new URL('../vendor/certificate-ocr/',import.meta.url)),manifest=JSON.parse(readFileSync(vendor+'manifest.json','utf8'));
for(const [name,hash] of Object.entries(manifest.sha256))assert.equal(createHash('sha256').update(readFileSync(vendor+name)).digest('hex'),hash);
const {server,url}=await startServer(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(url))external.push(request.url())});
let checks=1;
try{
  await page.goto(url+'/fixture.html?store=ocr-'+Date.now());await page.locator('[data-canvas]').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>performance.getEntriesByType('resource').some(r=>r.name.includes('certificate-ocr'))),false,'OCR does not participate in startup');checks++;
  // Apply the actual provider CSP to subsequent script/worker requests.
  const html=readFileSync(fileURLToPath(new URL('../provider.html',import.meta.url)),'utf8'),csp=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  await page.evaluate(policy=>{const meta=document.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content=policy;document.head.append(meta)},csp);
  await page.addScriptTag({url:url+'/certificate-layout-detector.js'});
  async function template(landscape=false,filled=false,blank=false){
    return page.evaluate(({landscape,filled,blank})=>{
      const canvas=document.createElement('canvas');canvas.width=landscape?1400:1000;canvas.height=landscape?900:1400;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      if(!blank){
        ctx.fillStyle='#111';ctx.strokeStyle='#111';ctx.lineWidth=2;ctx.textAlign='center';ctx.font='34px Arial';
        const y=landscape?400:760,d=landscape?610:1000;
        ctx.fillText('ВАМ ПОДАРЕНА ПРОЦЕДУРА',canvas.width/2,y-75);
        const line=(a,b,y)=>{ctx.beginPath();ctx.moveTo(a,y);ctx.lineTo(b,y);ctx.stroke()};
        line(70,canvas.width-70,y);line(70,370,d);line(canvas.width-370,canvas.width-70,d);
        ctx.font='27px Arial';ctx.fillText(landscape?'НОМЕР':'ДАТА ВЫДАЧИ',220,d+45);
        ctx.fillText(landscape?'ДАТА ВЫДАЧИ':'НОМЕР',canvas.width-220,d+45);
        if(filled){ctx.font='40px Arial';ctx.fillText('Массаж спины — 3 сеанса',canvas.width/2,y-5);ctx.fillText('03.10.2026',220,d-5);ctx.fillText('267',canvas.width-220,d-5);}
      }
      return canvas.toDataURL('image/png');
    },{landscape,filled,blank});
  }
  async function detect(data){return page.evaluate(async data=>{const image=await MinutaCertificateRenderer.loadImage(data);return MinutaCertificateLayoutDetector.createJob(image).promise},data)}
  const portrait=await template(),landscape=await template(true);
  const a=await detect(portrait);assert.deepEqual(Object.keys(a).sort(),['date','number','procedure']);assert.ok(Math.abs(a.date.x-.22)<.015&&Math.abs(a.procedure.y-760/1400)<.015);checks++;
  const b=await detect(landscape);assert.deepEqual(Object.keys(b).sort(),['date','number','procedure']);assert.ok(b.date.x>.7&&b.number.x<.3,'labels govern assignment even when date and number are reversed');checks++;
  assert.deepEqual(await detect(await template(false,false,true)),{});checks++;
  const occupied=await detect(await template(false,true));assert.equal(Object.keys(occupied).length,0,'existing text is never erased or overwritten automatically');checks++;
  if(process.env.MINUTA_CERTIFICATE_TEMPLATE){
    const path=process.env.MINUTA_CERTIFICATE_TEMPLATE,mime=/\.webp$/i.test(path)?'webp':/\.jpe?g$/i.test(path)?'jpeg':'png';
    const original=await detect('data:image/'+mime+';base64,'+readFileSync(path).toString('base64'));
    writeFileSync(output+'/user-template-detection.json',JSON.stringify(original,null,2));
    assert.deepEqual(Object.keys(original).sort(),['date','number','procedure']);assert.ok(Math.abs(original.date.x-.213)<.025&&Math.abs(original.number.x-.783)<.025);checks++;
  }
  await page.getByText('Загрузить и настроить макет',{exact:true}).click();
  await page.locator('[data-image]').setInputFiles({name:'Мой сертификат.png',mimeType:'image/png',buffer:Buffer.from(landscape.split(',')[1],'base64')});
  await page.locator('[data-detection]').filter({hasText:'Найдены все 3 поля'}).waitFor({timeout:60000});
  await page.locator('[data-field]').selectOption('date');assert.ok(Number(await page.locator('[data-x]').inputValue())>70);assert.equal(await page.locator('[data-issue]').isDisabled(),true);checks++;
  for(const width of [390,760,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+`/recognition-${width}.png`,fullPage:true});checks++;}
  await page.locator('[data-x]').fill('80');await page.locator('[data-save-template]').click();await page.locator('[data-message]').filter({hasText:'Макет сохранён'}).waitFor();
  const saved=await page.locator('[data-template]').inputValue();await page.reload();await page.locator('[data-canvas]').waitFor({state:'visible'});await page.locator('[data-template]').selectOption(saved);await page.getByText('Загрузить и настроить макет',{exact:true}).click();await page.locator('[data-field]').selectOption('date');assert.equal(await page.locator('[data-x]').inputValue(),'80');checks++;
  const empty=await template(false,false,true);await page.locator('[data-image]').setInputFiles({name:'Без подписей.png',mimeType:'image/png',buffer:Buffer.from(empty.split(',')[1],'base64')});
  await page.locator('[data-detection]').filter({hasText:'Найдено полей: 0 из 3'}).waitFor({timeout:60000});
  assert.equal(await page.locator('[data-save-template]').isEnabled(),true);await page.locator('[data-x]').fill('32');assert.equal(await page.locator('[data-x]').inputValue(),'32');checks++;
  // A cancelled/old response must not replace a manual correction or a new session.
  await page.addScriptTag({url:url+'/certificate-layout-detector.js'});
  await page.evaluate(()=>{const api=MinutaCertificateLayoutDetector;window.realDetection=api.createJob;api.createJob=()=>({cancel(){},promise:new Promise(resolve=>window.releaseDetection=resolve)})});
  await page.locator('[data-detect]').click();await page.locator('[data-cancel-detect]').click();await page.locator('[data-x]').fill('78');
  await page.evaluate(()=>releaseDetection({date:{x:.2,y:.7,width:.25,size:.02,italic:false}}));assert.equal(await page.locator('[data-x]').inputValue(),'78');checks++;
  await page.locator('[data-detect]').click();await page.evaluate(async()=>{await certificateFixture.controller.setOrganization(null);releaseDetection({date:{x:.2,y:.7,width:.25,size:.02,italic:false}})});
  assert.equal(await page.locator('#certificateDesignerPanel').isVisible(),false);checks++;
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],'no image or language request goes to a third party');checks++;
  writeFileSync(output+'/ocr-checks.json',JSON.stringify({checks,externalRequests:external,pageErrors:errors,recognition:'real local rus+eng OCR; synthetic and optional private template',live:false},null,2));
  console.log(`Certificate automatic layout checks: ${checks} PASS; same-origin real OCR, isolated fixture.`);
}catch(error){await page.screenshot({path:output+'/ocr-failure.png',fullPage:true});throw error;}
finally{await browser.close();server.close();}
