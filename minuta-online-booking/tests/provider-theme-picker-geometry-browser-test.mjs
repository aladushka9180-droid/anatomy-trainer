import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const providerHtml = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const { chromium } = playwrightModule.chromium ? playwrightModule : playwrightModule.default;
const mime = { '.html':'text/html', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const output = process.env.MINUTA_THEME_OUTPUT;
if (output) mkdirSync(output, { recursive:true });

const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH || undefined });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'https://picker.test') return route.abort();
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
  await page.goto('https://picker.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    const options = document.querySelector('.provider-theme-options');
    for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"]')) document.head.append(stylesheet);
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level');
    document.body.replaceChildren(options);
    document.body.className = 'provider-body authenticated';
    document.body.dataset.providerLayout = 'capsule';
    document.body.style.margin = '0';
    document.body.style.padding = '12px';
    options.style.maxWidth = '1110px';
    options.style.margin = '0 auto';
    options.style.opacity = '1';
    options.style.visibility = 'visible';
    for (const option of options.children) option.hidden = false;
  });

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of [
      'snow-leopard',
      'apricot-tiger',
      'pearl-zebra',
      'noir-rose',
      'cocoa-pearl',
      'plum-cashmere',
      'obsidian-champagne',
    ]) {
      const result = await page.evaluate(activeTheme => {
        document.body.dataset.providerTheme = activeTheme;
        const cards = [...document.querySelectorAll('.provider-theme-option')];
        const rects = cards.map(card => card.getBoundingClientRect());
        const radii = cards.map(card => Number.parseFloat(getComputedStyle(card).borderTopLeftRadius));
        const overlaps = [];
        for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]; const b = rects[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push([i, j]);
        }
        return {
          count:cards.length,
          radii,
          overlaps,
          bodyScrollWidth:document.documentElement.scrollWidth,
          viewportWidth:innerWidth,
          minWidth:Math.min(...rects.map(rect => rect.width)),
          maxRight:Math.max(...rects.map(rect => rect.right)),
        };
      }, theme);
      assert.equal(result.count, 40, `${theme}/${width}: all theme cards must remain in the picker`);
      assert.ok(result.radii.every(radius => radius === 13), `${theme}/${width}: selected theme reshaped picker cards into large ovals (${[...new Set(result.radii)].join(', ')})`);
      assert.deepEqual(result.overlaps, [], `${theme}/${width}: picker cards overlap`);
      assert.ok(result.minWidth >= 140, `${theme}/${width}: picker cards became too narrow`);
      assert.ok(result.maxRight <= result.viewportWidth + 0.5, `${theme}/${width}: picker overflows the viewport`);
      assert.equal(result.bodyScrollWidth, result.viewportWidth, `${theme}/${width}: horizontal overflow detected`);
      if (output) {
        await page.locator(`input[value="${theme}"]`).evaluate(input => input.parentElement.scrollIntoView({ block:'center' }));
        await page.screenshot({ path:resolve(output, `picker-${theme}-${width}.png`) });
      }
    }
  }
  console.log('Provider theme picker geometry: PASS at 390/760/1440');
} finally {
  await browser.close();
}
