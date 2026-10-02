import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { portfolioSoftFixture, portfolioFixtureCssLayers } from './portfolio-soft-ui-fixture.mjs';
const module = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = module.default || module;
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({serviceWorkers:'block'});
  const requests=[];
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [390, 760, 1180, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    await page.goto('about:blank');
    await page.setContent(portfolioSoftFixture());
    assert.deepEqual(errors, []);
    const view = page.locator('[data-provider-panel="portfolio"]');
    await view.locator('[data-portfolio-soft-card]').first().waitFor();
    for (const theme of ['pink-porcelain', 'graphite', 'sage']) {
      await page.locator('#fixtureTheme').selectOption(theme);
      const geometry = await view.evaluate(root => ({
        overflow:document.documentElement.scrollWidth > innerWidth + 1,
        headingHeight:root.querySelector('.portfolio-heading-row h2').getBoundingClientRect().height,
        controlsFit:[...root.querySelectorAll('.portfolio-title-actions button,.portfolio-title-actions a')].every(e=>{const a=e.getBoundingClientRect(),b=root.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1}),
        columns:getComputedStyle(root.querySelector('#portfolioManageList')).gridTemplateColumns.split(' ').length,
        filledStars:[...root.querySelectorAll('.portfolio-soft-stars .is-filled path')].every(e=>getComputedStyle(e).fill !== 'none'),
        emptyStars:[...root.querySelectorAll('.portfolio-soft-stars .ui-icon:not(.is-filled) path')].every(e=>getComputedStyle(e).fill === 'none'),
        photoLabelsFit:[...root.querySelectorAll('.portfolio-card-photos')].every(photos=>{const mark=photos.querySelector('.portfolio-soft-photo-trigger>span').getBoundingClientRect();return [...photos.querySelectorAll('.portfolio-photo>span')].filter(e=>e.getClientRects().length).every(e=>{const a=e.getBoundingClientRect();return a.right<=mark.left||a.left>=mark.right||a.bottom<=mark.top||a.top>=mark.bottom})}),
        ratingGap:(()=>{const head=root.querySelector('.portfolio-soft-review-name');return head.querySelector('span').getBoundingClientRect().left-head.querySelector('strong').getBoundingClientRect().right})(),
        controls:[...root.querySelectorAll('button,summary')].filter(e=>e.getClientRects().length).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,minHeight:getComputedStyle(e).minHeight})),
        smallest:Math.min(...[...root.querySelectorAll('.portfolio-photo>span,.portfolio-card-status,.portfolio-card-copy>small,.provider-review-head small')].filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)))
      }));
      assert.equal(geometry.overflow, false, `${width}/${theme}: overflow`);
      assert.ok(geometry.headingHeight < 50, `${width}/${theme}: heading wraps`);
      assert.equal(geometry.controlsFit, true, `${width}/${theme}: clipped header control`);
      assert.equal(geometry.columns, width === 390 ? 1 : width === 760 ? 2 : 3);
      assert.ok(geometry.ratingGap <= 11);
      assert.equal(geometry.filledStars, true);
      assert.equal(geometry.emptyStars, true);
      assert.equal(geometry.photoLabelsFit, true, `${width}/${theme}: photo caption overlaps preview icon`);
      assert.ok(geometry.smallest >= 12);
      assert.ok(geometry.controls.every(e=>e.h >= 44 && e.w >= 44), `${width}/${theme}: ${JSON.stringify(geometry.controls.filter(e=>e.h<44||e.w<44))}`);
      assert.equal(await view.locator('.portfolio-title-actions .primary').evaluate(e=>getComputedStyle(e).color===getComputedStyle(e.querySelector('span')).color), true, `${theme}: button label contrast`);
      assert.equal(await view.locator('.provider-review-card').first().evaluate(e=>getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', `${theme}: separate review frame`);
      await page.locator('#fixtureEmpty').click();
      await view.locator('.provider-review-empty-state').waitFor();
      await page.waitForFunction(()=>document.querySelector('[data-provider-panel="portfolio"]')?.classList.contains('portfolio-soft-empty'));
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.portfolio-title-actions .primary')).backgroundColor===getComputedStyle(document.querySelector('#portfolioManageList>.portfolio-empty-state')).backgroundColor);
      assert.equal(await view.locator('.portfolio-title-actions .primary').evaluate(e=>getComputedStyle(e).color===getComputedStyle(e.querySelector('span')).color), true, `${theme}: empty button label contrast`);
      assert.notEqual(await view.locator('.portfolio-title-actions .primary').evaluate(e=>getComputedStyle(e).backgroundColor), await view.locator('.portfolio-empty-actions .primary').evaluate(e=>getComputedStyle(e).backgroundColor), `${theme}: one primary action`);
      await page.locator('#fixtureFilled').click();
      await view.locator('[data-portfolio-soft-card]').first().waitFor();
    }
    assert.equal(await view.locator('.portfolio-card-photos.is-pair').count(), 1);
    assert.equal(await view.locator('.portfolio-card-photos.is-single').count(), 2);
    assert.equal(await view.locator('[data-review-visibility="hidden"]').getAttribute('data-review-published'), 'false');
    await view.locator('[data-portfolio-card="pair"] [data-portfolio-photo-preview]').click();
    await view.locator('#portfolioPhotoPreviewDialog').waitFor({ state:'visible' });
    assert.equal(await view.locator('#portfolioPhotoPreviewDialog img').count(), 2);
    assert.match(await view.locator('#portfolioPhotoPreviewDialog').textContent(), /После 6 сеансов/);
    await page.keyboard.press('Escape');
    await view.locator('#portfolioPhotoPreviewDialog').waitFor({ state:'hidden' });
    assert.equal(await view.locator('[data-portfolio-card="pair"] [data-portfolio-photo-preview]').evaluate(e=>e===document.activeElement), true);
    await view.locator('[data-portfolio-card="before-only"] [data-portfolio-photo-preview]').click();
    assert.equal(await view.locator('#portfolioPhotoPreviewDialog img').count(), 1);
    await view.locator('[aria-label="Закрыть фотографии"]').click();
    await view.locator('[data-portfolio-actions="single"]').click();
    await page.locator('#portfolioActionDialog').waitFor({ state:'visible' });
    assert.match(await page.locator('#portfolioActionList').textContent(), /Сначала подтвердите согласие/);
    await page.keyboard.press('Escape');
    await page.locator('#portfolioActionDialog').waitFor({ state:'hidden' });
    await page.locator('#fixtureFailWrite').click();
    await view.locator('[data-review-visibility="hidden"]').click();
    assert.match(await page.locator('#fixtureNotice').textContent(), /Повторите попытку/);
    assert.equal(await view.locator('[data-review-visibility="hidden"]').isEnabled(), true);
    assert.equal(await view.locator('[data-review-visibility="hidden"]').getAttribute('data-review-published'), 'false');
    await view.locator('[data-review-visibility="hidden"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-review-visibility="hidden"]')?.dataset.reviewPublished === 'true');
    assert.equal(await view.locator('[data-review-visibility="hidden"]').getAttribute('data-review-published'), 'true');
    await page.locator('#fixtureEmpty').click();
    await view.locator('.portfolio-soft-empty').count();
    await page.waitForFunction(()=>!document.querySelector('.provider-review-empty-state .portfolio-empty-actions'));
    assert.equal(await view.locator('.provider-review-empty-state a').count(), 0);
    assert.equal(await view.locator('.portfolio-title-actions .primary').evaluate(e=>getComputedStyle(e).color===getComputedStyle(e.querySelector('span')).color), true);
    await view.locator('.portfolio-soft-review-guide summary').click();
    assert.equal(await view.locator('.portfolio-soft-review-guide').getAttribute('open'), '');
    assert.match(await view.locator('.portfolio-soft-review-guide p').textContent(), /завершённого визита/);
    await page.locator('#fixtureError').click();
    await view.locator('#portfolioManageList .portfolio-empty-state').waitFor();
    assert.match(await view.locator('#portfolioManageList').textContent(), /Портфолио не загружено/);
    assert.ok(await view.locator('#providerReviewsList>.provider-empty').evaluate(e=>e.getBoundingClientRect().height) < 230);
    await view.locator('[data-retry-provider-reviews]').click();
    await view.locator('.portfolio-soft-review-name').first().waitFor();
    assert.equal(await view.locator('.provider-review-card').count(), 2);
  }
  const privacy=[];
  for(const kind of ['logout','auth-expiry','actor-switch']){
    await page.goto('about:blank');
    await page.setContent(portfolioSoftFixture());
    const trigger=page.locator('[data-portfolio-card="pair"] [data-portfolio-photo-preview]');
    await trigger.click();
    const dialog=page.locator('#portfolioPhotoPreviewDialog');
    assert.equal(await dialog.evaluate(e=>e.open),true);
    assert.equal(await dialog.locator('img').count(),2);
    await trigger.evaluate(e=>window.portfolioFixtureOldTrigger=e);
    await page.evaluate(kind=>window.portfolioFixtureSessionReset(kind),kind);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const result=await dialog.evaluate(e=>({kind:null,closed:!e.open,clones:e.querySelectorAll('img').length,staleFocus:document.activeElement===window.portfolioFixtureOldTrigger}));
    result.kind=kind;
    // Detached/stale actor DOM can dispatch clicks while a new snapshot loads.
    await page.evaluate(()=>window.portfolioFixtureOldTrigger.click());
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
    result.staleReopen=await dialog.evaluate(e=>e.open);
    await page.evaluate(()=>window.portfolioFixtureLoadActor());
    const fresh=page.locator('[data-portfolio-card="actor-b-pair"] [data-portfolio-photo-preview]');
    await fresh.click();
    result.freshOpen=await dialog.evaluate(e=>e.open);
    result.freshTitle=await dialog.locator('#portfolioPhotoPreviewTitle').textContent();
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    result.freshReturnFocus=await fresh.evaluate(e=>document.activeElement===e);
    privacy.push(result);
  }
  if(process.env.MINUTA_PORTFOLIO_PRIVACY_OUTPUT)writeFileSync(process.env.MINUTA_PORTFOLIO_PRIVACY_OUTPUT,JSON.stringify({privacy,errors},null,2));
  assert.deepEqual(privacy.filter(r=>!r.closed||r.clones!==0||r.staleFocus||r.staleReopen||!r.freshOpen||!r.freshTitle.includes('Другой исполнитель')||!r.freshReturnFocus),[],'Session reset must clear private gallery, reject stale nodes and preserve fresh gallery/keyboard behavior');
  const fullCss=[],fullCssFailures=[];
  const settle=()=>page.evaluate(async()=>{
    await document.fonts.ready;
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished));
  });
  for(const width of [390,760,1440])for(const theme of ['pink-porcelain','graphite','sage']){
    await page.setViewportSize({width,height:1000});
    await page.goto('about:blank');
    await page.setContent(portfolioSoftFixture({fullCss:true}));
    await page.locator('[data-portfolio-soft-card]').first().waitFor();
    assert.ok(portfolioFixtureCssLayers.length>40,'Full regression must load actual eager CSS');
    assert.deepEqual(await page.locator('style[data-provider-source-href]').evaluateAll(nodes=>nodes.map(e=>({href:e.dataset.providerSourceHref,media:e.media}))),portfolioFixtureCssLayers,'Actual CSS order/media must be preserved');
    await page.locator('#fixtureTheme').selectOption(theme);
    await settle();
    const filled=await page.locator('.portfolio-title-actions .primary').evaluate(e=>{
      const s=getComputedStyle(e),r=e.getBoundingClientRect();
      return{bg:s.backgroundColor,color:s.color,visible:r.width>=44&&r.height>=44,label:getComputedStyle(e.querySelector('span')).color};
    });
    const filledSurfaces=await page.locator('[data-provider-panel="portfolio"]').evaluate(root=>({
      reviews:[...root.querySelectorAll('.provider-review-card')].map(e=>getComputedStyle(e).backgroundColor),
      shadows:[...root.querySelectorAll('.portfolio-card,.provider-reviews-panel,.provider-review-card')].map(e=>getComputedStyle(e).boxShadow)
    }));
    if(filledSurfaces.reviews.some(bg=>bg!=='rgba(0, 0, 0, 0)')||filledSurfaces.shadows.some(shadow=>shadow!=='none'))fullCssFailures.push(`${width}/${theme}: filled cards regain frames or shadows from shared themes`);
    await page.locator('#fixtureEmpty').click();
    await page.waitForFunction(()=>document.querySelector('[data-provider-panel="portfolio"]').classList.contains('portfolio-soft-empty'));
    await settle();
    const result=await page.evaluate(()=>{
      const info=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return{bg:s.backgroundColor,color:s.color,width:r.width,height:r.height,children:[...e.querySelectorAll('span,.ui-icon,svg')].map(n=>({tag:n.tagName,color:getComputedStyle(n).color}))};};
      return{header:info(document.querySelector('.portfolio-title-actions .primary')),primary:info(document.querySelector('.portfolio-empty-actions .primary')),surface:getComputedStyle(document.querySelector('#portfolioManageList>.portfolio-empty-state')).backgroundColor,attrs:{theme:document.body.dataset.providerTheme,layout:document.body.dataset.providerLayout,textScale:document.body.dataset.providerTextScale},overflow:document.documentElement.scrollWidth>innerWidth+1};
    });
    Object.assign(result,{width,theme,filled,filledSurfaces});fullCss.push(result);
    if(result.header.bg===result.primary.bg||result.header.bg!==result.surface)fullCssFailures.push(`${width}/${theme}: empty screen has two filled primary actions`);
    if(!filled.visible||filled.bg!==result.primary.bg||filled.color!==result.primary.color||filled.label!==filled.color)fullCssFailures.push(`${width}/${theme}: filled primary changed or lost contrast`);
    if([result.header,result.primary].some(button=>button.width<44||button.height<44||button.children.some(child=>child.color!==button.color)))fullCssFailures.push(`${width}/${theme}: label/icon contrast or target size`);
    if(result.overflow)fullCssFailures.push(`${width}/${theme}: full-layer overflow`);
    assert.deepEqual(result.attrs,{theme,layout:'soft',textScale:'default'});
  }
  if(process.env.MINUTA_PORTFOLIO_FULL_CSS_OUTPUT)writeFileSync(process.env.MINUTA_PORTFOLIO_FULL_CSS_OUTPUT,JSON.stringify({layers:portfolioFixtureCssLayers,results:fullCss,failures:fullCssFailures,requests,errors},null,2));
  assert.deepEqual(fullCssFailures,[],'Actual full CSS must preserve one empty primary action, child colors and filled primary');
  assert.deepEqual(requests,[],'Isolated fixture must not initiate network requests');
  assert.deepEqual(errors, []);
  console.log('Portfolio soft UI: PASS; 12 viewport/theme combinations, actual sidebar/workspace, 390/760/1180/1440, native menu/gallery, empty/error/retry. No production network.');
} finally { await browser.close(); }
