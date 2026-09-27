import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname,extname,resolve,sep } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer((request,response)=>{
  try {
    const pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    if(pathname==='/minuta-online-booking/test.html'){
      response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated PWA test</title>');
      return;
    }
    const relative=pathname.replace(/^\/minuta-online-booking\//,'');
    const target=resolve(root,relative);
    if(!target.startsWith(root+sep)) throw new Error('path_escape');
    const body=readFileSync(target);
    const type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml',
      '.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png',
      '.woff2':'font/woff2','.webp':'image/webp'})[extname(target)] || 'application/octet-stream';
    response.writeHead(200,{'content-type':type});response.end(body);
  } catch { response.writeHead(404);response.end(); }
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const { chromium }=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
const context=await browser.newContext({serviceWorkers:'allow'});
const page=await context.newPage();
const base=`http://127.0.0.1:${server.address().port}/minuta-online-booking/`;
try {
  await page.goto(base+'test.html');
  await page.evaluate(async()=>{
    await navigator.serviceWorker.register('./sw.js?v=999');
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  const cache=await page.evaluate(async()=>{
    const opened=await caches.open('massage-izhevsk-v999');
    const required=['./.precache-ready-v999','./provider.html','./offline-catalog-drafts.js?v=999',
      './offline-catalog-panel.js?v=999','./offline-catalog-panel.css?v=999'];
    return Promise.all(required.map(async url=>({url,found:Boolean(await opened.match(url))})));
  });
  assert.ok(cache.every(item=>item.found),JSON.stringify(cache));
  await context.setOffline(true);
  const offline=await page.evaluate(async()=>{
    const files=['./provider.html','./offline-catalog-drafts.js?v=999',
      './offline-catalog-panel.js?v=999','./offline-catalog-panel.css?v=999'];
    return Promise.all(files.map(async url=>{
      const response=await fetch(url);
      return {url,status:response.status,text:await response.text()};
    }));
  });
  assert.ok(offline.every(item=>item.status===200),JSON.stringify(offline.map(({url,status})=>({url,status}))));
  assert.match(offline[0].text,/offline-catalog-panel\.js\?v=999/);
  assert.match(offline[2].text,/MinutaOfflineCatalogPanel/);
  console.log('offline catalog PWA: required v999 assets cached and served without network PASS');
} finally {
  await browser.close();server.closeAllConnections();
  await new Promise(resolveClose=>server.close(resolveClose));
}
