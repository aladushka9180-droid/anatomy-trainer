import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startFixture} from './new-booking-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();const browser=await chromium.launch();
try{
 const page=await browser.newPage({reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>{
  document.body.classList.remove('booking-sheet-open');document.querySelector('#bookingSheet').remove();
  const gallery=document.createElement('main');gallery.id='compactGallery';gallery.style.cssText='padding:16px;background:var(--theme-surface);color:var(--theme-ink);display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px';
  const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="300" height="500" fill="#86bbaf"/><circle cx="150" cy="220" r="85" fill="#d9aa89"/></svg>');
  for(const size of [76,88])for(const total of [...PrimeTimeLoyaltyFrames.thresholds,999]){
   const box=document.createElement('div');box.innerHTML=PrimeTimeLoyaltyFrames.compact({total,size,content:`<img src="${photo}" alt="">`})+`<p>${total} сеансов · ${size}px</p>`;gallery.append(box);
  }
  document.body.append(gallery);
 });
 for(const theme of ['pink-porcelain','noir-rose'])for(const width of [390,760,1440]){
  await page.setViewportSize({width,height:950});await page.evaluate(t=>document.body.dataset.providerTheme=t,theme);
  const geometry=await page.locator('.client-framed-avatar').evaluateAll(nodes=>nodes.map(el=>{
   const photo=el.querySelector('.client-framed-photo'),image=photo.querySelector('img'),count=el.querySelector('.client-framed-count');
   const p=photo.getBoundingClientRect(),i=image.getBoundingClientRect(),c=count.getBoundingClientRect(),r=el.getBoundingClientRect();
   return {width:r.width,photo:p.width,image:i.width,ratio:p.width/p.height,clip:getComputedStyle(photo).overflow,fit:getComputedStyle(image).objectFit,
    count:getComputedStyle(count).fontSize,covered:c.top<p.top+p.height*.65,inside:c.bottom<=r.bottom+1};
  }));
  for(const item of geometry){assert.ok(item.photo>=42&&item.photo<=57);assert.equal(item.image,item.photo);assert.ok(Math.abs(item.ratio-1)<.001);assert.equal(item.clip,'hidden');assert.equal(item.fit,'cover');assert.equal(item.count,'10px');assert.equal(item.covered,false);assert.equal(item.inside,true);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.MINUTA_SCREENSHOT_DIR&&width===760){mkdirSync(process.env.MINUTA_SCREENSHOT_DIR,{recursive:true});await page.locator('#compactGallery').screenshot({path:resolve(process.env.MINUTA_SCREENSHOT_DIR,`compact-frames-${theme}.png`)});}
 }
 await page.setViewportSize({width:390,height:950});
 await page.evaluate(()=>{document.querySelector('#compactGallery').remove();fixtureClient.name='Анна Александрова';fixtureClients();});
 assert.equal(await page.locator('.client-list-item .client-framed-count').textContent(),'50');
 const row=await page.locator('.client-list-item').evaluate(el=>{const avatar=el.querySelector('.client-framed-avatar').getBoundingClientRect(),copy=el.querySelector('.client-list-main').getBoundingClientRect();return {gap:copy.left-avatar.right,overflow:el.scrollWidth-el.clientWidth};});
 assert.ok(row.gap>=0);assert.ok(row.overflow<=1);
 if(process.env.MINUTA_SCREENSHOT_DIR)await page.locator('#fixtureClients').screenshot({path:resolve(process.env.MINUTA_SCREENSHOT_DIR,'compact-client-list.png')});
 console.log('PASS: compact avatars 14 tiers + 999 sessions, 76/88px, photo aperture/crop/plaque, 2 themes × 3 widths.');
}finally{await browser.close();server.close();}
