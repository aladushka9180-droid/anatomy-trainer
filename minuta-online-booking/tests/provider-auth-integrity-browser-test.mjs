import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=readFileSync(path.join(root,'provider.js'),'utf8');
const html=readFileSync(path.join(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
function actual(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const next=source.slice(start+1).search(/^(?:async )?function /m);return source.slice(start,next<0?undefined:start+next+1);}
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
test.after(()=>browser.close());
for(const width of [390,760,1440])for(const state of ['login','request','expired','reset'])test(`native auth ${state}, ${width}px`,async()=>{
  const page=await browser.newPage({viewport:{width,height:1000},bypassCSP:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='provider.fixture.invalid')return route.abort();
      if(url.pathname==='/provider.html')return route.fulfill({contentType:'text/html',body:html});
      const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      if(!filename.startsWith(root+path.sep))return route.abort();
      try{return route.fulfill({body:readFileSync(filename),contentType:filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.abort();}
    });
    await page.goto('https://provider.fixture.invalid/provider.html',{waitUntil:'domcontentloaded'});
    await page.addScriptTag({content:`
      window.$=s=>document.querySelector(s);window.$$=s=>[...document.querySelectorAll(s)];
      let recoveryMode=false,recoverySessionVerified=false;
      const db={auth:{getUser:async()=>(${state==='reset'?'{data:{user:{id:"fixture"}}}':'{data:{user:null}}'})}};
      function finishProviderBoot(){document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');$('#providerBoot').hidden=true;}
      function showFormError(id,message){$(id).hidden=false;$(id).textContent=message;}
      ${['setAuthTabImmediate','showRecoveryRequest','showRecoveryReset','authConnectionFailed'].map(actual).join('\n')}
      finishProviderBoot();$('#authCard').hidden=false;$('#dashboard').hidden=true;document.body.dataset.providerTheme='loft';document.body.dataset.providerLayout='bento';
    `});
    if(state==='login')await page.evaluate(()=>setAuthTabImmediate('login'));
    if(state==='request')await page.evaluate(()=>showRecoveryRequest());
    if(state==='expired'||state==='reset')await page.evaluate(()=>showRecoveryReset());
    await page.evaluate(()=>document.fonts.ready);
    const dimensions=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,forgot:$('#forgotPasswordButton').getBoundingClientRect().height,title:$('#authTitle').textContent}));
    assert.equal(dimensions.overflow,false);
    if(state==='login'){
      assert.ok(dimensions.forgot>=44,`forgot target ${dimensions.forgot}`);
      assert.equal(await page.locator('#providerSocialOptions').isVisible(),false);assert.equal(await page.locator('#providerPhoneOptions').isVisible(),false);
      assert.equal(await page.locator('#signupPassword').getAttribute('minlength'),'8');
    }
    if(state==='request')assert.match(dimensions.title,/Восстановите доступ/);
    if(state==='expired'){assert.equal(await page.locator('#resetPasswordForm').isVisible(),false);assert.match(await page.locator('#recoveryError').innerText(),/устарела/);}
    if(state==='reset')assert.equal(await page.locator('#resetPasswordForm').isVisible(),true);
    if(process.env.PROVIDER_AUTH_SCREENSHOTS){mkdirSync(process.env.PROVIDER_AUTH_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PROVIDER_AUTH_SCREENSHOTS,`${state}-${width}.png`),fullPage:true});}
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
});
