import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const catalog = { window:{} };
runInNewContext(readFileSync(new URL('../theme-catalog.js', import.meta.url), 'utf8'), catalog);
const themes = catalog.window.MinutaThemeCatalog.themes;
const styles = ['styles.css', 'provider-theme-loft-modern.css', 'provider-themes-signature.css',
  'provider-themes-calm.css', 'provider-themes-wildlife.css', 'provider-theme-noir-safari.css',
  'provider-themes-distinct.css', 'provider-theme-families.css', 'provider-theme-backgrounds-tema1.css',
  'provider-ux.css'].map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:800 } });
    await page.goto('about:blank');
    await page.evaluate(source => {
      const section = new DOMParser().parseFromString(source, 'text/html').querySelector('.report-clients');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'sage-studio';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.padding = '12px';
      document.body.append(document.importNode(section, true));
    }, html);
    await page.addStyleTag({ content:styles });
    for (const theme of themes) {
      const state = await page.evaluate(key => {
      document.body.dataset.providerTheme = key;
      const label = document.querySelector('.report-clients .report-metric-row article span');
      const metrics = document.querySelector('.report-clients .report-metric-row');
      return { labelVisible:label.getBoundingClientRect().height > 0,
        labelClipped:label.scrollWidth > label.clientWidth + 1,
        metricOverflow:metrics.scrollWidth > metrics.clientWidth + 1,
        documentOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        whiteSpace:getComputedStyle(label).whiteSpace };
      }, theme.key);
      assert.deepEqual(state, { labelVisible:true,labelClipped:false,metricOverflow:false,
        documentOverflow:false,whiteSpace:'normal' }, `${theme.key} ${width}px`);
    }
    if (process.env.MINUTA_ANALYTICS_SCREENSHOT_DIR) {
      mkdirSync(process.env.MINUTA_ANALYTICS_SCREENSHOT_DIR, { recursive:true });
      await page.locator('.report-clients').screenshot({ path:join(process.env.MINUTA_ANALYTICS_SCREENSHOT_DIR, `analytics-clients-${width}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
