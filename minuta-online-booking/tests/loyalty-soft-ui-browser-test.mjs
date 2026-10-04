import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { themes } from './theme-card-fixture.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
const html = await readFile(path.join(root,'provider.html'),'utf8');
const shell = html.replace(/<script\b[\s\S]*?<\/script>/gi,'');
const server = createServer(async (request,response) => {
  try {
    const file = new URL(request.url,'http://localhost').pathname.slice(1);
    if (!file) { response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(shell); return; }
    if (!/^[a-z0-9_.-]+$/i.test(file)) { response.writeHead(404).end(); return; }
    const body = await readFile(path.join(root,file));
    response.setHeader('Content-Type',file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript'); response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const module = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const { chromium } = await import(module);
const browser = await chromium.launch({headless:true});
const output = process.env.MINUTA_LOYALTY_SOFT_OUTPUT;
if (output) await mkdir(output,{recursive:true});
const checks = [];
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('**/*',route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  await page.evaluate(() => {
    const panel = document.querySelector('#loyaltyPanel');
    const view = document.querySelector('[data-provider-panel="organization"]');
    const dashboard = document.querySelector('#dashboard');
    for (const candidate of document.querySelectorAll('[data-provider-panel]')) candidate.hidden=candidate!==view;
    document.querySelector('.provider-workspace').replaceChildren(view); dashboard.hidden=false; dashboard.dataset.activeView='organization';
    const workspace=document.querySelector('#organizationWorkspace'), nav=document.querySelector('#organizationSectionNav');
    workspace.replaceChildren(nav,panel); workspace.hidden=false; document.querySelector('#organizationLoading').hidden=true;
    for (const button of nav.querySelectorAll('button')) {
      button.hidden=!['Продажи','Абонементы','Лояльность','Возврат клиентов'].includes(button.textContent.trim());
      button.classList.toggle('active',button.textContent.trim()==='Лояльность');
    }
    document.body.replaceChildren(dashboard); document.documentElement.className='top-level provider-ready';
    document.body.className='provider-body'; document.body.dataset.providerLayout='bento'; document.body.dataset.providerTheme='pink-porcelain'; panel.hidden=false;
  });
  await page.addScriptTag({url:`${origin}/loyalty-program-v166.js?v=1053`});
  await page.addScriptTag({url:`${origin}/organization-group-navigation.js?v=1051`});
  await page.addStyleTag({url:`${origin}/organization-group-navigation.css?v=1051`});
  await page.evaluate(async () => {
    window.testState = {enabled:false,rule:null,clients:[{id:'client',client_name:'Тестовый клиент'}],accounts:[],rewards:[],history:[],stats:{issued:0,redeemed:0}};
    window.testCalls=[]; window.testFailure=''; window.testReadFailure=false;
    const escapeHtml = value => String(value).replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const db = {async rpc(name,parameters) {
      window.testCalls.push({name,parameters});
      if (name === 'get_minuta_loyalty_program_workspace_v166') return window.testReadFailure ? {error:{code:'FETCH_FAILED'}} : {data:structuredClone(window.testState)};
      if (window.testFailure) return {error:{code:window.testFailure}};
      if (name === 'set_minuta_loyalty_program_v166') {
        window.testState.enabled=parameters.p_enabled;
        if (parameters.p_enabled) window.testState.rule={id:'rule',goal_visits:parameters.p_goal_visits,reward_kind:parameters.p_reward_kind,reward_value:parameters.p_reward_value,reward_title:parameters.p_reward_title,reward_terms:parameters.p_reward_terms,validity_days:parameters.p_validity_days};
      }
      return {data:{ok:true}};
    }};
    window.testController=window.MinutaLoyalty.createController({db,escapeHtml,$:selector=>document.querySelector(selector),notify:()=>{},requireWrites:()=>true,getCurrentUser:()=>({id:'test-user'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability:()=>{}});
    window.testController.bind(); await window.testController.setOrganization({id:'test-organization'});
  });
  await page.waitForFunction(() => document.querySelector('#loyaltySoftStyles')?.sheet);
  assert.equal(await page.locator('#loyaltyProgramForm').isVisible(),true,'First configuration is expanded');
  assert.equal(await page.locator('#loyaltySavedStatus').innerText(),'Выключена');
  assert.match(await page.locator('#loyaltySoftStyles').getAttribute('href'),/loyalty-soft-ui\.css\?v=1053$/,'Finishing layer follows the lazy module version');
  await page.locator('#loyaltyEnabled').check();
  assert.equal(await page.locator('#loyaltySavedStatus').innerText(),'Выключена','Draft does not claim saved state');
  await page.locator('#loyaltyRewardTitle').fill('Спасибо за доверие');
  await page.locator('#loyaltyRewardTerms').fill('Одна услуга');
  await page.evaluate(() => { window.testFailure='FETCH_FAILED'; });
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  await page.locator('#loyaltyRuleError').waitFor({state:'visible'});
  assert.equal(await page.locator('#loyaltyProgramForm').isVisible(),true);
  assert.equal(await page.locator('#loyaltyRewardTitle').inputValue(),'Спасибо за доверие','Failure preserves draft');
  await page.evaluate(() => { window.testFailure=''; });
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  await page.locator('#loyaltySavedSummary').waitFor({state:'visible'});
  assert.equal(await page.locator('#loyaltyProgramForm').isVisible(),false,'Confirmed save collapses setup');
  assert.equal(await page.locator('#loyaltySavedTitle').innerText(),'10% скидка');
  assert.equal(await page.locator('#loyaltySavedGoal').innerText(),'За 10 завершённых визитов');
  assert.equal(await page.locator('#loyaltySavedDetails').innerText(),'90 дней с выдачи');
  assert.equal(await page.locator('#loyaltyWorkflowStatus').innerText(),'Включена');
  assert.equal(await page.locator('#loyaltySavedStatus').count(),1,'One authoritative status survives both view modes');
  assert.equal(await page.locator('#loyaltyCycleNote').isVisible(),false,'Cycle explanation stays with the editor');
  assert.equal(await page.evaluate(() => document.activeElement.id),'editLoyaltyProgram','Keyboard focus remains visible');
  checks.push('failed save preserves draft; confirmed save collapses and restores visible focus');
  await page.locator('#editLoyaltyProgram').press('Enter');
  assert.match(await page.locator('#loyaltyCycleNote').innerText(),/Текущие циклы сохраняют прежние правила/);
  assert.equal(await page.locator('#loyaltyRewardTitle').inputValue(),'Спасибо за доверие');
  assert.equal(await page.locator('#loyaltyRewardTerms').inputValue(),'Одна услуга');
  await page.locator('#loyaltyRewardValue').fill('15');
  assert.match(await page.locator('#loyaltySavedTitle').textContent(),/10%/,'Summary uses saved values only');
  await page.evaluate(() => { window.testReadFailure=true; });
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  await page.locator('#loyaltyRuleError').waitFor({state:'visible'});
  assert.equal(await page.locator('#loyaltyWorkspace').isVisible(),true,'Read-after-save failure cannot hide the draft');
  assert.equal(await page.locator('#loyaltyRewardValue').inputValue(),'15');
  assert.equal(await page.locator('#loyaltyProgramForm').isVisible(),true);
  assert.doesNotMatch(await page.locator('#loyaltyUnavailableText').innerText(),/Данные не изменены/,'A failed refresh cannot deny an acknowledged write');
  await page.locator('#reloadLoyalty').click();
  assert.equal(await page.locator('#loyaltyProgramForm').isVisible(),true,'Repeated failed reload keeps the editor');
  assert.equal(await page.locator('#loyaltyRewardValue').inputValue(),'15');
  await page.evaluate(() => { window.testReadFailure=false; });
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  await page.locator('#loyaltySavedSummary').waitFor({state:'visible'});
  const calls = await page.evaluate(() => window.testCalls.filter(row=>row.name==='set_minuta_loyalty_program_v166').map(row=>row.parameters.p_request_id));
  assert.equal(calls[0],calls[1],'Unknown write retry retains request identity');
  assert.equal(calls[2],calls[3],'Failed confirmation refresh retains the same settings request identity');
  checks.push('keyboard edit; saved-only summary; read-after-write failure leaves editor and values visible');
  await page.evaluate(() => {
    window.testState.accounts=[{client_account_id:'client',progress:6,goal_visits:10}];
    window.testState.rewards=[{id:'reward',client_account_id:'client',status:'pending',reward_kind:'percent',reward_value:1500,reward_title:'Спасибо за доверие',expires_at:'2026-12-20'}];
    window.testState.stats={issued:1,redeemed:0};
    return window.testController.load();
  });
  const widths=[390,760,1440];
  for (const theme of [...themes,'pink-porcelain']) for (const width of widths) {
    await page.setViewportSize({width,height:1000});
    await page.locator('body').evaluate((body,theme)=>{body.dataset.providerTheme=theme;},theme);
    for (const expanded of [false,true]) {
      if (expanded) await page.locator('#editLoyaltyProgram').click();
      else await page.evaluate(() => { document.querySelector('#loyaltyProgramForm').hidden=true; document.querySelector('#loyaltySavedSummary').hidden=false; });
      const layout=await page.evaluate(() => {
        const panel=document.querySelector('#loyaltyPanel');
        const visible=[...panel.querySelectorAll('button,input:not([type="checkbox"]),select,summary')].filter(node=>node.getBoundingClientRect().height>0);
        return {width:document.documentElement.scrollWidth,panelWidth:panel.getBoundingClientRect().width,panelRight:panel.getBoundingClientRect().right,buttons:visible.map(node=>({id:node.id,height:node.getBoundingClientRect().height})),iconCount:panel.querySelectorAll('svg use').length,background:getComputedStyle(panel.querySelector('.ls-form-footer button')).backgroundColor};
      });
      assert.ok(layout.width<=width+1,`${theme}/${width}/${expanded}: overflow`);
      assert.ok(layout.panelWidth>=Math.min(300,width-40),`${theme}/${width}: meaningful content width`);
      assert.ok(layout.panelRight<=width+1,`${theme}/${width}: panel cannot be clipped by a parent`);
      assert.ok(layout.buttons.every(row=>row.height>=43.5),`${theme}/${width}: touch targets`);
      assert.ok(layout.iconCount>=6);
      assert.notEqual(layout.background,'rgba(0, 0, 0, 0)',`${theme}/${width}: visible primary action`);
      await page.evaluate(async () => { window.scrollTo(0,0); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); });
      if (output && theme==='pink-porcelain') await page.screenshot({path:path.join(output,`loyalty-${width}-${expanded?'edit':'saved'}.png`),fullPage:true});
      if (output && theme==='midnight' && width===390 && expanded) await page.screenshot({path:path.join(output,'loyalty-dark-390.png'),fullPage:true});
    }
  }
  checks.push(`${(themes.length+1)*widths.length*2} mounted theme/width/state combinations; native icons; 44px controls`);
  await page.setViewportSize({width:390,height:1000});
  await page.locator('body').evaluate(body=>{body.dataset.providerTheme='pink-porcelain';});
  await page.evaluate(() => { document.querySelector('#loyaltyClientText').open=false; });
  await page.locator('#loyaltyRewardKind').selectOption('fixed');
  await page.locator('#loyaltyClientText summary').click();
  await page.locator('#loyaltyRewardTitle').fill('Скидка 15%');
  await page.locator('#loyaltyClientText summary').click();
  const writeCount=await page.evaluate(()=>window.testCalls.length);
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  assert.equal(await page.locator('#loyaltyClientText').getAttribute('open'),'','Native validation reveals the hidden invalid field');
  assert.equal(await page.evaluate(()=>window.testCalls.length),writeCount,'Invalid fields never write');
  await page.locator('#loyaltyRewardTitle').fill('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#loyaltyPreviewReward img').count(),0,'Preview uses text, not HTML');
  await page.locator('#loyaltyRewardKind').selectOption('text');
  assert.equal(await page.locator('#loyaltyRewardValueField').isVisible(),false,'Text reward keeps original semantics');
  await page.locator('#loyaltyEnabled').uncheck();
  assert.equal(await page.locator('#loyaltySavedStatus').innerText(),'Включена','Unsaved off keeps actual status');
  await page.locator('#loyaltyProgramForm button[type="submit"]').click();
  await page.locator('#loyaltySavedSummary').waitFor({state:'visible'});
  assert.equal(await page.locator('#loyaltySavedStatus').innerText(),'Выключена');
  assert.equal(await page.locator('#loyaltySavedDetails').innerText(),'90 дней с выдачи','Turning off retains saved reward validity');
  assert.equal(await page.locator('[data-redeem-loyalty-reward]').count(),1,'Switching off retains issued rewards');
  checks.push('mobile disclosure validation; safe preview; all reward kinds; off preserves pending rewards');
  if (output) await writeFile(path.join(output,'verification.json'),JSON.stringify({checks,environment:'isolated fake RPC; production markup, controller and styles',widths},null,2));
  console.log(`loyalty soft UI browser: PASS (${checks.join('; ')})`);
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
