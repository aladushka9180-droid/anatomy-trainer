import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { themes } from './theme-card-fixture.mjs';

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
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level', 'provider-ready');
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
      const orbit = document.querySelector('#clientProfileOrbit').getBoundingClientRect();
      const summary = getComputedStyle(document.querySelector('.client-summary'));
      const summaryBox = document.querySelector('.client-summary').getBoundingClientRect();
      const summaryArticles = [...document.querySelectorAll('.client-summary article')].map(node => node.getBoundingClientRect().height);
      const milestone = document.querySelector('#clientMilestoneCard').getBoundingClientRect();
      const actions = [...document.querySelectorAll('.client-profile-primary-actions button:not([hidden])')].map(node => ({
        id:node.id,
        height:node.getBoundingClientRect().height
      }));
      const tabs = [...document.querySelectorAll('[data-client-profile-jump]')].map(node => ({
        active:node.classList.contains('is-active'),
        height:node.getBoundingClientRect().height
      }));
      return {
        scrollWidth:document.documentElement.scrollWidth,
        profile:{ left:profile.left, right:profile.right, width:profile.width },
        directoryDisplay, profileDisplay,
        ringBackground:ring.backgroundImage, orbitSize:orbit.width,
        summaryHeight:summaryBox.height, summaryArticles, milestoneHeight:milestone.height,
        summaryColumns:summary.gridTemplateColumns.split(' ').length,
        actions, tabs
      };
    });
    assert.ok(state.scrollWidth <= width + 1, `${theme}/${layout}/${width}: no horizontal overflow`);
    assert.equal(state.profileDisplay, 'block', `${theme}/${layout}/${width}: selected client profile stays visible`);
    assert.ok(state.profile.left >= -0.5 && state.profile.right <= width + 1, `${theme}/${layout}/${width}: profile remains inside viewport`);
    assert.match(state.ringBackground, /conic-gradient/, `${theme}/${layout}/${width}: relationship ring remains visible`);
    assert.ok(state.orbitSize <= 122.5, `${theme}/${layout}/${width}: profile avatar stays prominent but contained (${state.orbitSize})`);
    assert.ok(state.summaryArticles.every(height => height <= 96), `${theme}/${layout}/${width}: facts stay compact (${state.summaryArticles})`);
    assert.ok(state.milestoneHeight <= 84, `${theme}/${layout}/${width}: milestone stays compact (${state.milestoneHeight})`);
    assert.equal(state.tabs.filter(item => item.active).length, 1, `${theme}/${layout}/${width}: profile navigation has one active section`);
    if (width <= 980) assert.equal(state.directoryDisplay, 'none', `${theme}/${layout}/${width}: detail uses a single pane`);
    if (width >= 1100) assert.notEqual(state.directoryDisplay, 'none', `${theme}/${layout}/${width}: desktop keeps client context`);
    if (width <= 1199) assert.equal(state.summaryColumns, 2, `${theme}/${layout}/${width}: narrow profile uses a compact 2x2 fact grid`);
    if (width <= 760) {
      assert.ok(state.actions.every(item => item.height >= 43.5), `${theme}/${layout}/${width}: actions remain touch friendly (${JSON.stringify(state.actions)})`);
      assert.ok(state.tabs.every(item => item.height >= 43.5), `${theme}/${layout}/${width}: profile navigation remains touch friendly (${JSON.stringify(state.tabs)})`);
    }
  }

  await page.evaluate(() => document.querySelector('#clientMilestoneCard').classList.add('is-max-level'));
  const maximumMilestone = await page.locator('#clientMilestoneCard').boundingBox();
  assert.ok(maximumMilestone.height <= 84, `Maximum level remains a compact premium status (${maximumMilestone.height})`);
  if (process.env.CLIENT_RELATIONSHIP_SCREENSHOT) {
    const screenshotWidth = Number(process.env.CLIENT_RELATIONSHIP_SCREENSHOT_WIDTH) || 1440;
    await page.setViewportSize({ width:screenshotWidth, height:1000 });
    await page.locator('body').evaluate(body => {
      body.dataset.providerTheme = 'warm';
      body.dataset.providerLayout = 'bento';
      document.querySelector('#clientProfileOrbit').classList.add('is-max-level');
      document.querySelector('.client-profile').classList.add('client-profile-vip');
      document.querySelector('#clientRelationshipTitle').textContent = 'С нами давно';
      document.querySelector('#clientRelationshipLevel').textContent = '4 уровень';
      document.querySelector('#clientMilestoneText').textContent = 'Максимальный уровень — спасибо, что вы с нами';
      document.querySelector('#clientHistorySummary').textContent = 'Записей: 32';
      const favorites = document.querySelector('#clientFavoriteServices');
      favorites.hidden = false;
      document.querySelector('#clientFavoriteServicesList').innerHTML = '<span class="client-favorite-service is-imported"><span>Массаж спины + ШВЗ — базовый</span><small>из импорта</small></span><span class="client-favorite-service is-imported"><span>Общий массаж с обеих сторон</span><small>из импорта</small></span>';
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path:process.env.CLIENT_RELATIONSHIP_SCREENSHOT, fullPage:true });
  }
  console.log(`Client relationship appearance: PASS (${themes.length * layouts.length * widths.length} theme/layout/width checks)`);
} finally {
  await browser.close();
}
