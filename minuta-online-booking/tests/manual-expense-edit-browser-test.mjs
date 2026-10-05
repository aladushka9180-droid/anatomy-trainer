import assert from 'node:assert/strict';
import { readFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const source=readFileSync(new URL('../finance-center.js',import.meta.url),'utf8'), css=readFileSync(new URL('../finance-center.css',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const output=process.env.MINUTA_VISUAL_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const errors=[];
try {
  for(const width of [390,760,1440]) for(const font of [16,32]) {
    const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort()); // Synthetic fixture: no working endpoints.
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>:root{font-size:${font}px;font-family:Arial;--theme-surface:#fff;--theme-surface-alt:#faf9fb;--theme-ink:#192033;--theme-muted:#626b7d;--theme-line:#e4e5eb;--theme-accent:#d72475}body{margin:0}#analyticsView{padding:12px}[data-report-tab="overview"] #root{display:none}</style><style>${css}</style></head><body><main id="analyticsView" data-report-tab="overview"><section id="root"></section></main><script>${source}</script></body></html>`);
    await page.evaluate(()=>{
      const expense={id:'expense-a',organizationId:'org-a',categoryId:'rent',paymentAccountId:'cash',occurredOn:'2026-09-22',amountMinor:1800000,performerId:'',note:'Сентябрь'};
      window.fixture={available:true,financeEnabled:true,organizationId:'org-a',dateBasis:'operations',today:'2026-10-05',timezone:'Europe/Samara',
        bounds:{start:'2026-09-01',end:'2026-09-30'},summary:{receivedMinor:0,expenseMinor:1800000},rentCategoryId:'rent',
        movement:[{key:'2026-09-22',receivedMinor:0,expenseMinor:1800000}],expenseCategories:[{id:'rent',name:'Аренда',amountMinor:1800000}],
        expenseDirectory:[{id:'rent',name:'Аренда'},{id:'materials',name:'Материалы'}],paymentAccounts:[{id:'cash',name:'Касса'}],
        permissions:{canAddExpense:true,canEditExpense:true},filters:{selectedPeriod:'custom',selectedMaster:''},
        operations:[{id:'payment-a',type:'expense',flow:'expense',label:'Аренда',categoryId:'rent',category:'Аренда',occurredAt:'2026-09-22T09:00:00Z',amountMinor:-1800000,manualExpense:expense}],goods:{known:true,quantity:0,amountMinor:0}};
      window.saves=[];window.adds=0;window.receipts=new Map();window.ambiguousOnce=false;
      const adapter={readDashboard:async()=>structuredClone(fixture),createExpense:async()=>{adds++;},
        findExpenseEditByRequestId:async()=>null,
        updateExpense:async payload=>{
          saves.push(structuredClone(payload));
          if(!receipts.has(payload.requestId)) {
            fixture.summary.expenseMinor=payload.amountMinor;
            fixture.expenseCategories=[{id:payload.categoryId,name:payload.categoryId==='rent'?'Аренда':'Материалы',amountMinor:payload.amountMinor}];
            fixture.operations[0].amountMinor=-payload.amountMinor;
            fixture.operations[0].manualExpense={...fixture.operations[0].manualExpense,...payload,id:'expense-b'};
            receipts.set(payload.requestId,{id:'expense-b'});
          }
          if(ambiguousOnce){ambiguousOnce=false;throw Object.assign(new Error('timeout'),{ambiguous:true});}
          return receipts.get(payload.requestId);
        }};
      window.center=MinutaFinanceCenter.init({root:document.querySelector('#root'),adapter,
        initialScope:{period:'custom',masterId:'',bounds:{start:'2026-09-01',end:'2026-09-30'}}});
    });
    await page.locator('[data-finance-detail="rent"]').first().click();
    assert.ok(await page.locator('[data-finance-detail-dialog] [data-finance-edit-expense="expense-a"]').evaluate(el=>el.getBoundingClientRect().height>=44),'editing remains a touch target');
    await page.locator('[data-finance-detail-dialog] [data-finance-edit-expense="expense-a"]').click();
    const form=page.locator('[data-finance-form]');
    assert.equal(await form.locator('[name=amount]').inputValue(),'18000,00');
    assert.equal(await form.locator('[name=occurredOn]').inputValue(),'2026-09-22');
    assert.equal(await form.locator('[name=categoryId]').inputValue(),'rent');
    assert.equal(await form.locator('[name=paymentAccountId]').inputValue(),'cash');
    assert.equal(await form.locator('[name=note]').inputValue(),'Сентябрь');
    assert.ok(await form.locator('[data-finance-cancel]').evaluate(el=>el.getBoundingClientRect().height>=44),'cancel remains a touch target');
    const dialogFits=await page.locator('[data-finance-dialog]').evaluate(el=>el.scrollWidth<=el.clientWidth+1);
    if(!dialogFits&&output)await page.screenshot({path:resolve(output,`overflow-${width}-${font}.png`)});
    assert.equal(dialogFits,true,`${width}/${font}: dialog overflow`);
    if(output&&font===16)await page.screenshot({path:resolve(output,`edit-${width}.png`)});
    await form.locator('[name=amount]').fill('20000');await form.locator('[name=occurredOn]').fill('2026-09-23');
    await page.evaluate(()=>{const form=document.querySelector('[data-finance-form]');for(let i=0;i<2;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await page.waitForFunction(()=>!document.querySelector('[data-finance-dialog]').open);
    assert.equal(await page.evaluate(()=>saves.length),1,'double submit guarded');
    assert.equal(await page.evaluate(()=>adds),0,'editing never calls creation');
    assert.equal(await page.evaluate(()=>fixture.summary.expenseMinor),2000000);
    assert.equal(await page.locator('[data-finance-detail-dialog]').getAttribute('open'),'','detail restored');
    assert.match(await page.locator('[data-finance-detail-body]').innerText(),/20\s*000/);
    await page.locator('[data-finance-detail-dialog] [data-finance-edit-expense="expense-b"]').click();
    await page.evaluate(()=>{ambiguousOnce=true;});
    await form.locator('[name=amount]').fill('22000');await form.locator('[data-finance-submit]').click();
    await page.locator('[data-finance-submit]').filter({hasText:'Повторить безопасно'}).waitFor();
    await form.locator('[name=amount]').fill('23000');await form.locator('[data-finance-submit]').click();
    assert.equal(await page.evaluate(()=>saves.length),2,'changed payload blocked while outcome unknown');
    await form.locator('[name=amount]').fill('22000');await form.locator('[data-finance-submit]').click();
    await page.waitForFunction(()=>!document.querySelector('[data-finance-dialog]').open);
    const retry=await page.evaluate(()=>saves.slice(-2));assert.deepEqual(retry[0],retry[1],'same request and payload on retry');
    assert.equal(await page.evaluate(()=>receipts.size),2,'one receipt per edit');
    assert.equal(await page.evaluate(()=>fixture.summary.expenseMinor),2200000,'retry did not duplicate expense');
    await page.locator('[data-finance-detail-close]').click();
    await page.locator('[data-finance-overview-add]').click();
    assert.equal(await page.locator('#financeExpenseTitle').innerText(),'Добавить расход');
    assert.equal(await form.locator('[name=amount]').inputValue(),'','creation does not inherit edited amount');
    await form.locator('[data-finance-cancel]').click();
    await page.locator('[data-finance-detail="rent"]').first().click();
    await page.locator('[data-finance-detail-dialog] [data-finance-edit-expense="expense-b"]').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('[data-finance-dialog]').getAttribute('open'),null,'Escape closes the editor');
    assert.equal(await page.locator('[data-finance-detail-dialog]').getAttribute('open'),'','Escape returns to detail');
    await page.locator('[data-finance-detail-dialog] [data-finance-edit-expense="expense-b"]').click();
    await page.evaluate(()=>center.setScope({period:'custom',masterId:'',bounds:{start:'2026-09-01',end:'2026-09-29'}}));
    assert.equal(await page.locator('[data-finance-dialog]').getAttribute('open'),null,'scope change closes an unsubmitted form');
    const savedCount=await page.evaluate(()=>saves.length);
    await page.evaluate(()=>document.querySelector('[data-finance-form]').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(await page.evaluate(()=>saves.length),savedCount,'a stale form cannot send a write');
    await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log('manual-expense-edit browser PASS: 390/760/1440, text 200% fixture, prefilled data, overview modal, one update, retry, detail return, creation preserved');
} catch(error){console.error('manual-expense-edit browser FAIL:',error.message);process.exitCode=1;}
finally {await browser.close();}
