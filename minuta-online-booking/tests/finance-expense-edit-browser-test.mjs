import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const source = readFileSync(new URL('../finance-center.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../finance-center.css', import.meta.url), 'utf8');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const moduleName = process.env.MINUTA_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(/^[A-Za-z]:[\\/]/.test(moduleName) ? pathToFileURL(moduleName).href : moduleName);
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const out = process.env.MINUTA_VISUAL_OUTPUT;
if (out) mkdirSync(out, { recursive:true });
const errors = [];
try {
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{ width,height:940 } });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://expense.test' || route.request().method() !== 'GET') return route.abort();
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html',body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/',''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp','.json':'application/json'})[extname(relative)]||'application/octet-stream',body:readFileSync(resolve(root,relative)) }); } catch { return route.abort(); }
    });
    page.on('pageerror', error => errors.push(error.message));
    const dark = width === 760;
    await page.goto('https://expense.test/minuta-online-booking/provider.html',{waitUntil:'networkidle'});
    await page.addScriptTag({url:'https://expense.test/minuta-online-booking/finance-center.js'});
    await page.evaluate(dark => {
      document.documentElement.classList.remove('provider-booting');document.documentElement.classList.add('top-level');document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;
      document.querySelector('#financeCenterRoot').hidden=false;document.querySelector('#dashboard').dataset.activeView='analytics';
      document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='analytics';panel.classList.toggle('active',!panel.hidden)});
      document.querySelector('#analyticsView').dataset.reportTab='money';document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
      const colors=dark?{'--theme-bg':'#191817','--theme-ink':'#f5f1ed','--theme-muted':'#c1b7af','--theme-line':'#71665d','--theme-surface':'#191817','--theme-surface-alt':'#252321','--theme-accent':'#d19b70','--theme-accent-soft':'#35261e','--theme-accent-contrast':'#20120b'}:{'--theme-bg':'#fff5f8','--theme-ink':'#302b31','--theme-muted':'#625c64','--theme-line':'#e9cbd6','--theme-surface':'#fff','--theme-surface-alt':'#ffe8f0','--theme-accent':'#c43372','--theme-accent-soft':'#ffe8f0','--theme-accent-contrast':'#fff'};
      for(const [name,value]of Object.entries(colors))document.body.style.setProperty(name,value);
      window.editCalls=[];window.readCalls=[];window.notices=[];window.mode='success';window.saves=0;
      window.expense={ id:'expense-1', categoryId:'rent',paymentAccountId:'cash',amountMinor:1800000,occurredOn:'2026-09-22',note:'Кабинет',sourceLabel:'Аренда',title:'Аренда: Кабинет',performerId:'original-performer' };
      window.fixture={ available:true,financeEnabled:true,resultReliable:true,today:'2026-10-03',timezone:'Europe/Samara',dateBasis:'operations',
        summary:{receivedMinor:5000000,expenseMinor:1800000},expenseDirectory:[{id:'rent',name:'Аренда'},{id:'materials',name:'Материалы'}],
        paymentAccounts:[{id:'cash',name:'Касса'},{id:'bank',name:'Банк'}],expenseCategories:[{id:'rent',name:'Аренда',amountMinor:1800000}],
        permissions:{canAddExpense:true,canEditExpense:true},operations:[{id:'payment',manualExpenseId:'expense-1',type:'expense',flow:'expense',amountMinor:-1800000,categoryId:'rent',label:'Оплата расхода',occurredAt:'2026-09-22T08:00:00Z'}] };
      window.adapter={readDashboard:async()=>structuredClone(fixture),createExpense:async()=>{throw new Error('edit must not create separately')},
        readExpense:async id=>{readCalls.push(id);if(mode==='stale')throw Object.assign(new Error('stale'),{userMessage:'Этот расход уже исправлен.'});return structuredClone(expense)},
        updateExpense:async payload=>{editCalls.push(structuredClone(payload));if(mode==='ambiguous'&&editCalls.length===1)throw Object.assign(new Error('lost ack'),{code:'AMBIGUOUS_RESULT'});
          if(mode==='rejected')throw Object.assign(new Error('invalid account'),{code:'22023',userMessage:'Счёт больше недоступен.'});
          if(mode==='pending')await new Promise(resolve=>window.finishSave=resolve);
          saves++;fixture.summary.expenseMinor=payload.amountMinor;fixture.operations=[{...fixture.operations[0],manualExpenseId:'expense-2',amountMinor:-payload.amountMinor}];return{id:'expense-2'};}};
      window.controller=MinutaFinanceCenter.init({root:document.querySelector('#financeCenterRoot'),adapter,onNotice:value=>notices.push(value)});
    },dark);
    await page.evaluate(()=>controller.ready);
    const edit = page.getByRole('button',{name:'Редактировать расход: Оплата расхода',exact:true});
    await edit.scrollIntoViewIfNeeded();
    if(out)await page.screenshot({path:resolve(out,'expense-operation-'+width+'.png')});
    await edit.click();
    assert.equal(await page.locator('#financeExpenseTitle').innerText(),'Редактировать расход');
    assert.equal(await page.locator('[name=amount]').inputValue(),'18000,00');
    assert.equal(await page.locator('[name=occurredOn]').inputValue(),'2026-09-22');
    assert.equal(await page.locator('[name=categoryId]').inputValue(),'rent');
    assert.equal(await page.locator('[name=paymentAccountId]').inputValue(),'cash');
    assert.equal(await page.locator('[name=note]').inputValue(),'Кабинет');
    const geometry = await page.locator('[data-finance-dialog]').evaluate(dialog=>({
      width:dialog.getBoundingClientRect().width,viewport:innerWidth,overflow:dialog.scrollWidth-dialog.clientWidth,
      buttons:[...dialog.querySelectorAll('button')].filter(x=>x.getBoundingClientRect().height).map(x=>x.getBoundingClientRect().height)}));
    assert.ok(geometry.width<=geometry.viewport && geometry.overflow<=1, width+': edit dialog fits');
    assert.ok(geometry.buttons.every(x=>x>=44),width+': edit touch targets');
    if(out)await page.screenshot({path:resolve(out,'expense-edit-'+width+'.png')});
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
    assert.equal(await page.evaluate(()=>editCalls.length),0,'cancel is read-only');
    await edit.click();
    await page.locator('[name=amount]').fill('12500,75');
    await page.locator('[name=occurredOn]').fill('2026-10-01');
    await page.locator('[name=categoryId]').selectOption('materials');
    await page.locator('[name=paymentAccountId]').selectOption('bank');
    await page.locator('[name=note]').fill('Расходные материалы');
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.locator('[data-finance-dialog]').waitFor({state:'hidden'});
    assert.match(await page.locator('[data-finance-expense]').innerText(),/12\s500,75/);
    const payload=await page.evaluate(()=>editCalls[0]);
    assert.equal(payload.expenseId,'expense-1');assert.equal(payload.performerId,'original-performer','global filter cannot reassign an expense');
    assert.equal(payload.amountMinor,1250075);assert.equal(payload.occurredOn,'2026-10-01');assert.equal(payload.paymentAccountId,'bank');assert.equal(payload.categoryId,'materials');
    assert.equal(payload.preserveTitle,false);assert.match(payload.requestId,/^[0-9a-f-]{36}$/i);
    assert.equal(await page.evaluate(()=>notices.at(-1)),'Расход изменён');
    // Restart with the original expense to exercise a lost acknowledgement.
    await page.evaluate(()=>{controller.destroy();fixture.summary.expenseMinor=1800000;fixture.operations[0].manualExpenseId='expense-1';editCalls=[];mode='ambiguous';controller=MinutaFinanceCenter.init({root:document.querySelector('#financeCenterRoot'),adapter,onNotice:value=>notices.push(value)})});
    await page.evaluate(()=>controller.ready);await edit.click();
    await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.getByRole('button',{name:'Повторить безопасно',exact:true}).waitFor({state:'visible'});
    assert.equal(await page.locator('[name=amount]').isDisabled(),true,'unknown result freezes the request');
    await page.getByRole('button',{name:'Отмена',exact:true}).click();await edit.click();
    await page.getByRole('button',{name:'Повторить безопасно',exact:true}).click();
    await page.locator('[data-finance-dialog]').waitFor({state:'hidden'});
    const retries=await page.evaluate(()=>editCalls);assert.deepEqual(retries[0],retries[1],'retry preserves exact identity and payload');
    // An explicit refusal preserves editable draft fields, with no success toast.
    await page.evaluate(()=>{mode='rejected';expense.id='expense-2'});await edit.click();
    await page.locator('[name=amount]').fill('777,30');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.locator('[data-finance-form-error]').waitFor({state:'visible'});
    assert.equal(await page.locator('[name=amount]').inputValue(),'777,30');assert.equal(await page.locator('[name=amount]').isDisabled(),false);
    await page.getByRole('button',{name:'Отмена',exact:true}).click();
    // A genuine pending write cannot be duplicated or cancelled by Escape.
    await page.evaluate(()=>{mode='pending';editCalls=[]});await edit.click();await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.keyboard.press('Escape');assert.equal(await page.locator('[data-finance-dialog]').evaluate(x=>x.open),true);
    assert.equal(await page.locator('[data-finance-submit]').isDisabled(),true);assert.equal(await page.evaluate(()=>editCalls.length),1);
    await page.evaluate(()=>finishSave());await page.locator('[data-finance-dialog]').waitFor({state:'hidden'});
    // Stale sources never open a writable form; server capability is mandatory.
    await page.evaluate(()=>{mode='stale';readCalls=[];fixture.operations[0].manualExpenseId='expense-1';controller.reload()});
    await page.evaluate(()=>controller.ready);await edit.click();
    assert.equal(await page.locator('[data-finance-dialog]').evaluate(x=>x.open),false);
    assert.match(await page.evaluate(()=>notices.at(-1)),/уже исправлен/);
    await page.evaluate(()=>{fixture.permissions.canEditExpense=false;controller.reload()});
    await page.waitForFunction(()=>!document.querySelector('.finance-center__edit'));
    assert.equal(await edit.count(),0,'absence of server capability hides edit');
    // Existing creation must still close after its lost acknowledgement is found.
    await page.evaluate(()=>{window.createCalls=0;adapter.createExpense=async()=>{createCalls++;throw Object.assign(new Error('lost ack'),{code:'AMBIGUOUS_RESULT'})};adapter.findExpenseByRequestId=async()=>({id:'confirmed-new-expense'})});
    await page.locator('[data-finance-add]').click();
    await page.locator('[name=categoryId]').selectOption('rent');
    await page.locator('[name=paymentAccountId]').selectOption('cash');
    await page.locator('[name=amount]').fill('500');
    await page.locator('[name=occurredOn]').fill('2026-10-01');
    await page.locator('[data-finance-submit]').click();
    await page.locator('[data-finance-dialog]').waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>createCalls),1);assert.equal(await page.evaluate(()=>notices.at(-1)),'Расход уже сохранён');
    await page.close();
  }
  assert.deepEqual(errors,[]);console.log('Expense edit UI: prefill, cancel, save/refresh, frozen retry, refusal, pending guard, stale and capability gates PASS at 390/760/1440.');
} finally { await browser.close(); }
