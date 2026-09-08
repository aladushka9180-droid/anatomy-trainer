import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const cssFiles = [...html.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^"#]*)?"/g)].map(match => match[1]);
const css = cssFiles.map(file => readFileSync(new URL(file, root), 'utf8')).join('\n');
const shell = html
  .replace(/<script\b[\s\S]*?<\/script>/gi, '')
  .replace(/<link\b[^>]+rel="stylesheet"[^>]*>/gi, '');

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const playwright = await import(modulePath);
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  await page.setContent(shell);
  await page.addStyleTag({ content:css });
  await page.evaluate(() => {
    document.querySelector('#providerBoot')?.setAttribute('hidden', '');
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    const clients = document.querySelector('[data-provider-panel="clients"]');
    clients.hidden = false;
    const layout = document.querySelector('#clientsLayout');
    layout.classList.add('is-detail');
    const empty = document.querySelector('#clientProfileEmpty');
    empty.hidden = true;
    const profile = document.querySelector('#clientProfileContent');
    profile.hidden = false;
    document.body.classList.add('client-profile-detail-open');

    document.querySelector('#clientsCount').textContent = '37';
    document.querySelector('#clientsList').innerHTML = [
      ['Ирина Орлова', '+7 915 246-38-21', 'Постоянный клиент · 3 уровень', 10, '.76turn', true],
      ['Алексей Соколов', '+7 916 882-11-03', 'Возвращается · 2 уровень', 6, '.42turn', false],
      ['Мария Климова', '+7 925 771-20-44', 'Первый визит · 1 уровень', 1, '.25turn', true],
      ['Сергей Никитин', '+7 903 333-17-88', 'С нами давно · 4 уровень', 18, '1turn', true]
    ].map(([name, phone, status, count, progress, photo], index) => `
      <button class="client-list-item${index === 0 ? ' active' : ''}" type="button">
        <span class="client-list-avatar-orbit${photo ? ' has-photo' : ''}" style="--client-level-progress:${progress}" aria-hidden="true"><span class="client-list-avatar">${name[0]}</span></span>
        <span class="client-list-main"><strong>${name}</strong><small>${phone}</small><i>${index ? 'Нет будущих записей' : '12 сент., 10:00'}</i><em class="client-list-level">${status}</em></span>
        <b>${count}</b>
      </button>`).join('');

    const orbit = document.querySelector('#clientProfileOrbit');
    orbit.classList.add('has-photo');
    orbit.style.setProperty('--client-level-progress', '.76turn');
    document.querySelector('#clientAvatar').textContent = 'И';
    document.querySelector('#clientName').textContent = 'Ирина Орлова';
    document.querySelector('#clientPhone').textContent = '+7 915 246-38-21';
    document.querySelector('#clientRelationshipTitle').textContent = 'Постоянный клиент';
    document.querySelector('#clientRelationshipLevel').textContent = '3 уровень';
    document.querySelector('#clientVisits').textContent = '10';
    document.querySelector('#clientSpent').textContent = '48 300 ₽';
    document.querySelector('#clientLastVisit').textContent = '4 сент.';
    document.querySelector('#clientNext').textContent = '12 сент. · 10:00';
    document.querySelector('#clientNextDetails').textContent = 'Уход для лица «Сияние»';
    document.querySelector('#clientMilestoneText').textContent = 'До уровня «С нами давно» — 2 визита';
    document.querySelector('#clientMilestoneCard').style.setProperty('--client-level-width', '76%');
    const reliability = document.querySelector('#clientReliabilityCard');
    reliability.hidden = false;
    document.querySelector('#clientReliabilityText').textContent = '1 отмена клиентом и 1 неявка из последних 8 записей';
  });

  const themes = ['sage', 'graphite', 'luxury', 'noir-safari'];
  const layouts = ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split'];
  const widths = [390, 760, 761, 981, 1100, 1440];
  for (const theme of themes) for (const layout of layouts) for (const width of widths) {
    await page.setViewportSize({ width, height:1000 });
    await page.locator('body').evaluate((body, values) => {
      body.dataset.providerTheme = values.theme;
      body.dataset.providerLayout = values.layout;
      body.dataset.providerTextScale = 'normal';
    }, { theme, layout });
    const state = await page.evaluate(() => {
      const profile = document.querySelector('.client-profile').getBoundingClientRect();
      const directoryDisplay = getComputedStyle(document.querySelector('.clients-directory')).display;
      const profileDisplay = getComputedStyle(document.querySelector('.client-profile')).display;
      const ring = getComputedStyle(document.querySelector('#clientProfileOrbit'));
      const summary = getComputedStyle(document.querySelector('.client-summary'));
      const actions = [...document.querySelectorAll('.client-profile-primary-actions button:not([hidden])')].map(node => ({
        height:node.getBoundingClientRect().height,
        minHeight:parseFloat(getComputedStyle(node).minHeight) || 0
      }));
      return {
        scrollWidth:document.documentElement.scrollWidth,
        profile:{ left:profile.left, right:profile.right, width:profile.width },
        directoryDisplay, profileDisplay,
        ringBackground:ring.backgroundImage,
        summaryColumns:summary.gridTemplateColumns.split(' ').length,
        actions
      };
    });
    assert.ok(state.scrollWidth <= width + 1, `${theme}/${layout}/${width}: no horizontal overflow`);
    assert.equal(state.profileDisplay, 'block', `${theme}/${layout}/${width}: selected client profile stays visible`);
    assert.ok(state.profile.left >= -0.5 && state.profile.right <= width + 1, `${theme}/${layout}/${width}: profile remains inside viewport`);
    assert.match(state.ringBackground, /conic-gradient/, `${theme}/${layout}/${width}: relationship ring remains visible`);
    if (width <= 980) assert.equal(state.directoryDisplay, 'none', `${theme}/${layout}/${width}: detail uses a single pane`);
    if (width >= 1100) assert.notEqual(state.directoryDisplay, 'none', `${theme}/${layout}/${width}: desktop keeps client context`);
    if (width <= 760) {
      assert.equal(state.summaryColumns, 2, `${theme}/${layout}/${width}: client facts use a compact 2x2 grid`);
      assert.ok(state.actions.every(item => item.minHeight >= 44 && item.height >= 43.5), `${theme}/${layout}/${width}: actions remain touch friendly (${JSON.stringify(state.actions)})`);
    }
  }
  console.log(`Client relationship appearance: PASS (${themes.length * layouts.length * widths.length} theme/layout/width checks)`);
} finally {
  await browser.close();
}
