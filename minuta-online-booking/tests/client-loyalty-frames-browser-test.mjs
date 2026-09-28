import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './client-loyalty-frames-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());await page.goto(url);
 for(const theme of ['pink-porcelain','sage','noir-rose','midnight']){
  await page.locator('body').evaluate((el,t)=>el.dataset.providerTheme=t,theme);
  for(const width of [390,760,1440]){
   await page.setViewportSize({width,height:950});
   for(const count of [0,3,6,9,10,20,30,40,50,60,70,80,90,100,101]){
    await page.evaluate(n=>renderCount(n),count);
    assert.equal(await page.locator('#clientProfileOrbit .loyalty-frame-count').innerText(),String(count));
    const geometry=await page.evaluate(()=>{const avatar=document.querySelector('#clientAvatar').getBoundingClientRect();const plaque=document.querySelector('#clientProfileOrbit .loyalty-frame-count').getBoundingClientRect();return {avatar:avatar.toJSON(),plaque:plaque.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth};});
    assert.ok(geometry.overflow<=1,`${theme}/${width}/${count}: overflow`);
    assert.ok(geometry.plaque.top>=geometry.avatar.top+geometry.avatar.height*.65,`${theme}/${width}/${count}: plaque leaves face centre clear`);
    assert.ok(geometry.avatar.width>=104&&geometry.avatar.width<=118,'Photo fills the current frame aperture');
   }
   await page.locator('#clientLoyaltyLevel').click();
   await page.getByRole('dialog').waitFor({state:'visible'});
   assert.match(await page.getByRole('dialog').innerText(),/Максимальный ободок/);
   await page.getByRole('button',{name:'Закрыть',exact:true}).click();
   if(process.env.MINUTA_LOYALTY_SCREENSHOTS){mkdirSync(process.env.MINUTA_LOYALTY_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.MINUTA_LOYALTY_SCREENSHOTS}/${theme}-${width}.png`,fullPage:true});}
  }
 }
 await page.evaluate(()=>{PrimeTimeLoyaltyFrames.reset();renderCount(8);});
 await page.locator('.loyalty-frame-open').focus();await page.keyboard.press('Enter');
 assert.match(await page.getByRole('dialog').innerText(),/Следующий ободок — на 9 сеансах/);
 await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);
 await page.evaluate(()=>renderCount(9));assert.equal(await page.locator('#clientProfileOrbit').evaluate(el=>el.classList.contains('loyalty-level-up')),true);
 await page.evaluate(()=>renderCount(2,false));await page.locator('#clientLoyaltyLevel').click();assert.match(await page.getByRole('dialog').innerText(),/По доступной истории/);
 await page.keyboard.press('Escape');
 for(const dimensions of [[300,500],[500,300]]){
  await page.evaluate(([w,h])=>{renderCount(100);const image=document.createElement('img');image.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#bcd9cc"/><circle cx="50%" cy="48%" r="60" fill="#c18e72"/></svg>`);document.querySelector('#clientAvatar').replaceChildren(image);document.querySelector('#clientProfileOrbit').classList.add('has-photo');},dimensions);
  const photo=await page.locator('#clientAvatar img').evaluate(el=>({fit:getComputedStyle(el).objectFit,w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,clip:getComputedStyle(el.parentElement).overflow}));
  assert.deepEqual(photo,{fit:'cover',w:118,h:118,clip:'hidden'},'Portrait and landscape photos fill the crown aperture with a circular crop');
 }
 await page.evaluate(()=>{document.querySelector('#clientAvatar').textContent='В';document.querySelector('#clientProfileOrbit').classList.remove('has-photo');});
 assert.deepEqual(errors,[]);
 if(process.env.MINUTA_LOYALTY_SCREENSHOTS){
  await page.keyboard.press('Escape');await page.setViewportSize({width:920,height:950});
  await page.evaluate(()=>{
   document.body.dataset.providerTheme='pink-porcelain';const gallery=document.createElement('section');gallery.id='frameGallery';gallery.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:20px;background:var(--theme-surface)';
   for(const n of PrimeTimeLoyaltyFrames.thresholds){renderCount(n);const box=document.createElement('div');box.style.textAlign='center';const clone=document.querySelector('#clientProfileOrbit').cloneNode(true);clone.removeAttribute('id');clone.querySelectorAll('input,button,label').forEach(el=>el.remove());clone.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));clone.style.margin='auto';box.append(clone);const caption=document.createElement('p');caption.textContent=n+' сеансов';box.append(caption);gallery.append(box);}document.querySelector('main').hidden=true;document.body.append(gallery);
  });
  await page.locator('#frameGallery').screenshot({path:`${process.env.MINUTA_LOYALTY_SCREENSHOTS}/all-tiers.png`});
 }
 console.log('Loyalty frames: 14 tiers, 101+, 4 themes × 390/760/1440, photo clearance, dialog, keyboard and pending state PASS (isolated fixture)');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
