import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const source=readFileSync(resolve(root,'provider.js'),'utf8');
const installFunctions=source.slice(source.indexOf('function providerAppIsInstalled()'),source.indexOf('async function toggleProviderFullscreen()'));
assert.ok(installFunctions.includes('async function installProviderApp()'));
const {chromium,devices}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
const profiles=[...[390,760,1440].map(width=>({name:String(width),viewport:{width,height:900}})),...['iPhone 13','Pixel 7'].map(name=>({...devices[name],name}))];
try{for(const profile of profiles){const {name,...device}=profile;const context=await browser.newContext({...device,bypassCSP:true});const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='https://provider.fixture.invalid'||route.request().method()!=='GET')return route.abort();if(url.pathname==='/provider.html')return route.fulfill({contentType:'text/html',body:html});const filename=resolve(root,'.'+decodeURIComponent(url.pathname));if(!filename.startsWith(root+sep))return route.abort();try{return route.fulfill({body:readFileSync(filename),contentType:filename.endsWith('.css')?'text/css':filename.endsWith('.svg')?'image/svg+xml':'application/octet-stream'});}catch{return route.abort();}});
 await page.goto('https://provider.fixture.invalid/provider.html');
 await page.evaluate(()=>{document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');document.querySelector('#providerBoot').hidden=true;const card=document.querySelector('#installAppCard');document.body.replaceChildren(card);document.body.dataset.providerTheme='loft';card.style.maxWidth='780px';card.style.margin='20px auto';document.body.style.padding='0 16px';document.body.style.display='block';document.body.style.minHeight='100vh';});
 await page.evaluate(()=>{const dashboard=document.createElement('div');dashboard.id='dashboard';dashboard.hidden=true;document.body.append(dashboard);});
 await page.addScriptTag({content:readFileSync(resolve(root,'pwa-install.js'),'utf8')});
 await page.addScriptTag({content:`const $=s=>document.querySelector(s);let deferredInstallPrompt=null;const notify=message=>window.auditNotice=message;${installFunctions};refreshInstallAppCard();$('#installAppButton').addEventListener('click',installProviderApp);`});
 await page.locator('#installAppButton').click();
 const expected=name==='iPhone 13'?'iosInstallGuide':name==='Pixel 7'?'androidInstallGuide':'desktopInstallGuide';
 assert.equal(await page.locator('#'+expected).isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(process.env.MINUTA_AUDIT_SCREENSHOTS){mkdirSync(process.env.MINUTA_AUDIT_SCREENSHOTS,{recursive:true});await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`install-${name.replaceAll(' ','-')}.png`),fullPage:true});}
 // Native OS prompts are deliberately not invoked: exercise real consumption and fallback code with synthetic events.
 for(const outcome of ['accepted','dismissed','throw']){await page.evaluate(outcome=>{window.promptCalls=0;const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{window.promptCalls++;if(outcome==='throw')throw new Error('blocked prompt');};event.userChoice=Promise.resolve({outcome});window.dispatchEvent(event);refreshInstallAppCard();},outcome);await page.locator('#installAppButton').click();assert.equal(await page.evaluate(()=>window.promptCalls),1);assert.equal(await page.evaluate(()=>MinutaPwaInstall.hasPrompt()),false);if(outcome==='throw')assert.match(await page.locator('#installAppStatus').innerText(),/не открылось/);else assert.match(await page.evaluate(()=>auditNotice),outcome==='accepted'?/началась/:/отменена/);}
 // Actual update-notice renderer, isolated registration/event boundary. Do not reload or replace a real worker.
 await page.evaluate(()=>{const sw=window.auditWorker=new EventTarget();sw.controller={scriptURL:'old'};sw.register=async()=>({update:async()=>{}});Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:sw});});
 await page.addScriptTag({content:readFileSync(resolve(root,'site-update.js'),'utf8')});
 await page.evaluate(()=>{auditWorker.controller={scriptURL:'new'};auditWorker.dispatchEvent(new Event('controllerchange'));});
 await page.locator('#siteUpdateNotice').waitFor();const notice=await page.locator('#siteUpdateNotice').boundingBox();const button=await page.locator('#siteUpdateNotice button').boundingBox();assert.ok(notice.x>=0&&notice.x+notice.width<=device.viewport.width+1);assert.ok(button.height>=40);
 console.log(`PASS install fallback/prompt outcomes/update notice: ${name}; update target=${button.height}px`);
 if(process.env.MINUTA_AUDIT_SCREENSHOTS)await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`update-${name.replaceAll(' ','-')}.png`),fullPage:true});
 assert.deepEqual(errors,[]);await context.close();
}}finally{await browser.close();}
