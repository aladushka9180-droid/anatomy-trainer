import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const context = { window:{} };
vm.runInNewContext(readFileSync(resolve(root, 'theme-catalog.js'), 'utf8'), context);
const themes = [...context.window.MinutaThemeCatalog.themeKeys];
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true });
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };

function luminance(color) {
  const rgb = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)?.slice(1).map(Number);
  assert.ok(rgb, `Unsupported navigation color: ${color}`);
  const linear = rgb.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

try {
  const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width:1440, height:900 } });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://organization-nav.test' || route.request().method() !== 'GET') return route.abort();
    if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
    const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
    if (relative.includes('..')) return route.abort();
    try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
    catch { return route.abort(); }
  });
  await page.goto('https://organization-nav.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#authCard').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'organization';
    document.body.dataset.providerLayout = 'soft';
    const nav = document.querySelector('.provider-nav [data-provider-view="organization"]');
    nav.classList.add('active');
    nav.style.transition = 'none';
  });
  for (const theme of themes) {
    const state = await page.evaluate(theme => {
      document.body.dataset.providerTheme = theme;
      const button = document.querySelector('.provider-nav [data-provider-view="organization"]');
      const style = getComputedStyle(button);
      return { visible:button.checkVisibility(), color:style.color, background:style.backgroundColor,
        overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth };
    }, theme);
    assert.ok(state.visible, `${theme}: active Organization navigation is hidden`);
    assert.ok(state.overflow <= 1, `${theme}: horizontal overflow ${state.overflow}`);
    assert.ok(contrast(state.color, state.background) >= 4.5,
      `${theme}: active Organization contrast ${contrast(state.color, state.background).toFixed(2)}:1`);
    if (theme === 'graphite' && process.env.MINUTA_NAV_SCREENSHOT) {
      await page.screenshot({ path:process.env.MINUTA_NAV_SCREENSHOT, fullPage:false });
    }
  }
  for (const width of [390, 760]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of ['pink-porcelain', 'graphite']) {
      const overflow = await page.evaluate(theme => {
        document.body.dataset.providerTheme = theme;
        return document.documentElement.scrollWidth - document.documentElement.clientWidth;
      }, theme);
      assert.ok(overflow <= 1, `${theme}/${width}: horizontal overflow ${overflow}`);
    }
  }
} finally { await browser.close(); }

console.log(`Active Organization navigation contrast: ${themes.length} themes at 1440px; 390/760px overflow PASS`);
