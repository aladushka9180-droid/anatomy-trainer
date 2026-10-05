import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const playwrightModule = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = playwrightModule
  ? await import(pathToFileURL(playwrightModule).href)
  : createRequire(import.meta.url)('playwright');
const originalHtml = await readFile(path.join(root, 'provider.html'), 'utf8');
const provider = await readFile(path.join(root, 'provider.js'), 'utf8');
const html = originalHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '');
function functions(first, next) {
  const start = provider.indexOf(`function ${first}(`);
  const end = provider.indexOf(`function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${first} exists in the production source`);
  return provider.slice(start, end);
}
const navigation = functions('providerMobileMoreIsOpen', 'dismissProviderMobileMore');
const groups = functions('groupMobileMoreNavigation', 'renderMobileNavigationPreview');
const seam = `\nwindow.__sectionsNative={show(){finishProviderBoot();document.querySelector('#authCard').hidden=true;document.querySelector('#dashboard').hidden=false;setProviderViewImmediate('bookings',false);void loadProviderGuidance();},restore(){displayPreferences=normalizeDisplayPreferences({...DEFAULT_DISPLAY_PREFERENCES,version:9,theme:'pink-porcelain',layout:'soft',color_mode:'light',text_scale:'default',mobile_nav_by_role:Object.fromEntries(PROVIDER_ROLE_KEYS.map(role=>[role,['bookings','clients','analytics','organization']]))});applyDisplayPreferences();}};`;
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname === '/native.html') {
      response.setHeader('Content-Type', 'text/html;charset=utf-8');
      response.end(pathname === '/' ? html : originalHtml); return;
    }
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('unsafe path');
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    response.end(pathname === '/provider.js' ? provider + seam : await readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = process.env.MINUTA_SECTIONS_OUTPUT || '';
if (output) await mkdir(output, { recursive:true });
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
const failures = [], evidence = [];
try {
  const page = await browser.newPage({viewport:{width:390,height:900}});
  // This is an isolated production-DOM fixture. No session, user database or external requests.
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin, { waitUntil:'networkidle' });
  await page.evaluate(({groups, navigation}) => {
    document.documentElement.className = 'provider-ready';
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'bookings';
    for (const panel of document.querySelectorAll('[data-provider-panel]')) panel.hidden = panel.dataset.providerPanel !== 'bookings';
    document.body.dataset.providerTheme = 'pink-porcelain';
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerTextScale = 'default';
    document.body.dataset.providerColorMode = 'light';
    document.body.dataset.providerResolvedColorMode = 'light';
    const selected = ['bookings','clients','analytics','organization'];
    for (const button of document.querySelectorAll('.mobile-more-grid [data-provider-view]')) button.hidden = selected.includes(button.dataset.providerView);
    window.$ = selector => document.querySelector(selector);
    window.PROVIDER_VIEW_ORDER = ['bookings','clients','messages','notifications','schedule','services','analytics','organization','settings','more'];
    window.providerSectionMobileQuery = matchMedia('(max-width:760px)');
    window.providerViewFromLocation = () => document.querySelector('#dashboard').dataset.activeView;
    window.renderMobileNavigation = () => {};
    window.providerMobileMoreReturnView = 'bookings';
    window.providerMobileMoreBodyStyle = null;
    window.providerMobileMoreScrollTop = 0;
    window.providerMobileMoreHistoryDismissed = false;
    (0, eval)(groups + navigation);
    groupMobileMoreNavigation();
    document.addEventListener('click', event => {
      if (event.target.closest('[data-close-mobile-more]')) closeProviderMobileMore({restoreFocus:true,historyMode:'replace'});
      if (event.target.closest('.provider-mobile-nav [data-provider-view="more"]')) openProviderMobileMore();
    });
  }, {groups,navigation});
  await page.addScriptTag({url:`${origin}/settings-smart-search.js`});
  await page.evaluate(() => { window.openProviderMobileMore({historyMode:'none'}); });
  await page.waitForSelector('#cabinetSectionsSearchInput');
  async function snapshot(target = page) {
    return target.evaluate(() => {
      const panel = document.querySelector('[data-provider-panel="more"]');
      const selectors = ['.mobile-more-sheet','.view-title h2','.mobile-more-close','.settings-search-field','input','.mobile-more-group:not([hidden])>h3','.mobile-more-group>button:not([hidden])','.mobile-more-group>button:not([hidden])>span','.mobile-more-group>button:not([hidden])>strong','.mobile-more-group>button:not([hidden])>small'];
      return selectors.map(selector => {
        const style = getComputedStyle(panel.querySelector(selector));
        return {selector,background:style.backgroundColor,color:style.color,border:style.borderColor,fontSize:style.fontSize,fontWeight:style.fontWeight,radius:style.borderRadius};
      });
    });
  }
  const before = await snapshot();
  await page.evaluate(() => {
    closeProviderMobileMore();
    document.querySelector('#dashboard').dataset.activeView = 'analytics';
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/statistics-audit-ui.css'; document.head.append(link);
  });
  await page.waitForFunction(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/statistics-audit-ui.css')));
  await page.evaluate(() => openProviderMobileMore({historyMode:'none'}));
  const after = await snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) failures.push({kind:'palette-depends-on-previous-view',before,after});
  const minimumContrast = await page.evaluate(() => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0,3).map(value=>Number(value)/255).map(value=>value<=.04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
      return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
    };
    const card=document.querySelector('.mobile-more-group>button:not([hidden])');
    const background=luminance(getComputedStyle(card).backgroundColor);
    return Math.min(...['strong','small'].map(selector=>{
      const foreground=luminance(getComputedStyle(card.querySelector(selector)).color);
      return (Math.max(background,foreground)+.05)/(Math.min(background,foreground)+.05);
    }));
  });
  assert.ok(minimumContrast>=4.5,`Menu text contrast ${minimumContrast} must remain readable`);
  for (const width of [390,760,1440]) for (const theme of ['pink-porcelain','sage','graphite']) for (const scale of ['default','large']) for (const layout of ['linear','soft','capsule','editorial','bento','split']) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(({theme,scale,layout,width}) => {
      document.body.dataset.providerTheme = theme;
      document.body.dataset.providerLayout = layout;
      document.body.dataset.providerTextScale = scale;
      document.body.dataset.providerColorMode = theme === 'graphite' ? 'dark' : 'light';
      document.body.dataset.providerResolvedColorMode = theme === 'graphite' ? 'dark' : 'light';
      document.querySelector('#dashboard').dataset.activeView = 'bookings';
      for (const panel of document.querySelectorAll('[data-provider-panel]')) panel.hidden = panel.dataset.providerPanel !== 'more';
      const panel = document.querySelector('[data-provider-panel="more"]');
      panel.hidden = false; panel.classList.add('is-open');
    },{theme,scale,layout,width});
    const metrics = await page.evaluate(() => {
      const panel = document.querySelector('[data-provider-panel="more"]');
      const sheet = panel.querySelector('.mobile-more-sheet');
      const visibleCards = [...panel.querySelectorAll('.mobile-more-group>:is(button,a)')].filter(el=>!el.hidden);
      const wrong = visibleCards.filter(el=>el.getBoundingClientRect().height < 44 || el.scrollWidth > el.clientWidth + 1).map(el=>el.textContent.trim());
      return {overflow:sheet.scrollWidth > sheet.clientWidth+1 || document.documentElement.scrollWidth > innerWidth+1,cards:visibleCards.length,wrong};
    });
    if (metrics.overflow || metrics.wrong.length) failures.push({kind:'geometry',width,theme,scale,layout,...metrics});
    evidence.push({width,theme,scale,layout,...metrics});
    if (output && theme === 'pink-porcelain' && scale === 'default' && layout === 'soft') await page.screenshot({path:path.join(output,`sections-${width}.png`)});
  }
  await page.setViewportSize({width:390,height:900});
  await page.evaluate(() => {
    document.body.dataset.providerTheme='pink-porcelain';
    document.body.dataset.providerTextScale='default';
    document.body.dataset.providerColorMode='light';
    document.body.dataset.providerResolvedColorMode='light';
    closeProviderMobileMore();
  });
  await page.locator('.provider-mobile-nav [data-provider-view="more"]').click();
  await page.locator('#cabinetSectionsSearchInput').fill('рабочие часы');
  await page.waitForSelector('.cabinet-sections-search .settings-search-results:not([hidden])');
  assert.ok(await page.locator('.cabinet-sections-search .settings-search-results button').count(), 'Search results remain available');
  await page.locator('.cabinet-sections-search .settings-search-clear').click();
  assert.equal(await page.locator('#cabinetSectionsSearchInput').inputValue(), '');
  await page.locator('.mobile-more-close').click();
  assert.ok(await page.locator('[data-provider-panel="more"]').isHidden(), 'Production close function dismisses the sheet');
  await page.waitForFunction(() => document.activeElement?.matches('.provider-mobile-nav [data-provider-view="more"]'));
  const native = await browser.newPage({viewport:{width:390,height:900},serviceWorkers:'block'});
  await native.route('**/*',route=>new URL(route.request().url()).origin === origin && route.request().method()==='GET' ? route.continue() : route.abort());
  await native.goto(`${origin}/native.html`,{waitUntil:'domcontentloaded'});
  await native.waitForFunction(()=>Boolean(window.__sectionsNative));
  await native.evaluate(()=>window.__sectionsNative.show());
  await native.waitForFunction(()=>Boolean(window.MinutaSettingsSearch));
  await native.evaluate(()=>window.__sectionsNative.restore());
  await native.locator('.provider-mobile-nav [data-provider-view="more"]').click();
  await native.locator('.mobile-more-sheet').waitFor({state:'visible'});
  const nativeBefore = await snapshot(native);
  await native.locator('.mobile-more-close').click();
  await native.locator('.provider-mobile-nav [data-provider-view="analytics"]').click();
  await native.waitForFunction(()=>document.querySelector('#dashboard').dataset.activeView==='analytics');
  await native.waitForFunction(()=>[...document.styleSheets].some(sheet=>sheet.href?.includes('/statistics-audit-ui.css')));
  await native.locator('.provider-mobile-nav [data-provider-view="more"]').click();
  await native.locator('.mobile-more-sheet').waitFor({state:'visible'});
  const nativeAfter = await snapshot(native);
  assert.deepEqual(nativeBefore,nativeAfter,'Full production runtime: statistics must not change the sheet palette');
  if (output) await native.screenshot({path:path.join(output,'sections-native-390.png')});
  await native.locator('#cabinetSectionsSearchInput').fill('рабочие часы');
  await native.locator('.cabinet-sections-search .settings-search-results button').filter({hasText:'Рабочие часы'}).first().click();
  await native.waitForFunction(()=>document.querySelector('#dashboard').dataset.activeView==='schedule');
  assert.ok(await native.locator('[data-provider-panel="more"]').isHidden(),'Native search selection navigates and dismisses the sheet');
  await native.close();
  if (output) await writeFile(path.join(output,'evidence.json'),JSON.stringify({before,after,nativeBefore,nativeAfter,minimumContrast,evidence,failures},null,2));
  assert.equal(failures.length,0, JSON.stringify(failures,null,2));
  console.log(`Provider sections soft UI: PASS (${evidence.length} geometry states; text contrast ${minimumContrast.toFixed(2)}; full runtime navigation before/after statistics, search, clear, close and restored focus)`);
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
