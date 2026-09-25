import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const panel = html.match(/<section id="clientOfflineFlexible"[\s\S]*?<\/section>/)?.[0];
assert.ok(panel, 'The real client page must contain the offline form');
const server = createServer((request, response) => {
  if (request.url === '/styles.css') { response.setHeader('content-type','text/css'); response.end(readFileSync(resolve(root,'styles.css'))); return; }
  if (request.url === '/client-offline-flexible.js') { response.setHeader('content-type','text/javascript'); response.end(readFileSync(resolve(root,'client-offline-flexible.js'))); return; }
  response.setHeader('content-type','text/html; charset=utf-8');
  response.end(`<html lang="ru"><head><link rel="stylesheet" href="/styles.css"></head><body><main class="layout"><section class="booking-card">${panel}</section></main><script>
    Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
    window.warmMessages=[];
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{ready:Promise.resolve({active:{postMessage:(message,ports)=>{
      window.warmMessages.push(message);
      ports?.[0]?.postMessage(window.warmReply || {ready:true,cache:'massage-izhevsk-v941'});
    }}})}});
    window.MINUTA_CONFIG={supabaseUrl:'https://example.invalid',supabaseKey:'test',defaultOrganizationSlug:''};
    window.calls=[]; window.reply={data:{result_code:'no_slot_in_range'},error:null};
    window.supabase={createClient:()=>({rpc:async(name,args)=>{window.calls.push({name,args});return window.responses?.[name] || window.reply;}})};
    if (!location.search.includes('unready')) localStorage.setItem('primetime-offline-flexible-assets-v941','ready');
    localStorage.setItem('primetime-offline-catalog-v1:default',JSON.stringify({savedAt:Date.now(),slug:'',teamMode:false,locations:[],services:[{id:'11111111-1111-4111-8111-111111111111',name:'Массаж',durationMinutes:60,priceRub:1000}]}));
  </script><script src="/client-offline-flexible.js" defer></script></body></html>`);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({viewport:{width,height:900}});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(await page.locator('#clientOfflineFlexible').isVisible(),true);
    assert.equal(await page.locator('#clientOfflineFlexible form').isVisible(),true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow,false,`offline client panel overflows at ${width}`);
    await page.locator('[name=service]').selectOption('11111111-1111-4111-8111-111111111111');
    const date = await page.evaluate(() => { const d=new Date(); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); });
    await page.locator('[name=date]').fill(date);
    await page.locator('[name=earliest]').fill('10:00');
    await page.locator('[name=latest]').fill('18:00');
    await page.locator('[name=name]').fill('Тестовый клиент');
    await page.locator('[name=phone]').fill('+79990000000');
    await page.locator('[name=consent]').check();
    await page.locator('#clientOfflineFlexible button[type=submit]').click();
    assert.match(await page.locator('#clientOfflineFlexibleStatus').innerText(),/пока не подтверждена/i);
    const first = await page.evaluate(() => JSON.parse(localStorage.getItem('primetime-offline-flexible-v1:primetime-offline-catalog-v1:default')));
    assert.equal(first.earliest,'10:00'); assert.equal(first.latest,'18:00');
    await page.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => window.warmMessages.length === 1);
    assert.equal((await page.evaluate(() => window.warmMessages[0].type)),'warm-client-flexible');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('primetime-offline-flexible-v1:primetime-offline-catalog-v1:default'))?.status === 'conflict');
    const calls = await page.evaluate(() => window.calls);
    assert.equal(calls.length,1); assert.equal(calls[0].name,'book_flexible_appointment_v180');
    assert.equal(calls[0].args.p_request_id,first.id);
    assert.equal(calls[0].args.p_kind,'public');
    if (width === 390) {
      await page.locator('#clientOfflineFlexibleRemove').click();
      await page.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,value:false}); window.dispatchEvent(new Event('offline')); });
      await page.locator('[name=service]').selectOption('11111111-1111-4111-8111-111111111111');
      await page.locator('[name=date]').fill(date);
      await page.locator('[name=earliest]').fill('10:00');
      await page.locator('[name=latest]').fill('18:00');
      await page.locator('[name=name]').fill('Тестовый клиент');
      await page.locator('[name=phone]').fill('+79990000000');
      await page.locator('[name=consent]').check();
      await page.locator('#clientOfflineFlexible button[type=submit]').click();
      await page.evaluate(dateValue => {
        window.responses={
          book_flexible_appointment_v180:{data:{result_code:'ok',manage_token:'22222222-2222-4222-8222-222222222222',booking_code:'TEST',booking_time:'13:00:00'},error:null},
          get_booking_management:{data:[{status:'new',booking_code:'TEST',booking_date:dateValue,booking_time:'13:00:00'}],error:null},
          record_minuta_booking_legal_acceptance_v110:{data:true,error:null}
        };
        Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); window.dispatchEvent(new Event('online'));
      }, date);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('primetime-offline-flexible-v1:primetime-offline-catalog-v1:default'))?.status === 'confirmed');
      await page.waitForFunction(() => window.calls.some(call => call.name === 'record_minuta_booking_legal_acceptance_v110'));
      const legal = (await page.evaluate(() => window.calls)).find(call => call.name === 'record_minuta_booking_legal_acceptance_v110');
      assert.equal(legal.args.p_privacy_version,'2026-09-05');
      assert.equal(legal.args.p_terms_version,'2026-09-05');
    }
    await page.close();
  }
  const unready = await browser.newPage({viewport:{width:390,height:900}});
  await unready.goto(`http://127.0.0.1:${server.address().port}/?unready`);
  assert.equal(await unready.locator('#clientOfflineFlexible form').isVisible(),false);
  assert.match(await unready.locator('#clientOfflineFlexibleStatus').innerText(),/ещё не подготовлена/i);
  await unready.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); window.dispatchEvent(new Event('online')); });
  await unready.waitForFunction(() => localStorage.getItem('primetime-offline-flexible-assets-v941') === 'ready');
  await unready.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,value:false}); window.dispatchEvent(new Event('offline')); });
  assert.equal(await unready.locator('#clientOfflineFlexible form').isVisible(),true);
  await unready.evaluate(() => {
    window.warmReply={ready:false,cache:'massage-izhevsk-v941'};
    Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
    window.dispatchEvent(new Event('online'));
  });
  await unready.waitForFunction(() => localStorage.getItem('primetime-offline-flexible-assets-v941') === null);
  await unready.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,value:false}); window.dispatchEvent(new Event('offline')); });
  assert.equal(await unready.locator('#clientOfflineFlexible form').isVisible(),false);
  await unready.close();
  console.log('Client offline flexible browser: 390/760/1440 conflict, warmup readiness and legal acceptance passed');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
