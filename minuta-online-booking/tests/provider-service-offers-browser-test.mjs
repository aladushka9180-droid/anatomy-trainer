import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('provider-service-offers.js', root), 'utf8');
const styles = (await Promise.all(['styles.css','provider-ux.css','provider-layout-responsive.css','provider-themes-signature.css','provider-theme-families.css','provider-service-offers.css'].map(file => readFile(new URL(file, root), 'utf8')))).join('\n');
const moduleName = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const { chromium } = await import(moduleName);
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });
const screenshots = process.env.MINUTA_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive:true });
const snapshot = async (page, file) => { if (screenshots) await page.screenshot({ path:path.join(screenshots, file), fullPage:true }); };
const ids = ['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];
const setup = async (page, theme = 'pink-porcelain') => {
  await page.route('**/*', route => route.abort());
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><body class="provider-body" data-provider-theme="${theme}" data-provider-layout="capsule"><main class="provider-workspace"><section class="provider-view" data-provider-panel="services"><div class="view-title"><div><span>Каталог</span><h2>Мои услуги</h2></div><div class="view-title-actions"><span class="panel-count">3</span><button class="secondary-button compact-button">Поделиться прайсом</button><button class="primary compact-button">Добавить услугу</button></div></div><section class="panel service-catalog"><div class="service-manage-list"><article class="managed-service"><div class="service-info"><strong>Массаж спины</strong><small>60 мин · 2 000 ₽</small></div></article><article class="managed-service"><div class="service-info"><strong>Массаж шеи</strong><small>30 мин · 500 ₽</small></div></article></div></section></section></main></body></html>`);
  await page.evaluate(ids => {
    window.actor = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'; window.generation = 1; window.rows = []; window.calls = []; window.messages = []; window.mode = 'ok'; window.writeAllowed = true;
    window.catalog = ids.map((id,index) => ({ id, performer_id:window.actor, name:['Массаж спины','Массаж шеи','Поминутный массаж'][index], active:true, duration_minutes:[60,30,1][index], price_rub:[2000,500,20][index] }));
    window.fakeDb = { rpc:async (name,args) => {
      window.calls.push({ name,args });
      if (window.mode === 'deferred') return new Promise(resolve => { window.finishRequest = resolve; });
      if (window.mode === 'missing') return { data:null, error:{ code:'PGRST202' } };
      if (window.mode === 'denied') return { data:{ offers:[] }, error:{ code:'42501' } };
      if (name === 'get_minuta_service_offers') return { data:{ offers:window.rows }, error:null };
      if (window.mode === 'conflict') return { error:{ code:'40001',message:'offer_revision_conflict' } };
      if (window.mode === 'partial') return { data:{ offer:{ id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } } };
      const row = { ...args.p_offer, id:args.p_offer.id || 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', revision:args.p_offer.revision + 1 };
      window.rows = [...window.rows.filter(item => item.id !== row.id),row]; return { data:{ offer:row }, error:null };
    } };
    window.offerOptions = { db:window.fakeDb, escapeHtml:value => String(value).replace(/[&<>"']/g,c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]), notify:text => window.messages.push(text), requireWrites:() => window.writeAllowed, getCurrentUser:() => window.actor ? {id:window.actor} : null, getSessionGeneration:() => window.generation, sessionIsCurrent:(actor,generation) => actor === window.actor && generation === window.generation, getServices:() => window.catalog };
  }, ids);
};
async function start(page) { await page.addScriptTag({ content:source }); await page.evaluate(() => { window.offers = window.MinutaServiceOffers.createController(window.offerOptions); }); await page.locator('[data-open-service-offers]').click(); await page.locator('[data-add-service-offer]').waitFor(); }
async function fill(page) {
  await page.locator('[data-add-service-offer]').click();
  assert.equal(await page.locator('[name=addon] option').count(),3, 'Per-minute service excluded');
  await page.locator(`[name=primary][value="${ids[0]}"]`).check();
  await page.locator('[name=addon]').selectOption(ids[1]);
  assert.equal(await page.locator('[name=minutes]').inputValue(),'30');
  await page.locator('[name=benefit]').fill('Снимет напряжение в шее');
  await page.locator('[name=discount]').selectOption('percent');
  await page.locator('[name=discountValue]').fill('10');
  await page.locator('[name=minutes]').fill('15');
  assert.match(await page.locator('#serviceOfferPreview').innerText(),/450 ₽/);
  assert.match(await page.locator('#serviceOfferPreview').innerText(),/\+15 мин/);
}
let runs = 0;
try {
  for (const theme of ['pink-porcelain','midnight']) for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{width,height:900} }); const errors=[]; page.on('pageerror',error => errors.push(error.message));
    await setup(page,theme); await snapshot(page,`baseline-${theme}-${width}.png`); await start(page); await fill(page);
    assert.equal(await page.locator('#serviceOffersDialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth),true);
    await page.locator('#serviceOfferForm [type=submit]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#serviceOfferForm [type=submit]').evaluate(button => { const r=button.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); }),true,'Save must be reachable and unobscured');
    await snapshot(page,`form-${theme}-${width}.png`);
    await page.locator('#serviceOffersDialog').evaluate(dialog => { dialog.scrollTop=dialog.scrollHeight; });
    assert.equal(await page.locator('.service-offers-preview').evaluate(preview => { const r=preview.getBoundingClientRect(); const footer=document.querySelector('.service-offers-footer').getBoundingClientRect(); return r.top>=0 && r.bottom<=footer.top; }),true,'Preview remains fully readable above save');
    await snapshot(page,`preview-${theme}-${width}.png`);
    await page.locator('#serviceOfferForm [type=submit]').click(); await page.locator('#serviceOfferForm').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.rows[0].additional_minutes),15);
    assert.equal(await page.evaluate(() => window.catalog[1].price_rub),500);
    assert.equal(await page.evaluate(() => window.calls.at(-1).args.p_performer), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    await page.locator('[data-edit-service-offer]').click(); await page.locator('[name=enabled]').uncheck(); await page.locator('#serviceOfferForm [type=submit]').click(); await page.locator('#serviceOfferForm').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.rows[0].enabled),false);
    await page.locator('[data-reload-service-offers]').click(); assert.match(await page.locator('[data-edit-service-offer]').innerText(),/Выключено/);
    await page.evaluate(() => { window.rows[0].enabled=true; window.catalog[1].active=false; window.offers.setServices(); });
    await page.locator('[data-edit-service-offer]').click();
    assert.match(await page.locator('#serviceOfferForm').innerText(),/Некоторые услуги больше недоступны/);
    await page.locator('[name=enabled]').uncheck(); await page.locator('#serviceOfferForm [type=submit]').click(); await page.locator('#serviceOfferForm').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(() => window.rows[0].enabled),false);
    assert.equal(await page.evaluate(() => window.calls.at(-1).args.p_offer.addon_service_id),ids[1],'Disable retains archived service and stored fields');
    assert.deepEqual(errors,[]); await page.close(); ++runs;
  }
  const page = await browser.newPage({ viewport:{width:390,height:844} }); await setup(page); await start(page);
  for (const mode of ['missing','denied']) {
    await page.evaluate(mode => { window.mode=mode; },mode); await page.evaluate(() => window.offers.load({force:true}));
    assert.equal(await page.locator('[data-add-service-offer]').isDisabled(),true);
    assert.doesNotMatch(await page.locator('#serviceOffersList').innerText(),/Предложений пока нет/);
    assert.match(await page.locator('#serviceOffersStatus').innerText(),mode === 'missing' ? /недоступны на сервере/ : /Нет доступа/);
  }
  await page.evaluate(async () => { window.mode='ok'; await window.offers.load({force:true}); }); await fill(page);
  for (const mode of ['conflict','partial']) {
    await page.evaluate(mode => { window.mode=mode; },mode); await page.locator('#serviceOfferForm [type=submit]').click();
    await page.locator('.service-offers-form-error').waitFor({state:'visible'});
    assert.equal(await page.locator('#serviceOfferForm').isVisible(),true); assert.equal(await page.evaluate(() => window.rows.length),0); assert.equal(await page.evaluate(() => window.messages.length),0);
  }
  await snapshot(page,'save-error-390.png');
  await page.evaluate(() => { window.mode='deferred'; window.saveAttempt = window.offers.load({force:true}); });
  await page.waitForFunction(() => Boolean(window.finishRequest));
  await page.evaluate(() => { window.actor='cccccccc-cccc-cccc-cccc-cccccccccccc'; window.generation++; window.offers.reset(); window.finishRequest({data:{offers:[]}}); });
  assert.equal(await page.evaluate(() => window.saveAttempt),false); assert.equal(await page.locator('#serviceOffersDialog').isVisible(),false);
  await page.close();
  const savingPage = await browser.newPage({ viewport:{width:390,height:844} }); await setup(savingPage); await start(savingPage); await fill(savingPage);
  await savingPage.evaluate(() => { window.writeAllowed=false; });
  await savingPage.locator('#serviceOfferForm [type=submit]').click();
  assert.equal(await savingPage.evaluate(() => window.calls.filter(call => call.name === 'save_minuta_service_offer').length),0,'Read-only session must never write');
  await savingPage.evaluate(() => { window.writeAllowed=true; window.mode='deferred'; document.querySelector('#serviceOfferForm').requestSubmit(); document.querySelector('#serviceOfferForm').requestSubmit(); });
  await savingPage.waitForFunction(() => Boolean(window.finishRequest));
  assert.equal(await savingPage.evaluate(() => window.calls.filter(call => call.name === 'save_minuta_service_offer').length),1,'One RPC for duplicate submit');
  await savingPage.evaluate(() => {
    const sent=window.calls.at(-1).args.p_offer;
    window.actor='cccccccc-cccc-cccc-cccc-cccccccccccc'; window.generation++; window.offers.reset();
    window.finishRequest({ data:{ offer:{...sent,id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',revision:1} } });
  });
  await savingPage.waitForTimeout(50);
  assert.equal(await savingPage.evaluate(() => window.messages.length),0,'Stale save cannot notify new account');
  assert.equal(await savingPage.locator('#serviceOffersDialog').isVisible(),false);
  await savingPage.close();
} finally { await browser.close(); }
console.log(`Pro service-offers browser: ${runs} theme/width states + authenticated save/reload/disable, missing backend, denial, conflict, partial ACK, stale load/save, write gate, duplicate submit PASS`);
