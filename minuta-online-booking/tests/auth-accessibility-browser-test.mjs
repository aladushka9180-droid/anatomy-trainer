import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const baseline=process.env.AUTH_ACCESSIBILITY_BASELINE==='1';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
// Full real page/bootstrap/styles. Test seam exposes real error/view functions;
// only verified-recovery identity is stubbed, with the original SDK restored.
const seam=`\nwindow.__authAccessibility={showFormError,clearFormError,showRecoveryRequest,async reset(){const original=db.auth.getUser;db.auth.getUser=async()=>({data:{user:{id:'fixture-recovery'}}});try{await showRecoveryReset();}finally{db.auth.getUser=original;}}};`;
const server=createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]);const target=path.resolve(root,'.'+name);if(!target.startsWith(root+path.sep)||req.method!=='GET'){res.writeHead(400).end();return;}try{let bytes=readFileSync(target);if(name==='/provider.js')bytes=Buffer.from(bytes.toString()+seam);res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream'}).end(bytes);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
try{for(const width of [390,760,1440]){
 const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():route.abort());
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/provider.html');
 await page.locator('#loginForm').waitFor({state:'visible'});await page.waitForFunction(()=>!!window.__authAccessibility);
 const states=[['loginForm','loginError',['loginEmail','loginPassword']],['signupForm','signupError',['signupName','signupEmail','signupPassword']],
  ['recoveryForm','recoveryError',['recoveryEmail']],['resetPasswordForm','resetPasswordError',['recoveryNewPassword','recoveryConfirmPassword']]];
 for(const [formId,errorId,inputs] of states){
  if(formId==='signupForm')await page.locator('[data-auth-tab="signup"]').click();
  if(formId==='recoveryForm')await page.evaluate(()=>__authAccessibility.showRecoveryRequest());
  if(formId==='resetPasswordForm')await page.evaluate(()=>__authAccessibility.reset());
  await page.locator('#'+formId).waitFor({state:'visible'});await page.waitForTimeout(650);
  await page.locator('#'+inputs[0]).focus();
  const message='Не удалось связаться с сервером. Попробуйте ещё раз.';
  await page.evaluate(({errorId,message})=>__authAccessibility.showFormError('#'+errorId,message),{errorId,message});
  const error=page.locator('#'+errorId);assert.equal(await error.innerText(),message);
  assert.equal(await page.evaluate(()=>document.activeElement.id),inputs[0],'Announcing an error must not steal focus');
  if(inputs[1]){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),inputs[1]);}
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,
   targets:[...document.querySelectorAll('#authCard button,#authCard .back-to-booking')].filter(e=>e.getBoundingClientRect().height>0)
    .map(e=>({name:e.textContent.trim(),height:e.getBoundingClientRect().height})),card:document.querySelector('#authCard').getBoundingClientRect().height}));
  assert.equal(metrics.overflow,false);
  if(!baseline){
   assert.equal(await error.getAttribute('role'),'alert');assert.equal(await error.getAttribute('aria-atomic'),'true');
   assert.match(await error.ariaSnapshot(),/alert: Не удалось связаться/);
   assert.ok((await page.locator('#'+formId).getAttribute('aria-describedby')).split(/\s+/).includes(errorId));
   assert.equal(await page.locator('#'+formId).getAttribute('aria-labelledby'),'authTitle');
   for(const id of inputs){assert.ok((await page.locator('#'+id).getAttribute('aria-describedby')).split(/\s+/).includes(errorId));}
   assert.ok(metrics.targets.every(t=>t.height>=44),JSON.stringify(metrics.targets));
  }
  if(process.env.AUTH_ACCESSIBILITY_SCREENSHOTS){mkdirSync(process.env.AUTH_ACCESSIBILITY_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.AUTH_ACCESSIBILITY_SCREENSHOTS,`${baseline?'before':'after'}-${formId}-${width}.png`),fullPage:true});}
  await page.evaluate(errorId=>__authAccessibility.clearFormError('#'+errorId),errorId);assert.equal(await error.isVisible(),false);
  if(!baseline)assert.equal(await error.textContent(),'','Cleared error must not remain as a hidden accessible description');
  // Repeated same message is exposed again, not lost by an earlier hidden state.
  await page.evaluate(({errorId,message})=>__authAccessibility.showFormError('#'+errorId,message),{errorId,message});assert.equal(await error.isVisible(),true);
  console.log(`${baseline?'BASELINE':'PASS'} ${formId} ${width}: targets=${metrics.targets.map(t=>t.height).join(',')}; card=${metrics.card}`);
 }
 assert.deepEqual(errors,[]);await context.close();
}}finally{await browser.close();await new Promise(r=>server.close(r));}
