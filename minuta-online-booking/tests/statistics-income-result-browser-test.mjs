import assert from 'node:assert/strict';
import { readFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const js=readFileSync(new URL('../finance-center.js',import.meta.url),'utf8'), css=readFileSync(new URL('../finance-center.css',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const errors=[];const output=process.env.MINUTA_VISUAL_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{
  for(const width of [390,760,1440])for(const font of [16,32]){
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
    page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.abort());
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>:root{font-size:${font}px;font-family:Arial;--theme-surface:#202027;--theme-surface-alt:#26262f;--theme-ink:#f4f4f7;--theme-muted:#aaa9b8;--theme-line:#656574;--theme-accent:#ac8aff}body{margin:0;background:#17171e;color:#f4f4f7}main{padding:12px;max-width:1100px;margin:auto}[hidden]{display:none!important}#analyticsView[data-report-tab="overview"] #financeCenterRoot{display:none}</style><style>${css}</style><body class="provider-body" data-provider-theme="fixture-dark" data-provider-layout="standard"><main id="analyticsView" data-report-tab="overview"><section id="financeCenterRoot" class="finance-center"></section></main><script>${js}</script>`);
    await page.evaluate(()=>{
      const account='40000000-0000-4000-8000-000000000001';window.requests=[];window.receipts=new Map();window.failOnce=true;
      window.fixture={available:true,financeEnabled:true,resultReliable:false,organizationId:'org-a',dateBasis:'operations',today:'2026-10-18',timezone:'Europe/Samara',bounds:{start:'2026-10-01',end:'2026-10-18'},periodLabel:'1–18 октября',summary:{receivedMinor:0,expenseMinor:90000,serviceMinor:200000,debtMinor:0,totalVisits:1,paymentKnownVisits:1,unpostedVisits:1},movement:[],operations:[],expenseCategories:[{id:'rent',name:'Аренда',amountMinor:90000}],rentCategoryId:'rent',goods:{known:true,quantity:0,amountMinor:0},pendingPayments:{known:true,totalCount:1,totalMinor:200000,rows:[{bookingId:'booking-a',bookingDate:'2026-10-02',label:'Тестовая услуга',amountMinor:200000,paymentMethod:'cash',sourceFingerprint:'a'.repeat(64)}]}};
      const contextToken={};window.adapter={readDashboard:async()=>structuredClone(fixture),prepareVisitPayment:async()=>({today:'2026-10-18',contextToken,accounts:[{id:account,name:'Касса',type:'cash'}]}),postVisitPayment:async(row,choice,scope)=>{
        if(scope!==contextToken)throw new Error('scope lost');requests.push(structuredClone(choice));
        if(!receipts.has(choice.requestId)){
          receipts.set(choice.requestId,{id:'receipt-a'});fixture.summary.receivedMinor=200000;fixture.summary.unpostedVisits=0;fixture.resultReliable=true;
          fixture.pendingPayments={known:true,totalCount:0,totalMinor:0,rows:[]};fixture.movement=[{key:choice.paidOn,receivedMinor:200000,expenseMinor:0}];
        }
        if(failOnce){failOnce=false;throw new Error('Ответ потерян. Повторите проведение.');}return receipts.get(choice.requestId);
      }};
      window.center=MinutaFinanceCenter.init({root:document.querySelector('#financeCenterRoot'),adapter,initialScope:{period:'custom',masterId:'master-a',bounds:{start:'2026-10-01',end:'2026-10-18'}}});
    });
    const overview=page.locator('#reportFinanceOverview');
    await page.evaluate(()=>center.ready);
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]').textContent.includes('0'));
    assert.match(await overview.locator('[data-finance-profit]').textContent(),/900/,'computed negative result replaces placeholder');
    assert.match(await overview.locator('[data-finance-pending-note]').textContent(),/2.?000/);
    if(output)await page.screenshot({path:resolve(output,`income-result-${width}-${font}.png`),fullPage:true});
    await overview.locator('[data-finance-detail="unposted"]').click();
    await page.locator('[data-finance-detail-dialog]').getByRole('button',{name:'Проверить',exact:true}).click();
    const confirm=page.locator('.finance-center__payment-dialog');
    await confirm.getByRole('button',{name:'Провести оплату'}).click();
    assert.equal(await page.evaluate(()=>requests.length),0,'old payment requires an explicit date');
    await confirm.locator('[name="paidOn"]').fill('2026-10-10');
    await confirm.getByRole('button',{name:'Провести оплату'}).click();
    try { await page.getByText('Ответ потерян. Повторите проведение.',{exact:true}).waitFor(); }
    catch(error){ throw new Error(`${error.message}; fixture page errors: ${JSON.stringify(errors)}`); }
    await page.locator('[data-finance-detail-close]').click();
    await overview.locator('[data-finance-detail="unposted"]').click();
    await page.locator('[data-finance-detail-dialog]').getByRole('button',{name:'Проверить',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#reportFinanceOverview [data-finance-received]').textContent.includes('2'));
    assert.equal(await page.evaluate(()=>receipts.size),1,'one posting after an uncertain response');
    assert.equal(await page.evaluate(()=>requests[0].requestId===requests[1].requestId),true,'return retains idempotency key');
    assert.match(await overview.locator('[data-finance-profit]').textContent(),/1.?100/);
    await page.locator('[data-finance-detail-close]').click();
    await page.evaluate(async()=>{fixture.receivedKnown=false;delete fixture.summary.receivedMinor;fixture.movement=[];await center.reload();});
    assert.equal((await overview.locator('[data-finance-received]').textContent()).trim(),'—');
    assert.match(await overview.locator('[data-finance-expense]').textContent(),/900/,'known expense is retained');
    await page.evaluate(async()=>{fixture.receivedKnown=true;fixture.summary.receivedMinor=0;fixture.summary.expenseMinor=0;fixture.expenseCategories=[];await center.reload();});
    assert.match(await overview.locator('[data-finance-profit]').textContent(),/^0/,'empty verified period displays zero');
    if(width===390&&font===16){
      await page.evaluate(async()=>{
        fixture.pendingPayments={known:true,totalCount:1,totalMinor:200000,rows:[{bookingId:'booking-a',bookingDate:'2026-10-02',label:'Изменённая услуга',amountMinor:200000,paymentMethod:'cash',sourceFingerprint:'b'.repeat(64)}]};
        window.staleReviewWrites=0;
        adapter.postVisitPayment=async row=>{
          if(row.sourceFingerprint==='b'.repeat(64)){
            fixture.pendingPayments.totalMinor=250000;fixture.pendingPayments.rows[0].amountMinor=250000;fixture.pendingPayments.rows[0].sourceFingerprint='c'.repeat(64);
            throw Object.assign(new Error('visit_payment_source_changed'),{code:'40001'});
          }
          staleReviewWrites++;
        };
        await center.reload();
      });
      await overview.locator('[data-finance-detail="unposted"]').click();
      const detail=page.locator('[data-finance-detail-dialog]');
      await detail.getByRole('button',{name:'Проверить',exact:true}).click();
      await confirm.locator('[name="paidOn"]').fill('2026-10-10');
      await confirm.getByRole('button',{name:'Провести оплату'}).click();
      await detail.getByText('Отметка оплаты изменилась. Проверьте обновлённый список.',{exact:true}).waitFor();
      assert.match(await detail.locator('.finance-center__operation').innerText(),/2.?500/,'stale review reloads the changed amount');
      await detail.getByRole('button',{name:'Проверить',exact:true}).click();
      assert.equal(await confirm.locator('[name="paidOn"]').inputValue(),'','changed source needs a new date confirmation');
      assert.equal(await page.evaluate(()=>staleReviewWrites),0,'refresh never reposts an unconfirmed changed source');
      await confirm.getByRole('button',{name:'Отмена',exact:true}).click();
      await detail.locator('[data-finance-detail-close]').click();
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal page overflow');
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log('income result browser PASS: 390/760/1440 and 200% text; computed result, explicit historical date, uncertain retry/return, stale review refresh, unknown/zero and preserved expense; synthetic network-blocked fixture only');
}finally{await browser.close();}
