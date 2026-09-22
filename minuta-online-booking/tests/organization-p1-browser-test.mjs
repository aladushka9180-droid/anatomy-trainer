import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const calmCss = readFileSync(resolve(root, 'provider-themes-calm.css'), 'utf8');
assert.match(calmCss, /:focus-visible\s*\{[\s\S]*?outline-width:2px!important;[\s\S]*?outline-color:var\(--theme-accent,#235b40\)!important;/, 'theme focus must retain a visible fallback');
const screenshots = process.env.ORGANIZATION_P1_SCREENSHOTS ? resolve(process.env.ORGANIZATION_P1_SCREENSHOTS) : '';
if (screenshots) mkdirSync(screenshots, { recursive:true });

function luminance([red, green, blue]) {
  const values = [red, green, blue].map(value => { const ratio = value / 255; return ratio <= .03928 ? ratio / 12.92 : ((ratio + .055) / 1.055) ** 2.4; });
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
}
function rgb(value) {
  const match = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}
function contrast(foreground, background) {
  const front = rgb(foreground), back = rgb(background);
  if (!front || !back) return 0;
  const [bright, dark] = [luminance(front), luminance(back)].sort((a, b) => b - a);
  return (bright + .05) / (dark + .05);
}

const browser = await chromium.launch({ headless:true });
const errors = [], results = [];
try {
  for (const width of [390, 760, 1440]) {
    for (const theme of ['warm', 'graphite', 'lavender', 'warm-beige']) {
      const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:1100 } });
      page.on('pageerror', error => errors.push(`${width}/${theme}: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') errors.push(`${width}/${theme}: ${message.text()}`); });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://organization-p1.test' || route.request().method() !== 'GET') return route.abort();
        if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
        const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
        if (relative.includes('..')) return route.abort();
        try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
        catch { return route.abort(); }
      });
      await page.goto('https://organization-p1.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
      await page.evaluate(({ theme }) => {
        document.documentElement.classList.remove('provider-booting', 'requires-top-level');
        document.documentElement.classList.add('top-level');
        document.querySelector('#providerBoot')?.remove();
        document.querySelector('#authCard').hidden = true;
        document.querySelector('#dashboard').hidden = false;
        document.body.dataset.providerTheme = theme;
        document.body.dataset.providerLayout = 'linear';
        document.querySelectorAll('[data-provider-panel]').forEach(panel => {
          panel.hidden = panel.dataset.providerPanel !== 'organization';
          panel.classList.toggle('active', !panel.hidden);
        });
        document.querySelectorAll('.provider-nav [data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === 'organization'));
        document.querySelector('#organizationLoading').hidden = true;
        document.querySelector('#organizationWorkspace').hidden = false;
        document.querySelectorAll('#organizationWorkspace > :not(#organizationSectionNav):not(#paymentProviderPanel):not(#organizationPeopleSection)').forEach(node => { node.hidden = true; });
        document.querySelector('#organizationPeopleSection').hidden = false;
        document.querySelector('#locationCreator').open = true;
        document.querySelector('#paymentProviderPanel').hidden = false;
        document.querySelector('#paymentSandboxDisclosure').open = true;
        document.querySelector('#paymentSandboxWorkspace').hidden = false;
        document.querySelectorAll('#organizationSectionNav button').forEach(button => button.classList.toggle('active', button.dataset.sectionTarget === 'paymentProviderPanel'));
      }, { theme });
      const state = await page.evaluate(() => {
        const styleOf = selector => {
          const node = document.querySelector(selector); node.focus(); const style = getComputedStyle(node); const box = node.getBoundingClientRect();
          return { visible:node.checkVisibility(), color:style.color, background:style.backgroundColor, outlineStyle:style.outlineStyle, outlineWidth:style.outlineWidth, width:box.width, height:box.height };
        };
        return {
          mainNav:styleOf('.provider-nav [data-provider-view="organization"]'),
          sectionNav:styleOf('#organizationSectionNav [data-section-target="paymentProviderPanel"]'),
          sandbox:styleOf('#paymentSandboxForm button[type="submit"]'),
          timezone:styleOf('#locationTimezone'),
          timezoneType:document.querySelector('#locationTimezone').type,
          timezoneValue:document.querySelector('#locationTimezone').value,
          overflow:Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        };
      });
      const keyboardFocus = async selector => {
        const locator = page.locator(selector);
        await locator.focus();
        const initiallyFocused = await locator.evaluate(node => document.activeElement === node);
        await page.keyboard.press('Tab');
        const moved = await locator.evaluate(node => document.activeElement !== node);
        await page.keyboard.press('Shift+Tab');
        return locator.evaluate((node, state) => {
          const style = getComputedStyle(node);
          return { ...state, returned:document.activeElement === node, focusVisible:node.matches(':focus-visible'), outlineStyle:style.outlineStyle, outlineWidth:parseFloat(style.outlineWidth) || 0 };
        }, { initiallyFocused, moved });
      };
      const sandboxFocus = await keyboardFocus('#paymentSandboxForm button[type="submit"]');
      const timezoneFocus = await keyboardFocus('#locationTimezone');
      assert.equal(state.timezoneType, 'text', `${width}/${theme}: timezone must be explicit`);
      assert.equal(state.timezoneValue, 'Europe/Samara');
      assert.equal(state.timezone.visible, true);
      assert.ok(state.overflow <= 1, `${width}/${theme}: document overflow=${state.overflow}`);
      for (const [name, control] of Object.entries({ sandbox:state.sandbox })) {
        assert.equal(control.visible, true, `${width}/${theme}/${name}: invisible`);
        assert.ok(contrast(control.color, control.background) >= 4.5, `${width}/${theme}/${name}: contrast ${contrast(control.color, control.background).toFixed(2)}`);
      }
      for (const [name, focus] of Object.entries({ sandbox:sandboxFocus, timezone:timezoneFocus })) {
        assert.equal(focus.initiallyFocused, true, `${width}/${theme}/${name}: control cannot receive focus`);
        assert.equal(focus.moved, true, `${width}/${theme}/${name}: Tab did not move focus`);
        assert.equal(focus.returned, true, `${width}/${theme}/${name}: Shift+Tab did not restore focus`);
        assert.equal(focus.focusVisible, true, `${width}/${theme}/${name}: keyboard focus is not visibly classified`);
        assert.notEqual(focus.outlineStyle, 'none', `${width}/${theme}/${name}: focus outline is missing ${JSON.stringify(focus)}`);
        assert.ok(focus.outlineWidth >= 2, `${width}/${theme}/${name}: focus outline is too thin ${JSON.stringify(focus)}`);
      }
      if (width === 1440) {
        assert.equal(state.mainNav.visible, true, `${theme}: Organization nav must be visible at 1440`);
        assert.ok(contrast(state.mainNav.color, state.mainNav.background) >= 4.5, `${theme}: Organization nav contrast is too low ${JSON.stringify(state.mainNav)}`);
        assert.equal(state.sectionNav.visible, true, `${theme}: active Organization subsection must be visible at 1440`);
        assert.ok(contrast(state.sectionNav.color, state.sectionNav.background) >= 4.5, `${theme}: active Organization subsection contrast is too low`);
        const mainFocus = await keyboardFocus('.provider-nav [data-provider-view="organization"]');
        const sectionFocus = await keyboardFocus('#organizationSectionNav [data-section-target="paymentProviderPanel"]');
        for (const [name, focus] of Object.entries({ main:mainFocus, section:sectionFocus })) {
          assert.equal(focus.returned, true, `${theme}: active Organization ${name} navigation is not keyboard reachable`);
          assert.notEqual(focus.outlineStyle, 'none', `${theme}: active Organization ${name} navigation focus is missing`);
          assert.ok(focus.outlineWidth >= 2, `${theme}: active Organization ${name} navigation focus is too thin`);
        }
      }
      results.push({ width, theme, state });
      if (screenshots && theme === 'warm') await page.screenshot({ path:resolve(screenshots, `organization-p1-${width}.png`), fullPage:true });
      await page.close();
    }
  }
} finally { await browser.close(); }

assert.deepEqual(errors, []);
console.log(JSON.stringify({ cases:results.length, widths:[390,760,1440], themes:['warm','graphite','lavender','warm-beige'], maxOverflow:Math.max(...results.map(item => item.state.overflow)) }));
