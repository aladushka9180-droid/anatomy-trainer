import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = process.env.MINUTA_THEME_ALIGNMENT_OUTPUT;
if (output) mkdirSync(output, { recursive:true });
const catalog = readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const providerHtml = readFileSync(path.join(root, 'provider.html'), 'utf8');
const styles = readFileSync(path.join(root, 'styles.css'), 'utf8');
const themes = [...catalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.equal(themes.length, 40, 'the complete provider theme catalog must be covered');
for (const label of [
  'Адреса и часовые пояса',
  'Роли и онлайн-запись',
  'Кабинеты и оборудование',
  'Расписание по филиалам',
  'Начисления и выплаты команды',
  'Интернет-эквайринг',
  'Единая операция',
  'Возврат клиентов и предоплаченные услуги',
  'Товары, материалы и расходники'
]) {
  assert.match(providerHtml, new RegExp(`<div class="panel-head"><div><small>${label}`), `${label} must use the shared panel eyebrow`);
}
assert.match(styles, /\.panel-head small \{ color:var\(--theme-accent,var\(--green\)\)/, 'shared panel eyebrow must use the theme accent token');
assert.doesNotMatch(styles, /\.panel-head small \{ color:#[0-9a-f]{3,8}/i, 'shared panel eyebrow must not hardcode a sage/green literal');

const mime = {
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.webp':'image/webp',
  '.woff2':'font/woff2'
};
const server = createServer((request, response) => {
  const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${name}`);
  if (!file.startsWith(`${root}${path.sep}`) || request.method !== 'GET') {
    response.writeHead(400).end();
    return;
  }
  try {
    let bytes = readFileSync(file);
    if (name === '/provider.html') {
      bytes = Buffer.from(bytes.toString()
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<script\b[^>]*><\/script>/gi, '')
        .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, ''));
    }
    response.writeHead(200, { 'content-type':mime[path.extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser = await chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });

function contrastRatio(foreground, background) {
  const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
    const normalized = channel / 255;
    return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  });
  const luminance = value => {
    const [red, green, blue] = channels(value);
    return .2126 * red + .7152 * green + .0722 * blue;
  };
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + .05) / (dark + .05);
}

try {
  for (const width of [390, 760, 1440]) {
    const context = await browser.newContext({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await context.route('**/*', route => {
      const request = route.request();
      return new URL(request.url()).origin === origin && request.method() === 'GET' ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${origin}/provider.html`, { waitUntil:'domcontentloaded' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.insertAdjacentHTML('beforeend', `
        <section id="themeAlignmentFixture" style="position:relative;width:min(320px,calc(100vw - 24px));margin:12px;">
          <nav class="provider-nav" aria-label="Test navigation">
            <button id="fixtureNotification" type="button"><span class="nav-icon" aria-hidden="true">●</span><span>Уведомления</span><b id="fixtureBadge">4</b></button>
          </nav>
          <div class="organization-checks" style="margin-top:12px">
            <label><input id="fixtureChecked" type="checkbox" checked><span>Активен</span></label>
            <label><input id="fixtureDisabled" type="checkbox" checked disabled><span>Основной</span></label>
          </div>
          <div class="organization-audit-list"><article><span id="fixtureAuditDot"></span><div><strong>Изменение</strong><small>Система</small></div></article></div>
          <div class="panel-head"><div><small id="fixtureEyebrow">Товары, материалы и расходники</small><h3>Складской учёт</h3></div></div>
        </section>`);
      const stable = document.createElement('style');
      stable.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.append(stable);
    });

    for (const theme of themes) {
      const state = await page.evaluate(async themeKey => {
        document.body.dataset.providerTheme = themeKey;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const normalizeColor = value => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.append(probe);
          const result = getComputedStyle(probe).color;
          probe.remove();
          return result;
        };
        const badge = document.querySelector('#fixtureBadge');
        const checked = document.querySelector('#fixtureChecked');
        const disabled = document.querySelector('#fixtureDisabled');
        const dot = document.querySelector('#fixtureAuditDot');
        const eyebrow = document.querySelector('#fixtureEyebrow');
        const nav = document.querySelector('#fixtureNotification');
        let clicks = 0;
        nav.onclick = () => { clicks += 1; };
        nav.click();
        checked.focus();
        const oneDigitWidth = badge.getBoundingClientRect().width;
        badge.textContent = '12';
        const twoDigitWidth = badge.getBoundingClientRect().width;
        const badgeStyle = getComputedStyle(badge);
        const checkedStyle = getComputedStyle(checked);
        const disabledStyle = getComputedStyle(disabled);
        const dotStyle = getComputedStyle(dot);
        const eyebrowStyle = getComputedStyle(eyebrow);
        const accent = normalizeColor(getComputedStyle(document.body).getPropertyValue('--theme-accent'));
        const contrast = normalizeColor(getComputedStyle(document.body).getPropertyValue('--theme-accent-contrast'));
        badge.hidden = true;
        const hiddenDisplay = getComputedStyle(badge).display;
        badge.hidden = false;
        badge.textContent = '4';
        return {
          clicks,
          accent,
          contrast,
          badgeDisplay:badgeStyle.display,
          badgePlaceItems:badgeStyle.placeItems,
          badgeLineHeight:badgeStyle.lineHeight,
          badgeFontSize:badgeStyle.fontSize,
          badgeHeight:badge.getBoundingClientRect().height,
          oneDigitWidth,
          twoDigitWidth,
          hiddenDisplay,
          checkedAppearance:checkedStyle.appearance,
          checkedBackground:checkedStyle.backgroundColor,
          checkedColor:checkedStyle.color,
          checkedOutlineStyle:checkedStyle.outlineStyle,
          checkedOutlineWidth:checkedStyle.outlineWidth,
          disabledBackground:disabledStyle.backgroundColor,
          disabledOpacity:Number(disabledStyle.opacity),
          disabledCursor:disabledStyle.cursor,
          dotBackground:dotStyle.backgroundColor,
          eyebrowColor:eyebrowStyle.color,
          overflow:document.querySelector('#themeAlignmentFixture').scrollWidth > document.querySelector('#themeAlignmentFixture').clientWidth + 1
        };
      }, theme);

      assert.equal(state.clicks, 1, `${theme} ${width}px: notification item must remain clickable`);
      assert.equal(state.badgeDisplay, 'grid', `${theme} ${width}px: badge must center its content with grid layout`);
      assert.equal(state.badgePlaceItems, 'center', `${theme} ${width}px: badge content must be centered on both axes`);
      assert.ok(Math.abs(parseFloat(state.badgeLineHeight) - parseFloat(state.badgeFontSize)) < .1, `${theme} ${width}px: badge line box must not lift the digit`);
      assert.ok(state.badgeHeight >= 23, `${theme} ${width}px: badge must preserve its theme-specific minimum height`);
      assert.ok(state.twoDigitWidth >= state.oneDigitWidth, `${theme} ${width}px: two-digit badge must not collapse`);
      assert.equal(state.hiddenDisplay, 'none', `${theme} ${width}px: hidden badge must remain absent`);
      assert.equal(state.checkedAppearance, 'none', `${theme} ${width}px: organization checkbox must use the themed control`);
      assert.equal(state.checkedBackground, state.accent, `${theme} ${width}px: checked control must use the theme accent`);
      assert.equal(state.checkedColor, state.contrast, `${theme} ${width}px: check mark must use the theme contrast token`);
      assert.notEqual(state.checkedOutlineStyle, 'none', `${theme} ${width}px: keyboard focus must stay visible`);
      assert.ok(parseFloat(state.checkedOutlineWidth) >= 2, `${theme} ${width}px: focus outline must be at least 2px`);
      assert.equal(state.disabledBackground, state.accent, `${theme} ${width}px: checked disabled control must retain the theme accent`);
      assert.ok(state.disabledOpacity > .45 && state.disabledOpacity < .8, `${theme} ${width}px: disabled state must remain distinct`);
      assert.equal(state.disabledCursor, 'not-allowed', `${theme} ${width}px: disabled state must remain explicit`);
      assert.ok(contrastRatio(state.checkedColor, state.checkedBackground) >= 3, `${theme} ${width}px: check mark contrast is too low`);
      assert.equal(state.dotBackground, state.accent, `${theme} ${width}px: neutral audit marker must use the theme accent`);
      assert.equal(state.eyebrowColor, state.accent, `${theme} ${width}px: decorative section label must use the theme accent`);
      assert.equal(state.overflow, false, `${theme} ${width}px: alignment fixture must not overflow`);
      if (output && theme === 'carbon-crimson') {
        await page.locator('#themeAlignmentFixture').screenshot({ path:path.join(output, `carbon-crimson-alignment-${width}.png`) });
      }
    }
    console.log(`Provider theme token alignment: PASS at ${width}px across ${themes.length} themes`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
