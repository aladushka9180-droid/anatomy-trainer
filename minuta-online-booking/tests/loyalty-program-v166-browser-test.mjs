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
    document.body.replaceChildren(panel);
    document.body.className = 'provider-body';
    panel.hidden = false;
  });
  await page.addScriptTag({ content:moduleSource });
  await page.evaluate(async () => {
    document.querySelector('#loyaltyPanel').hidden = false;
    let failOnce = true;
    window.__loyaltyCalls = [];
    const workspace = { enabled:false, rule:null, clients:[], accounts:[], rewards:[], history:[], stats:{ issued:0, redeemed:0 } };
    const db = { async rpc(name, parameters) {
      window.__loyaltyCalls.push({ name, parameters:{ ...parameters } });
      if (name === 'get_minuta_loyalty_program_workspace_v166') return { data:workspace, error:null };
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
    await controller.setOrganization({ id:'organization-v166' });
  });
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

  console.log(`loyalty program v166 browser: PASS (${themes.length * widths.length} theme/width checks)`);
} finally {
  await browser.close();
}
