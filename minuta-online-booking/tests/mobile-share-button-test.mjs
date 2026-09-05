import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const root = fileURLToPath(new URL('../',import.meta.url));
const html = readFileSync(resolve(root,'provider.html'),'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i,'')
  .replace('class="requires-top-level provider-booting"','')
  .replace(/<link[^>]*rel="manifest"[^>]*>/g,'');
const server = createServer((req,res) => {
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(name==='/') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  const file=resolve(root,'.'+name);
  if(!file.startsWith(root.endsWith(sep)?root:root+sep)) {res.writeHead(403);res.end();return;}
  try {res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}
  catch {res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.evaluate(()=>{
    document.querySelector('#providerBoot').remove();
    document.querySelector('#authCard').hidden=true;
    document.querySelector('#dashboard').hidden=false;
    document.querySelector('#dashboard').dataset.activeView='bookings';
  });
  await page.addScriptTag({url:url+'/free-slots-share.js'});
  await page.evaluate(()=>{
    window.fixtureSlots=window.MinutaFreeSlots.createController({
      root:document.querySelector('#freeSlotsDialog'),
      getData:()=>({today:'2026-09-05',selectedDate:'2026-09-06',bookingUrl:location.origin+'/booking.html'}),
      loadContext:async()=>({mode:'personal',services:[{id:'test',name:'Массаж',duration_minutes:60}],locations:[]}),
      loadSlots:async()=>({data:[{booking_date:'2026-09-06',booking_time:'10:00'}]}),
      notify:()=>{}
    });
    document.querySelector('#openFreeSlots').addEventListener('click',window.fixtureSlots.open);
  });
  for(const width of [320,360,390,430,760,1024]) {
    await page.setViewportSize({width,height:900});
    for(const theme of ['sage','luxury','hitech']) {
      await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerLayout='soft';},theme);
      const button=page.locator('#openFreeSlots');
      assert.equal(await button.isVisible(),true,theme+'/'+width);
      const bounds=await button.boundingBox();
      if(width<=760) assert.ok(bounds.height>=44 && bounds.width>=44,'Touch target '+theme+'/'+width+' '+JSON.stringify(bounds));
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1,'Button outside viewport');
      const next=await page.locator('#newBookingButton').boundingBox();
      assert.ok(bounds.x+bounds.width<=next.x+1 || next.y>=bounds.y+bounds.height-1,'Buttons overlap');
      await button.click();
      await page.waitForFunction(()=>document.querySelector('#freeSlotsDialog').open);
      assert.equal(await page.locator('#freeSlotsDialog').isVisible(),true);
      await page.locator('[data-close-free-slots]').click();
    }
  }
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(()=>document.body.classList.add('booking-demo-mode'));
  assert.equal(await page.locator('#openFreeSlots').isVisible(),false,'Demo must not publish real availability');
  assert.deepEqual(errors,[]);
  console.log('PASS: share button visible, touch-sized, within viewport, opens dialog; 18 theme/width checks; demo remains isolated');
} finally {await browser.close();await new Promise(done=>server.close(done));}
