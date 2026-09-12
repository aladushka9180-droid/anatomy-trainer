// Read-only browser matrix. Run with Playwright available in NODE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = __dirname;
const catalog = fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const themes = [...catalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.equal(themes.length, 40, 'Каталог тем прочитан не полностью');
const approvedThemes = new Set(['snow-leopard', 'pearl-zebra', 'apricot-tiger']);
const familyThemes = themes.filter(theme => !approvedThemes.has(theme));
const screenshotThemes = new Set(['luxury', 'loft', 'japandi', 'azure-lagoon', 'botanical', 'peach-silk', 'blue-hydrangea', 'oled-mono', 'volt-graphite']);
const visibilityThemes = new Set(['sage', 'graphite', 'eco', 'luxury', 'warm', 'peach-silk', 'azure-lagoon', 'botanical', 'oled-mono']);
const output = process.env.MINUTA_THEME_FAMILY_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      const stable = document.createElement('style');
      stable.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.append(stable);
      const dashboard = document.querySelector('#dashboard');
      dashboard.hidden = false;
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#bookingSheet')?.setAttribute('hidden', '');
      document.body.classList.remove('booking-sheet-open');
    });

    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      for (const theme of familyThemes) {
        const state = await page.evaluate(themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const canvas = getComputedStyle(document.body, '::before');
          const surfaceSelectors = ['.provider-sidebar', '.provider-topbar', '.schedule-card', '.schedule-toolbar'];
          const surfaces = surfaceSelectors.map(selector => {
            const node = document.querySelector(selector);
            if (!node || getComputedStyle(node).display === 'none') return null;
            const style = getComputedStyle(node);
            return { selector, image:style.backgroundImage, color:style.backgroundColor };
          }).filter(Boolean);
          return {
            image:canvas.backgroundImage,
            opacity:Number(canvas.opacity),
            position:canvas.position,
            pointerEvents:canvas.pointerEvents,
            zIndex:canvas.zIndex,
            width:canvas.width,
            height:canvas.height,
            overflow:document.documentElement.scrollWidth > innerWidth + 2,
            surfaces,
          };
        }, theme);
        assert.notEqual(state.image, 'none', `${theme} ${width}px: фоновый мотив не виден`);
        assert.ok(state.opacity >= .02 && state.opacity <= .06, `${theme} ${width}px: неверная сила мотива ${state.opacity}`);
        assert.equal(state.pointerEvents, 'none', `${theme} ${width}px: мотив перехватывает клики`);
        assert.equal(state.zIndex, '0', `${theme} ${width}px: неверный слой фонового холста`);
        assert.equal(state.position, width <= 760 ? 'absolute' : 'fixed', `${theme} ${width}px: неверное позиционирование холста`);
        assert.equal(state.overflow, false, `${theme} ${width}px: появился горизонтальный overflow`);
        for (const surface of state.surfaces) {
          assert.equal(surface.image, 'none', `${theme} ${width}px ${surface.selector}: узор попал на рабочую поверхность`);
          if (surface.selector !== '.schedule-toolbar') {
            assert.notEqual(surface.color, 'rgba(0, 0, 0, 0)', `${theme} ${width}px ${surface.selector}: поверхность стала прозрачной`);
          }
        }
        if ((width === 390 || width === 1440) && visibilityThemes.has(theme)) {
          const withTexture = await page.screenshot();
          await page.addStyleTag({ content:'.provider-body[data-provider-theme][data-provider-layout]::before{content:none!important}' });
          const withoutTexture = await page.screenshot();
          await page.evaluate(() => document.head.lastElementChild.remove());
          assert.equal(withTexture.equals(withoutTexture), false, `${theme} ${width}px: псевдоэлемент вычисляется, но не рисуется`);
        }
        if (output && screenshotThemes.has(theme)) {
          await page.screenshot({ path:path.join(output, `${theme}-${width}.png`), fullPage:true });
        }
      }
      for (const theme of approvedThemes) {
        const approved = await page.evaluate(themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const style = getComputedStyle(document.body);
          return { image:style.backgroundImage, repeat:style.backgroundRepeat, size:style.backgroundSize, overflow:document.documentElement.scrollWidth > innerWidth + 2 };
        }, theme);
        const variant = width <= 760 ? 'mobile' : 'desktop';
        assert.match(approved.image, new RegExp(`provider-${theme}-${variant}-v2\\.webp`), `${theme} ${width}px: утверждённый фон ТЕМЫ 1 потерян`);
        assert.equal(approved.repeat.split(',').every(value => value.trim() === 'no-repeat'), true, `${theme} ${width}px: утверждённый фон начал повторяться`);
        assert.equal(approved.size.split(',').every(value => value.trim() === 'cover'), true, `${theme} ${width}px: утверждённый фон перестал покрывать холст`);
        assert.equal(approved.overflow, false, `${theme} ${width}px: появился горизонтальный overflow`);
      }
    }
    const previews = await page.evaluate(themeKeys => themeKeys.map(theme => {
      const swatch = document.querySelector(`.provider-theme-option.theme-${theme} .theme-swatch`);
      return { theme, image:swatch ? getComputedStyle(swatch).backgroundImage : 'missing' };
    }), themes);
    for (const preview of previews) assert.notEqual(preview.image, 'none', `${preview.theme}: превью не показывает новый мотив`);
    console.log('Provider theme family browser matrix: PASS (37 CSS families + 3 approved canvases × 3 widths).');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
