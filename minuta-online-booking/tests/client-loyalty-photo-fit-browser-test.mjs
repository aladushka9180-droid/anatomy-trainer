import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './client-loyalty-frames-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:980,height:900},reducedMotion:'reduce'});
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 await page.goto(url);
 // Measure the actual transparent aperture, independently of the photo fit table.
 const fits=await page.evaluate(async()=>{
  const images=await Promise.all(['assets/loyalty/frames-v1.png','assets/loyalty/frame-100-v1.png'].map(async src=>{const image=new Image();image.src=src;await image.decode();return image;}));
  return PrimeTimeLoyaltyFrames.thresholds.map((total,index)=>{
   renderCount(total);const orbit=document.querySelector('#clientProfileOrbit'),avatar=document.querySelector('#clientAvatar');
   const art=orbit.querySelector('.loyalty-frame-art'),style=getComputedStyle(art),canvas=document.createElement('canvas');canvas.width=canvas.height=184;
   const context=canvas.getContext('2d'),size=parseFloat(style.getPropertyValue('--frame-size')),top=parseFloat(style.getPropertyValue('--frame-top'));
   if(index===13)context.drawImage(images[1],92-size/2,top,size,size);
   else {const sheet=parseFloat(style.getPropertyValue('--frame-sheet')),x=parseFloat(style.getPropertyValue('--frame-x')),y=parseFloat(style.getPropertyValue('--frame-y'));context.save();context.beginPath();context.rect(92-size/2,top,size,parseFloat(style.height));context.clip();context.drawImage(images[0],92-size/2+x,top+y,sheet,sheet);context.restore();}
   const pixels=context.getImageData(0,0,184,184).data,hole=new Set(),queue=[88*184+92];
   while(queue.length){const key=queue.pop();if(hole.has(key)||pixels[key*4+3]>=180)continue;hole.add(key);const x=key%184,y=Math.floor(key/184);if(x>0)queue.push(key-1);if(x<183)queue.push(key+1);if(y>0)queue.push(key-184);if(y<183)queue.push(key+184);}
   const a=avatar.getBoundingClientRect(),o=orbit.getBoundingClientRect(),cx=a.x-o.x+a.width/2,cy=a.y-o.y+a.height/2,r=a.width/2;
   let gap=0,spill=0;for(let y=0;y<184;y++)for(let x=0;x<184;x++){const key=y*184+x,inside=(x-cx)**2+(y-cy)**2<=r*r;if(hole.has(key)&&!inside)gap++;if(inside&&!hole.has(key)&&pixels[key*4+3]<80)spill++;}
   return {total,cx,cy,r,gap,spill,hole:hole.size,photoLayer:getComputedStyle(avatar).zIndex,frameLayer:getComputedStyle(orbit.querySelector('.loyalty-frame-decoration')).zIndex,picker:getComputedStyle(orbit.querySelector('.client-profile-avatar-picker')).zIndex};
  });
 });
 for(const fit of fits){assert.ok(fit.hole>6500&&fit.hole<10000,`${fit.total}: closed aperture`);assert.ok(fit.gap<=4,`${fit.total}: empty pixels inside rim: ${fit.gap}`);assert.ok(fit.spill<=4,`${fit.total}: photo outside rim: ${fit.spill}`);assert.ok(Number(fit.frameLayer)>Number(fit.photoLayer));assert.ok(Number(fit.picker)>Number(fit.frameLayer));}
 const choosePhoto=async action=>{
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),action()]);
  assert.equal(await chooser.element().getAttribute('id'),'clientAvatarInput');
  assert.equal(await page.locator('dialog[open]').count(),0,'Photo never opens level information');
  // No file is submitted: exercise the existing picker without writing customer data.
 };
 await page.locator('.client-profile-photo-open').focus();
 await choosePhoto(()=>page.keyboard.press('Enter'));
 await choosePhoto(()=>page.keyboard.press('Space'));
 for(const dimensions of [[300,500],[500,300]]){
  await page.evaluate(([w,h])=>{const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#b9dbd2"/><circle cx="50%" cy="44%" r="65" fill="#b98062"/><path d="M0 ${h}Q${w/2} ${h/2} ${w} ${h}" fill="#526384"/></svg>`);document.querySelector('#clientAvatar').replaceChildren(img);document.querySelector('#clientProfileOrbit').classList.add('has-photo');},dimensions);
  for(const total of [0,3,6,9,10,20,30,40,50,60,70,80,90,100]){await page.evaluate(n=>renderCount(n),total);const result=await page.locator('#clientAvatar img').evaluate(img=>{const r=img.getBoundingClientRect(),p=img.parentElement.getBoundingClientRect();return{w:r.width,h:r.height,pw:p.width,ph:p.height,fit:getComputedStyle(img).objectFit};});assert.equal(result.w,result.pw);assert.equal(result.h,result.ph);assert.equal(result.fit,'cover');await choosePhoto(()=>page.locator('.client-profile-photo-open').click());}
 }
 await choosePhoto(()=>page.locator('.client-profile-avatar-picker').click());
 await page.locator('#clientLoyaltyLevel').click();
 assert.equal(await page.getByRole('dialog').isVisible(),true,'Level information stays available in its row');
 await page.keyboard.press('Escape');
 for(const state of ['disabled','hidden']){
  await page.evaluate(state=>{const input=document.querySelector('#clientAvatarInput');input.disabled=state==='disabled';input.closest('.client-avatar-picker').hidden=state==='hidden';renderCount(100);},state);
  assert.equal(await page.locator('.client-profile-photo-open').isDisabled(),true,'Existing photo availability is respected');
 }
 await page.evaluate(()=>{const input=document.querySelector('#clientAvatarInput');input.disabled=false;input.closest('.client-avatar-picker').hidden=false;renderCount(100);});
 if(process.env.MINUTA_LOYALTY_SCREENSHOTS){
  mkdirSync(process.env.MINUTA_LOYALTY_SCREENSHOTS,{recursive:true});
  await page.evaluate(()=>{document.body.dataset.providerTheme='midnight';const gallery=document.createElement('div');gallery.id='fitGallery';gallery.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:18px;padding:20px;background:var(--theme-surface);color:var(--theme-ink)';for(const n of PrimeTimeLoyaltyFrames.thresholds){renderCount(n);const box=document.createElement('div');box.style.textAlign='center';const frame=document.querySelector('#clientProfileOrbit').cloneNode(true);frame.removeAttribute('id');frame.querySelectorAll('input,button,label').forEach(el=>el.remove());frame.querySelectorAll('[id]').forEach(el=>el.removeAttribute('id'));frame.style.margin='auto';box.append(frame);const label=document.createElement('p');label.textContent=n+' сеансов';box.append(label);gallery.append(box);}document.querySelector('main').hidden=true;document.body.append(gallery);});
  await page.locator('#fitGallery').screenshot({path:`${process.env.MINUTA_LOYALTY_SCREENSHOTS}/photo-fit-all-tiers.png`});
 }
 console.log('Photo fit: 14 apertures without gaps/spill; layers and portrait/landscape cover; photo click/Enter/Space choose file, separate level information, unavailable picker guarded PASS');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}

