// Actual my-bookings HTML/CSS/controller and Supabase SDK, isolated transport only.
// No real accounts, notifications, mutations or production endpoints.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'my-bookings.html'),'utf8').replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi,(tag,src)=>/^(vendor\/supabase[^/]*\.js|config\.js|theme-catalog\.js|my-bookings\.js)(\?|$)/.test(src)?tag:'');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const token='a'.repeat(64),key='minuta-client-session-v1';
let origin,mode='network',restoreCalls=0,release;
const unexpected=[];
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  if(req.method==='POST'){
   const name=url.pathname.split('/').at(-1);
   if(name==='restore_client_session'){
    restoreCalls++;
    if(mode==='held')await new Promise(done=>release=done);
    if(mode==='network')return req.socket.destroy();
    if(mode==='server')return json(res,{message:'temporary outage'},503);
    if(mode==='unknown')return json(res,{message:'unexpected error'},400);
    if(mode==='malformed')return json(res,null);
    if(mode==='malformed-row')return json(res,[{}]);
    if(mode==='invalid')return json(res,[]);
    return json(res,[{normalized_phone:'79990000000',session_expires_at:'2099-01-01T00:00:00Z'}]);
   }
   if(name==='get_client_bookings_v3')return json(res,[]);
   throw Error('Unexpected write or RPC '+name);
  }
  const relative=decodeURIComponent(url.pathname).replace(/^\/minuta-online-booking\//,'');
  const target=resolve(root,relative);if(!target.startsWith(root+sep))throw Error('Path escape');
  if(relative==='config.js'){res.writeHead(200,{'content-type':'text/javascript'});return res.end(`window.MINUTA_CONFIG=${JSON.stringify({supabaseUrl:origin,supabaseKey:'fixture-key'})}`);}
  const content=relative==='my-bookings.html'?html:readFileSync(relative==='my-bookings.js'&&process.env.MINUTA_CLIENT_SESSION_SOURCE?process.env.MINUTA_CLIENT_SESSION_SOURCE:target);
  res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[extname(target)]||'application/octet-stream'});res.end(content);
 }catch(error){unexpected.push(error.message);res.writeHead(500);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
try{for(const width of [390,760,1440]){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():(unexpected.push('external request'),r.abort()));
 await context.addInitScript(({token,key})=>{if(!sessionStorage.getItem('fixture-seeded')){sessionStorage.setItem(key,token);sessionStorage.setItem('fixture-seeded','1');}},{token,key});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const stored=()=>page.evaluate(key=>sessionStorage.getItem(key),key);
 const capture=async name=>{if(process.env.MINUTA_AUDIT_SCREENSHOTS)await page.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,`client-session-${name}-${width}.png`),fullPage:true});};
 mode='network';await page.goto(origin+'/minuta-online-booking/my-bookings.html');
 if(process.env.MINUTA_EXPECT_SESSION_LOSS){
  await page.waitForFunction(key=>!sessionStorage.getItem(key),key);
  assert.equal(await page.locator('#clientLoginCard').isVisible(),true);await capture('before-network');
  assert.deepEqual(errors,[]);await context.close();console.log(`CONFIRMED baseline drops session on network failure at ${width}px`);continue;
 }
 await page.locator('#clientRestoreRetry').waitFor({state:'visible'});
 assert.equal(await stored(),token);assert.equal(await page.locator('#clientLoginCard').isVisible(),false);
 assert.match(await page.locator('#clientRestoreMessage').innerText(),/Доступ сохранён/);
 assert.ok((await page.locator('#clientRestoreRetry').boundingBox()).height>=44);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await capture('network');
 for(const failure of ['server','unknown','malformed','malformed-row']){
  mode=failure;await page.locator('#clientRestoreRetry').click();await page.locator('#clientRestoreRetry').waitFor({state:'visible'});assert.equal(await stored(),token,failure);
 }
 await page.reload();await page.locator('#clientRestoreRetry').waitFor({state:'visible'});assert.equal(await stored(),token,'reload retains unknown session');
 await context.setOffline(true);const beforeOffline=restoreCalls;
 await page.locator('#clientRestoreRetry').click();assert.match(await page.locator('#clientRestoreMessage').innerText(),/Нет соединения/);assert.equal(restoreCalls,beforeOffline);assert.equal(await stored(),token);await capture('offline');
 release=null;mode='held';await context.setOffline(false);await page.waitForFunction(()=>document.querySelector('#clientRestoreRetry').disabled);
 for(let i=0;i<100&&!release;i++)await page.waitForTimeout(10);assert.ok(release,'Restore request reaches isolated backend');
 await page.evaluate(()=>Promise.all([openAccount(),openAccount()]));assert.equal(restoreCalls,beforeOffline+1,'single pending restore after reconnect');
 mode='success';release();await page.locator('#clientBookingsEmpty').waitFor({state:'visible'});assert.equal(await stored(),token);await capture('empty');
 mode='invalid';await page.evaluate(()=>openAccount());await page.locator('#clientLoginCard').waitFor({state:'visible'});assert.equal(await stored(),null);assert.match(await page.locator('#clientSocialAuthError').innerText(),/больше не действует/);await capture('invalid');
 // A late successful restore cannot reopen a locally signed-out account.
 await page.evaluate(token=>saveSessionToken(token),token);release=null;mode='held';await page.evaluate(()=>{void openAccount();});await page.waitForFunction(()=>document.querySelector('#clientRestoreRetry').disabled);
 for(let i=0;i<100&&!release;i++)await page.waitForTimeout(10);assert.ok(release,'Late restore request reaches isolated backend');
 await page.evaluate(()=>logout({localOnly:true}));mode='success';release();await page.waitForTimeout(80);assert.equal(await stored(),null);assert.equal(await page.locator('#clientLoginCard').isVisible(),true);assert.equal(await page.locator('#clientBookingsCard').isVisible(),false);
 assert.deepEqual(errors,[]);await context.close();console.log(`PASS client saved-session recovery: network/503/unknown/malformed/offline, reload, deduplicated retry, invalid, stale logout at ${width}px`);
}}finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
assert.deepEqual(unexpected,[]);
