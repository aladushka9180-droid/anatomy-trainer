import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const providerHtml = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const catalog = readFileSync(resolve(root, 'theme-catalog.js'), 'utf8');
const themes = [...catalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
const layouts = ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split'];
const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const { chromium } = playwrightModule.chromium ? playwrightModule : playwrightModule.default;
const mime = { '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };

const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH || undefined });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'https://layout-picker.test') return route.abort();
    if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:providerHtml });
    const relative = decodeURIComponent(url.pathname.replace(/^\/minuta-online-booking\//, ''));
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) return route.abort();
    try {
      return route.fulfill({ contentType:mime[extname(target)] || 'application/octet-stream', body:readFileSync(target) });
    } catch {
      return route.abort();
    }
  });
  const page = await context.newPage();
  await page.goto('https://layout-picker.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    const options = document.querySelector('.provider-layout-options');
    for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"]')) document.head.append(stylesheet);
    document.documentElement.classList.remove('provider-booting');
    document.body.replaceChildren(options);
    document.body.className = 'provider-body authenticated';
    document.body.style.margin = '0';
    document.body.style.padding = '12px';
    options.style.maxWidth = '1110px';
    options.style.margin = '0 auto';
    const stable = document.createElement('style');
    stable.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.append(stable);
  });

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of themes) for (const layout of layouts) {
      await page.evaluate(({ activeTheme, activeLayout }) => {
        document.body.dataset.providerTheme = activeTheme;
        document.body.dataset.providerLayout = activeLayout;
        for (const input of document.querySelectorAll('input[name="providerLayout"]')) input.checked = input.value === activeLayout;
      }, { activeTheme:theme, activeLayout:layout });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const result = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.provider-layout-option')];
        const rects = cards.map(card => card.getBoundingClientRect());
        const selected = cards.find(card => card.querySelector('input:checked'));
        const selectedStyle = getComputedStyle(selected);
        const unselected = cards.find(card => card !== selected);
        const innerOverflow = cards.flatMap(card => {
          const outer = card.getBoundingClientRect();
          return [...card.querySelectorAll('.theme-swatch,strong,small')]
            .filter(element => {
              const rect = element.getBoundingClientRect();
              return rect.left < outer.left - .5 || rect.right > outer.right + .5 || rect.top < outer.top - .5 || rect.bottom > outer.bottom + .5;
            })
            .map(element => element.tagName.toLowerCase());
        });
        return {
          count:cards.length,
          checked:cards.filter(card => card.querySelector('input:checked')).length,
          radii:cards.map(card => Number.parseFloat(getComputedStyle(card).borderTopLeftRadius)),
          shadows:cards.map(card => getComputedStyle(card).boxShadow),
          selectedBorder:selectedStyle.borderTopColor,
          unselectedBorder:getComputedStyle(unselected).borderTopColor,
          checkContent:getComputedStyle(selected, '::after').content,
          innerOverflow,
          bodyScrollWidth:document.documentElement.scrollWidth,
          viewportWidth:innerWidth,
          minWidth:Math.min(...rects.map(rect => rect.width)),
        };
      });
      assert.equal(result.count, 6, `${theme}/${layout}/${width}: должны оставаться шесть вариантов`);
      assert.equal(result.checked, 1, `${theme}/${layout}/${width}: выбран ровно один вариант`);
      assert.ok(result.radii.every(radius => radius === 14), `${theme}/${layout}/${width}: тема или компоновка изменила радиус (${[...new Set(result.radii)].join(', ')})`);
      assert.ok(result.shadows.every(shadow => shadow === 'none'), `${theme}/${layout}/${width}: у карточки появилось лишнее кольцо или свечение`);
      assert.equal(result.selectedBorder, 'rgb(45, 91, 122)', `${theme}/${layout}/${width}: выбранная карточка потеряла точную синюю рамку`);
      assert.notEqual(result.selectedBorder, result.unselectedBorder, `${theme}/${layout}/${width}: обычные карточки стали такими же акцентными, как выбранная`);
      assert.equal(result.checkContent, '"✓"', `${theme}/${layout}/${width}: у выбранного варианта нет одной галочки`);
      assert.deepEqual(result.innerOverflow, [], `${theme}/${layout}/${width}: содержимое вышло за границы карточки`);
      assert.ok(result.minWidth >= 140, `${theme}/${layout}/${width}: карточки стали слишком узкими`);
      assert.ok(
        result.bodyScrollWidth <= result.viewportWidth + 2,
        `${theme}/${layout}/${width}: горизонтальное переполнение`,
      );
    }
  }
  console.log('Provider layout picker geometry: PASS (40 themes × 6 layouts × 3 widths).');
} finally {
  await browser.close();
}
