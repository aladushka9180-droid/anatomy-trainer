// Diagnostic only: inert loopback fixtures in temporary directories. No live data.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const mode=process.env.PWA_DIAGNOSTIC_MODE || 'baseline';
if(!['baseline','quiet-poll','no-routing'].includes(mode))throw new Error('Unknown diagnostic mode');
const temp=mkdtempSync(join(tmpdir(),'pro-pwa-pending-'));
mkdirSync(join(temp,'tests'));
const source=readFileSync('minuta-online-booking/sw.js','utf8');
const instrumentation=`
const pending = new Map(); let seq=0;
const trace=(...data)=>console.log('TRACE',Date.now(),...data);
const track=(kind,event,promise)=>{
  const id=++seq; const label=kind+':'+event.type+':'+(event.request?.url||event.data?.type||'');
  pending.set(id,label);
  Promise.resolve(promise).then(()=>pending.delete(id),()=>pending.delete(id));
};
const oldWait=ExtendableEvent.prototype.waitUntil;
ExtendableEvent.prototype.waitUntil=function(p){track('wait',this,p); return oldWait.call(this,p)};
const oldRespond=FetchEvent.prototype.respondWith;
FetchEvent.prototype.respondWith=function(p){track('respond',this,p); return oldRespond.call(this,p)};
const oldSkip=self.skipWaiting.bind(self);
self.skipWaiting=()=>{trace('skipWaiting-start',JSON.stringify([...pending]));return oldSkip().then(v=>{trace('skipWaiting-done');return v})};
self.addEventListener('install',()=>trace('install'));
self.addEventListener('activate',()=>trace('activate',JSON.stringify([...pending])));
self.addEventListener('message',e=>{if(e.data?.type==='site-update-version' && pending.size>1)trace('pending',JSON.stringify([...pending]))});
`;
writeFileSync(join(temp,'sw.js'),instrumentation+source);
let test=readFileSync('minuta-online-booking/tests/site-update-pending-navigation-browser-test.mjs','utf8').replace(/\r\n/g,'\n');
test=test.replace("channel:process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined)",'channel:undefined');
test=test.replace("const context = await browser.newContext({ serviceWorkers:'allow' });", "const context = await browser.newContext({ serviceWorkers:'allow' });\n  context.on('console', message => console.log(message.text()));");
test=test.replace('heldRequests, ready:future','workerRequests, heldRequests, ready:future');
if(mode==='quiet-poll') {
  test=test.replace('if (!controller) return false;', 'if (!controller || controller === window.previousController) return false;');
  test=test.replace('holdNavigation = false;\n  worker =', 'holdNavigation = false;\n  await page.evaluate(() => { window.previousController = navigator.serviceWorker.controller; });\n  worker =');
  if(!test.includes('window.previousController = navigator.serviceWorker.controller'))throw new Error('Quiet-poll fixture was not installed');
}
if(mode==='no-routing') {
  // Source contains only same-origin relative assets; fixture HTML is inert and
  // both page and worker receive default-src/connect-src self CSP from loopback.
  if(/https?:\/\//.test(source))throw new Error('No-routing variant requires an entirely relative worker');
  test=test.replace("await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());",'');
}
writeFileSync(join(temp,'tests','pending.mjs'),test);
const logRoot=resolve('pwa-diagnostic-results',mode);
mkdirSync(logRoot,{recursive:true});
let failed=false;
for(let i=1;i<=4;i++) {
  const result=spawnSync(process.execPath,[join(temp,'tests','pending.mjs')],{encoding:'utf8',timeout:45000,env:{...process.env,MINUTA_PLAYWRIGHT_MODULE:process.env.MINUTA_PLAYWRIGHT_MODULE || require.resolve('playwright')}});
  const output=(result.stdout||'')+'\n'+(result.stderr||'');
  writeFileSync(join(logRoot,`${i}.log`),output);
  console.log(JSON.stringify({mode,trial:i,status:result.status,error:result.error?.message}));
  console.log(output);
  if(result.status!==0){failed=true;break;}
}
if(failed)process.exitCode=1;
