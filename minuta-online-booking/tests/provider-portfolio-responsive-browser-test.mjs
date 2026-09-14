import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const root = new URL('../', import.meta.url);
const baseStyles = readFileSync(new URL('styles.css', root), 'utf8');
const portfolioStyles = readFileSync(new URL('provider-portfolio-responsive.css', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const functionsStart = provider.indexOf('function portfolioActionMarkup(');
const functionsEnd = provider.indexOf('async function signedPortfolioUrl(', functionsStart);
assert.ok(functionsStart > 0 && functionsEnd > functionsStart);
const actionFunctions = provider.slice(functionsStart, functionsEnd);
const browser = await chromium.launch({ headless:true });

const cards = [
  ['first','Очень длинное название процедуры, которое переносится без выхода за границы карточки','Лицо и шея · 12 сеансов','Длинное описание результата, которое занимает несколько строк, остаётся читаемым и не превращает карточку в бесконечно высокий блок.',true,true],
  ['middle','Средняя работа','Зона не указана','Короткое описание.',false,true],
  ['last','Работа без фотографии после','Спина · 1 сеанс','Честное пустое состояние справа.',false,false]
].map(([id,title,meta,description,published,hasAfter]) => `<article class="portfolio-card" draggable="true" data-portfolio-card="${id}"><div class="portfolio-card-photos"><figure class="portfolio-photo"><div class="fixture-photo"></div><span>До</span></figure>${hasAfter ? '<figure class="portfolio-photo"><div class="fixture-photo after"></div><span>После</span></figure>' : '<div class="portfolio-photo"><div class="portfolio-photo-empty"><svg class="ui-icon"></svg><span>Фото не добавлено</span></div><span>После</span></div>'}</div><div class="portfolio-card-body"><div class="portfolio-card-copy"><div class="portfolio-card-heading"><h3>${title}</h3><span class="portfolio-card-status ${published ? 'published' : ''}">${published ? 'Опубликовано' : 'Черновик'}</span></div><small>${meta}</small><p>${description}</p></div><button class="portfolio-card-menu-trigger" type="button" data-portfolio-actions="${id}" aria-label="Действия с работой ${title}" aria-haspopup="dialog" aria-controls="portfolioActionDialog" aria-expanded="false"><svg class="ui-icon"></svg></button></div></article>`).join('');

try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${baseStyles}\n${portfolioStyles}\nbody{margin:0;padding:20px;background:#f4f7f5}.fixture-shell{max-width:1040px;margin:auto}.fixture-photo{width:100%;height:100%;background:linear-gradient(135deg,#799985,#345b46)}.fixture-photo.after{background:linear-gradient(135deg,#d3b98c,#7f5c35)}</style></head><body class="provider-body" data-provider-theme="sage" data-provider-layout="soft" data-provider-text-scale="default"><div id="dashboard" class="provider-app" data-active-view="portfolio"><main class="fixture-shell"><section class="provider-view" data-provider-panel="portfolio"><div class="view-title portfolio-view-title"><div class="portfolio-title-copy"><span>Работы мастера</span><div class="portfolio-heading-row"><h2>Портфолио</h2><span class="portfolio-count-label">3 работы</span></div></div><div class="view-title-actions portfolio-title-actions"><button class="primary compact-button"><span>Добавить работу</span></button><a class="portfolio-preview-link" href="#"><span>Страница клиента</span></a></div></div><p class="view-description portfolio-purpose">Опубликованные работы видны клиентам и помогают показать результат.</p><div class="portfolio-manage-list" id="portfolioManageList">${cards}</div></section></main><nav class="provider-mobile-nav"><button><span>Записи</span></button><button><span>Клиенты</span></button><button><span>Уведомления</span></button><button><span>Статистика</span></button><button><span>Разделы</span></button></nav></div><dialog class="portfolio-action-dialog" id="portfolioActionDialog" aria-labelledby="portfolioActionTitle"><div class="portfolio-action-panel"><div class="portfolio-action-head"><div><small>Работа</small><h2 id="portfolioActionTitle">Действия</h2></div><button type="button" data-close-portfolio-actions aria-label="Закрыть меню действий"><svg class="ui-icon"></svg></button></div><div class="portfolio-action-list" id="portfolioActionList"></div></div></dialog><script>const $=selector=>document.querySelector(selector);const $$=selector=>[...document.querySelectorAll(selector)];const escapeHtml=value=>String(value);const uiIcon=name=>'<svg class="ui-icon" data-icon="'+name+'"></svg>';let portfolioItems=[{id:'first',procedure_name:'Очень длинное название процедуры',published:true,consent_confirmed_at:'2026-09-01'},{id:'middle',procedure_name:'Средняя работа',published:false,consent_confirmed_at:'2026-09-01'},{id:'last',procedure_name:'Работа без фотографии после',published:false,consent_confirmed_at:null}];let portfolioActionTrigger=null;let portfolioActionReturnFocus=true;${actionFunctions};document.addEventListener('click',event=>{const trigger=event.target.closest('[data-portfolio-actions]');if(trigger){event.preventDefault();openPortfolioActions(trigger);return}if(event.target.closest('[data-close-portfolio-actions]'))closePortfolioActions()});document.addEventListener('keydown',event=>{if(trapPortfolioActionFocus(event))return;if(event.key==='Escape'&&$('#portfolioActionDialog').open){event.preventDefault();closePortfolioActions()}});$('#portfolioActionDialog').addEventListener('close',finishPortfolioActionClose);$('#portfolioActionDialog').addEventListener('cancel',event=>{event.preventDefault();closePortfolioActions()});$('#portfolioActionDialog').addEventListener('click',event=>{if(event.target===event.currentTarget)closePortfolioActions()});document.addEventListener('pointerdown',event=>{const dialog=$('#portfolioActionDialog');if(dialog.open&&!dialog.contains(event.target)&&!event.target.closest?.('[data-portfolio-actions]'))closePortfolioActions()},true);window.addEventListener('resize',positionPortfolioActionDialog);</script></body></html>`);

  for (const [width,height] of [[390,844],[760,900],[1440,1000]]) {
    await page.setViewportSize({ width,height });
    for (const [theme,layout,textScale] of [['sage','soft','default'],['luxury','linear','large'],['loft','editorial','comfortable'],['eco','capsule','large'],['hitech','bento','default'],['graphite','split','comfortable']]) {
      await page.locator('body').evaluate((body,values) => { body.dataset.providerTheme=values[0]; body.dataset.providerLayout=values[1]; body.dataset.providerTextScale=values[2]; }, [theme,layout,textScale]);
      const geometry = await page.evaluate(() => ({ body:document.body.scrollWidth, viewport:document.documentElement.clientWidth, cards:[...document.querySelectorAll('.portfolio-card')].map(card => ({ left:card.getBoundingClientRect().left, right:card.getBoundingClientRect().right })) }));
      assert.ok(geometry.body <= geometry.viewport, `${width}: page overflow for ${theme}/${layout}/${textScale}`);
      assert.ok(geometry.cards.every(card => card.left >= -0.5 && card.right <= width + 0.5), `${width}: card overflow for ${theme}/${layout}/${textScale}`);
    }

    const trigger = page.locator('[data-portfolio-actions="last"]');
    const before = await page.locator('[data-portfolio-card="last"]').evaluate(card => ({ height:card.getBoundingClientRect().height }));
    await trigger.click();
    await page.locator('#portfolioActionDialog').waitFor({ state:'visible' });
    await page.waitForTimeout(220);
    const open = await page.evaluate(() => {
      const dialog=document.querySelector('#portfolioActionDialog');
      const card=document.querySelector('[data-portfolio-card="last"]');
      const nav=document.querySelector('.provider-mobile-nav');
      const rect=dialog.getBoundingClientRect();
      const cardRect=card.getBoundingClientRect();
      const navRect=nav.getBoundingClientRect();
      return { viewportHeight:window.innerHeight, rect:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width}, card:{height:cardRect.height,top:cardRect.top}, nav:{top:navRect.top,display:getComputedStyle(nav).display,visibility:getComputedStyle(nav).visibility}, buttons:[...dialog.querySelectorAll('button')].filter(button=>button.getClientRects().length).map(button=>button.getBoundingClientRect().height), expanded:document.querySelector('[data-portfolio-actions="last"]').getAttribute('aria-expanded'), mobile:dialog.classList.contains('is-mobile-sheet') };
    });
    assert.ok(Math.abs(open.card.height - before.height) < 1.5, `${width}: opening actions changed card height ${JSON.stringify({before,after:open.card})}`);
    assert.equal(open.expanded,'true');
    assert.ok(open.buttons.every(height => height >= 44), `${width}: action target below 44px`);
    assert.ok(open.rect.left >= -0.5 && open.rect.right <= width + .5 && open.rect.top >= -0.5 && open.rect.bottom <= open.viewportHeight + .5, `${width}: dialog outside viewport ${JSON.stringify(open.rect)}`);
    if (width === 390) {
      assert.equal(open.mobile,true);
      assert.ok(Math.abs(open.rect.bottom-open.viewportHeight)<1 && Math.abs(open.rect.width-width)<1, '390: sheet is not attached to the bottom');
      assert.equal(open.nav.visibility,'hidden');
      const close = page.locator('[data-close-portfolio-actions]');
      const lastAction = page.locator('#portfolioActionList button').last();
      await lastAction.focus();
      await lastAction.press('Tab');
      assert.equal(await close.evaluate(node=>node===document.activeElement),true,'390: Tab does not wrap inside sheet');
      await close.press('Shift+Tab');
      assert.equal(await lastAction.evaluate(node=>node===document.activeElement),true,'390: Shift+Tab does not wrap inside sheet');
    } else {
      assert.equal(open.mobile,false, `${width}: tablet/desktop must use popover`);
      assert.ok(open.rect.width <= 282, `${width}: popover is too wide`);
      if (open.nav.display !== 'none') assert.ok(open.rect.bottom <= open.nav.top - 7, `${width}: popover overlaps bottom navigation`);
    }
    await page.keyboard.press('Escape');
    await page.locator('#portfolioActionDialog').waitFor({ state:'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'),'false');
    assert.equal(await trigger.evaluate(node=>node===document.activeElement),true,`${width}: focus did not return to trigger`);
    await trigger.click();
    await page.locator('#portfolioActionDialog').waitFor({ state:'visible' });
    await page.mouse.click(2,2);
    await page.locator('#portfolioActionDialog').waitFor({ state:'hidden' });
    assert.equal(await trigger.getAttribute('aria-expanded'),'false',`${width}: outside click did not close actions`);
  }
  console.log('Provider portfolio responsive browser geometry and interaction: PASS');
} finally {
  await browser.close();
}
