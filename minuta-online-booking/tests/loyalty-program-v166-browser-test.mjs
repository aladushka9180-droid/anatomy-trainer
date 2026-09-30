import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { themes } from './theme-card-fixture.mjs';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const moduleSource = readFileSync(new URL('loyalty-program-v166.js', root), 'utf8');
const cssFiles = [...html.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^"#]*)?"/g)].map(match => match[1]);
const css = cssFiles.map(file => readFileSync(new URL(file, root), 'utf8')).join('\n');
const shell = html
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]+rel="stylesheet"[^>]*>/gi, '')
  .replace(/<meta\b[^>]+http-equiv="Content-Security-Policy"[^>]*>/gi, '');

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const playwright = await import(modulePath);
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  await page.route('http://loyalty.test/**', route => route.fulfill({ contentType:'text/html', body:shell }));
  await page.goto('http://loyalty.test/');
  await page.addStyleTag({ content:css });
  await page.evaluate(() => {
    const panel = document.querySelector('#loyaltyPanel');
    document.body.replaceChildren(panel);
    document.documentElement.className = 'top-level provider-ready';
    document.body.className = 'provider-body';
    document.body.dataset.providerLayout = 'bento';
    panel.hidden = false;
    document.querySelector('#loyaltyLoading').hidden = true;
    document.querySelector('#loyaltyUnavailable').hidden = true;
    document.querySelector('#loyaltyWorkspace').hidden = false;
    document.querySelector('#loyaltyEnabled').checked = true;
    document.querySelector('#loyaltyIssuedCount').textContent = '12';
    document.querySelector('#loyaltyRedeemedCount').textContent = '7';
    document.querySelector('#loyaltyBalancesList').innerHTML = '<article class="loyalty-client-row"><div><strong>Ирина Орлова</strong><small>6 из 10 · ещё 4 до награды</small></div><span class="loyalty-progress-value">6/10</span></article>';
    document.querySelector('#loyaltyRewardsList').innerHTML = '<article class="loyalty-reward-row"><div><strong>Мария Климова · 10% скидка</strong><small>До 20 дек. 2026 г.</small></div><button class="secondary-button" type="button">Отметить использованной</button></article>';
    document.querySelector('#loyaltyLedgerList').innerHTML = '<article><div><strong>Визит засчитан</strong><small>Ирина Орлова</small></div><time>20 сент. 2026 г.</time></article>';
  });

  const widths = [360, 390, 760, 1100, 1440];
  for (const theme of themes) for (const width of widths) {
    await page.setViewportSize({ width, height:1000 });
    await page.locator('body').evaluate((body, nextTheme) => { body.dataset.providerTheme = nextTheme; }, theme);
    const state = await page.evaluate(() => {
      const panel = document.querySelector('#loyaltyPanel').getBoundingClientRect();
      const controls = [...document.querySelectorAll('#loyaltyPanel input, #loyaltyPanel select, #loyaltyPanel button:not([hidden])')]
        .filter(node => getComputedStyle(node).display !== 'none').map(node => ({ tag:node.tagName, id:node.id, text:node.textContent.trim(), height:node.getBoundingClientRect().height }));
      const preview = getComputedStyle(document.querySelector('.loyalty-program-preview'));
      return { scrollWidth:document.documentElement.scrollWidth, panel, controls, previewBorder:preview.borderColor, previewBackground:preview.backgroundColor };
    });
    assert.ok(state.scrollWidth <= width + 1, `${theme}/${width}: no horizontal overflow`);
    assert.ok(state.panel.left >= -0.5 && state.panel.right <= width + 1, `${theme}/${width}: panel remains inside viewport`);
    assert.ok(state.controls.filter(control => control.tag === 'BUTTON' && control.height > 0).every(control => control.height >= 43.5), `${theme}/${width}: buttons remain touch friendly (${JSON.stringify(state.controls.filter(control => control.tag === 'BUTTON'))})`);
    if (theme === 'midnight') {
      const rgb = [...state.previewBorder.matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])).slice(0, 3);
      assert.ok(rgb.length < 3 || !(rgb[1] > rgb[0] * 1.35 && rgb[1] > rgb[2] * 1.15), `midnight/${width}: loyalty accent is not green`);
    }
    if (process.env.MINUTA_LOYALTY_SCREENSHOT && theme === 'midnight' && [390,1440].includes(width)) {
      await page.screenshot({ path:`${process.env.MINUTA_LOYALTY_SCREENSHOT}-${width}.png`, fullPage:true });
    }
  }

  await page.setContent(shell);
  await page.addStyleTag({ content:css });
  await page.evaluate(() => {
    const panel = document.querySelector('#loyaltyPanel');
    const view = document.querySelector('[data-provider-panel="organization"]');
    const dashboard = document.querySelector('#dashboard');
    view.replaceChildren(panel); view.hidden = false;
    dashboard.replaceChildren(view); dashboard.hidden = false;
    document.body.replaceChildren(dashboard);
    document.documentElement.className = 'top-level provider-ready';
    document.body.className = 'provider-body';
    document.body.dataset.providerLayout = 'bento';
    document.body.dataset.providerTheme = 'pink-porcelain';
    panel.hidden = false;
  });
  await page.addScriptTag({ content:moduleSource });
  await page.evaluate(async () => {
    document.querySelector('#loyaltyPanel').hidden = false;
    let failOnce = true;
    window.__loyaltyCalls = [];
    const workspace = { enabled:false, rule:null, clients:[], accounts:[], rewards:[], history:[], stats:{ issued:0, redeemed:0 } };
    window.__loyaltyWorkspace = workspace;
    const db = { async rpc(name, parameters) {
      window.__loyaltyCalls.push({ name, parameters:{ ...parameters } });
      if (name === 'get_minuta_loyalty_program_workspace_v166') return { data:workspace, error:null };
      if (name === 'preview_minuta_loyalty_adjustment_v166') return { data:{ before:-1,after:-1+parameters.p_delta,
        delta:parameters.p_delta,goal_visits:10,rule_id:'rule',cycle_number:2,
        allowed:-1+parameters.p_delta >= 0 && -1+parameters.p_delta <= 10,reaches_goal:false }, error:null };
      if (name === 'confirm_minuta_loyalty_adjustment_v166') return { data:{ progress:0,recovered:false }, error:null };
      if (name === 'set_minuta_loyalty_program_v166' && failOnce) { failOnce = false; return { data:null, error:{ code:'FETCH_FAILED' } }; }
      workspace.enabled = Boolean(parameters.p_enabled);
      workspace.rule = { id:'rule', goal_visits:parameters.p_goal_visits, reward_kind:parameters.p_reward_kind, reward_value:parameters.p_reward_value, reward_title:parameters.p_reward_title, reward_terms:parameters.p_reward_terms, validity_days:parameters.p_validity_days };
      return { data:{ ok:true }, error:null };
    } };
    const controller = window.MinutaLoyalty.createController({
      db, $:selector => document.querySelector(selector), escapeHtml:value => String(value), notify:message => { window.__loyaltyNotice = message; },
      requireWrites:() => true, getCurrentUser:() => ({ id:'user-v166' }), getSessionGeneration:() => 1,
      sessionIsCurrent:() => true, applyWriteAvailability:() => {}
    });
    controller.bind();
    window.__loyaltyController = controller;
    await controller.setOrganization({ id:'organization-v166' });
  });
  await page.locator('#loyaltyEnabled').check();
  await page.locator('#loyaltyRewardKind').selectOption('fixed');
  assert.equal(await page.locator('#loyaltyRewardTitle').inputValue(), 'Скидка 10 ₽ на следующий визит', 'Untouched template follows reward units');
  assert.equal(await page.locator('#loyaltyRewardValueLabel').innerText(), 'Скидка, ₽');
  await page.locator('#loyaltyRewardTitle').fill('Скидка 10% на следующий визит');
  assert.equal(await page.locator('#loyaltyRewardTitle').evaluate(input => input.validity.valid), false, 'Contradictory unit is rejected before RPC');
  await page.getByRole('button', { name:'Сохранить программу', exact:true }).click();
  assert.equal(await page.evaluate(() => window.__loyaltyCalls.filter(c => c.name === 'set_minuta_loyalty_program_v166').length), 0, 'Invalid settings never reach the server');
  for (const width of [390,760,1440]) {
    await page.setViewportSize({ width,height:1000 });
    assert.equal(await page.locator('#loyaltyRewardTitleHint').isVisible(), true);
    assert.ok(await page.evaluate(width => document.documentElement.scrollWidth <= width + 1,width), 'Unit explanation fits viewport');
    if (process.env.MINUTA_LOYALTY_UNITS_SCREENSHOT) await page.screenshot({path:`${process.env.MINUTA_LOYALTY_UNITS_SCREENSHOT}-${width}.png`,fullPage:true});
  }
  await page.locator('#loyaltyRewardTitle').fill('Спасибо за доверие');
  await page.locator('#loyaltyRewardKind').selectOption('percent');
  await page.locator('#loyaltyRewardValue').fill('15.5');
  assert.equal(await page.locator('#loyaltyRewardTitle').inputValue(), 'Спасибо за доверие', 'Custom name is never overwritten');
  await page.locator('#loyaltyRewardTitle').fill('Скидка 10%');
  assert.equal(await page.locator('#loyaltyRewardTitle').evaluate(input => input.validity.valid), false, 'Wrong numeric amount also conflicts');
  await page.locator('#loyaltyRewardTitle').fill('Скидка 15,5%');
  assert.equal(await page.locator('#loyaltyRewardTitle').evaluate(input => input.validity.valid), true, 'Russian decimal amount agrees with percent storage');
  await page.locator('#loyaltyRewardValue').fill('10');
  await page.locator('#loyaltyRewardTitle').fill('Скидка 10% на следующий визит');
  await page.evaluate(async () => {
    const form = document.querySelector('#loyaltyProgramForm');
    const button = form.querySelector('button[type="submit"]');
    document.querySelector('#loyaltyEnabled').checked = true;
    form.dispatchEvent(new SubmitEvent('submit', { bubbles:true, cancelable:true, submitter:button }));
    await new Promise(resolve => setTimeout(resolve, 30));
    form.dispatchEvent(new SubmitEvent('submit', { bubbles:true, cancelable:true, submitter:button }));
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  const retry = await page.evaluate(() => {
    const writes = window.__loyaltyCalls.filter(call => call.name === 'set_minuta_loyalty_program_v166');
    return { ids:writes.map(call => call.parameters.p_request_id), notice:window.__loyaltyNotice, storage:[...Array(localStorage.length)].map((_, index) => localStorage.key(index)).filter(key => key.startsWith('minuta-loyalty-v166:')) };
  });
  assert.equal(retry.ids.length, 2, 'The same settings action is retried once');
  assert.equal(retry.ids[0], retry.ids[1], 'An ambiguous retry reuses the idempotency key');
  assert.equal(retry.storage.length, 0, 'Successful confirmation clears the stored retry intent');
  assert.match(retry.notice, /сохранена/i, 'Successful retry is reported');
  await page.locator('#loyaltyRewardKind').selectOption('fixed');
  assert.equal(await page.locator('#loyaltyRewardTitle').inputValue(), 'Скидка 10% на следующий визит', 'Saved title is preserved even when it resembles the default');
  assert.equal(await page.locator('#loyaltyRewardTitle').evaluate(input => input.validity.valid), false);
  await page.locator('#loyaltyEnabled').uncheck();
  assert.equal(await page.locator('#loyaltyRewardTitle').evaluate(input => input.validity.valid), true, 'Conflict cannot prevent switching program off');

  await page.evaluate(async () => {
    const workspace = window.__loyaltyWorkspace;
    workspace.enabled = true;
    workspace.rule = { id:'rule', goal_visits:10, reward_kind:'percent', reward_value:1000,
      reward_title:'Скидка 10%', reward_terms:'', validity_days:null };
    workspace.clients = [{ id:'client-1', client_name:'Ирина Орлова' }];
    workspace.accounts = [{ client_account_id:'client-1', progress:0, goal_visits:10 }];
    await window.__loyaltyController.load();
    document.querySelector('details.loyalty-operation').open = true;
  });
  assert.match(await page.locator('#loyaltyAdjustmentPreview').innerText(),/Выберите клиента/);
  assert.equal(await page.locator('#loyaltyAdjustmentForm button[type="submit"]').isDisabled(),true);
  await page.locator('#loyaltyAdjustmentClient').selectOption('client-1');
  await page.locator('#loyaltyAdjustmentPoints').fill('100');
  await page.waitForFunction(() => document.querySelector('#loyaltyAdjustmentPreview').textContent.includes('станет 99'));
  assert.equal(await page.locator('#loyaltyAdjustmentForm button[type="submit"]').isDisabled(),true,'Out-of-range preview blocks submission');
  await page.locator('#loyaltyAdjustmentPoints').fill('1');
  await page.waitForFunction(() => document.querySelector('#loyaltyAdjustmentPreview').textContent.includes('Было -1 → станет 0'));
  assert.equal(await page.locator('#loyaltyAdjustmentForm button[type="submit"]').isDisabled(),false);
  await page.locator('#loyaltyAdjustmentReason').fill('Исправление долга');
  await page.locator('#loyaltyAdjustmentForm button[type="submit"]').click();
  const confirmation = await page.evaluate(() => window.__loyaltyCalls.find(call => call.name === 'confirm_minuta_loyalty_adjustment_v166'));
  assert.deepEqual([confirmation.parameters.p_expected_before,confirmation.parameters.p_expected_cycle,confirmation.parameters.p_expected_rule],[-1,2,'rule'],
    'Confirmation carries the exact server balance and cycle');

  console.log(`loyalty program v166 browser: PASS (${themes.length * widths.length} theme/width checks)`);
} finally {
  await browser.close();
}
