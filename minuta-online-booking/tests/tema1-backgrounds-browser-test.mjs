import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const themes = ['snow-leopard', 'pearl-zebra', 'midnight'];
const desktopArtworkVersion = theme => theme === 'pearl-zebra' ? 'v3' : 'v2';
const artworkFor = (theme, width) => theme === 'midnight'
  ? 'provider-midnight-navy-velvet-v1.webp'
  : `provider-${theme}-${width <= 760 ? 'mobile' : 'desktop'}-${desktopArtworkVersion(theme)}.webp`;
const swatchArtworkFor = theme => theme === 'midnight'
  ? 'provider-midnight-navy-velvet-v1.webp'
  : `provider-${theme}-desktop-${desktopArtworkVersion(theme)}.webp`;

const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH || undefined });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET' || url.origin !== 'https://tema1.test') return route.abort();
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
  await page.goto('https://tema1.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting');
    document.body.className = 'provider-body authenticated';
    document.body.dataset.providerLayout = 'capsule';
    const fixture = document.createElement('div');
    fixture.id = 'tema1Fixture';
    fixture.innerHTML = '<div class="provider-app"><div class="provider-workspace"><div class="provider-view"><div class="schedule-card"><div class="date-navigation"></div><div class="timeline-stage"><div class="timeline-booking"></div></div></div></div></div></div>';
    document.body.append(fixture);
  });

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of themes) {
      const result = await page.evaluate(activeTheme => {
        document.body.dataset.providerTheme = activeTheme;
        const body = getComputedStyle(document.body);
        const app = getComputedStyle(document.querySelector('#tema1Fixture .provider-app'));
        const workspace = getComputedStyle(document.querySelector('#tema1Fixture .provider-workspace'));
        const stage = getComputedStyle(document.querySelector('#tema1Fixture .timeline-stage'));
        const booking = getComputedStyle(document.querySelector('#tema1Fixture .timeline-booking'));
        const option = document.querySelector('.provider-theme-option');
        const swatch = document.querySelector(`.theme-${activeTheme} .theme-swatch`);
        return {
          bodyImage:body.backgroundImage,
          repeat:body.backgroundRepeat,
          size:body.backgroundSize,
          attachment:body.backgroundAttachment,
          appImage:app.backgroundImage,
          appColor:app.backgroundColor,
          workspaceImage:workspace.backgroundImage,
          workspaceColor:workspace.backgroundColor,
          stageImage:stage.backgroundImage,
          bookingImage:booking.backgroundImage,
          optionRadius:getComputedStyle(option).borderTopLeftRadius,
          optionOverflow:getComputedStyle(option).overflow,
          swatchImage:getComputedStyle(swatch).backgroundImage,
          scrollWidth:document.documentElement.scrollWidth,
          clientWidth:document.documentElement.clientWidth,
        };
      }, theme);
      assert.match(result.bodyImage, new RegExp(artworkFor(theme, width).replace('.', '\\.')), `${theme}/${width}: wrong responsive artwork`);
      if (theme === 'midnight') {
        assert.match(result.bodyImage, /radial-gradient/, `${theme}/${width}: calm vignette is missing`);
        assert.match(result.bodyImage, /rgba\(3, 12, 25, 0\.68\)/, `${theme}/${width}: texture overlay is not dark enough`);
      }
      assert.ok(result.repeat.split(',').every(value => value.trim() === 'no-repeat'), `${theme}/${width}: artwork must not tile`);
      assert.ok(result.size.split(',').every(value => value.trim() === 'cover'), `${theme}/${width}: artwork must fit the viewport`);
      assert.ok(result.attachment.split(',').every(value => value.trim() === 'fixed'), `${theme}/${width}: artwork must stay viewport-bound`);
      assert.equal(result.appImage, 'none', `${theme}/${width}: app must not duplicate texture`);
      assert.equal(result.workspaceImage, 'none', `${theme}/${width}: workspace must not duplicate texture`);
      if (width <= 760) {
        assert.equal(result.appColor, 'rgba(0, 0, 0, 0)', `${theme}/${width}: app canvas must reveal the body artwork`);
        assert.equal(result.workspaceColor, 'rgba(0, 0, 0, 0)', `${theme}/${width}: workspace canvas must reveal the body artwork`);
      }
      assert.equal(result.stageImage, 'none', `${theme}/${width}: schedule stage must remain texture-free`);
      assert.equal(result.bookingImage, 'none', `${theme}/${width}: booking must remain texture-free`);
      assert.equal(result.optionRadius, '13px', `${theme}/${width}: picker card became an oval`);
      assert.equal(result.optionOverflow, 'hidden', `${theme}/${width}: picker artwork can escape its card`);
      assert.match(result.swatchImage, new RegExp(swatchArtworkFor(theme).replace('.', '\\.')), `${theme}/${width}: picker preview must match the theme`);
      assert.ok(result.scrollWidth <= result.clientWidth, `${theme}/${width}: horizontal overflow detected`);
    }
  }
  console.log('TEMA 1 approved provider backgrounds: PASS at 390/760/1440');
} finally {
  await browser.close();
}
