import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8');
const metrics = html.match(/<div class="report-command-metrics">[\s\S]*?<\/div>/)?.[0];
const exportDialog = html.match(/<dialog class="report-export-dialog"[\s\S]*?<\/dialog>/)?.[0];
assert.ok(metrics && exportDialog, 'statistics metrics and export dialog exist');

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await page.setContent(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><body class="provider-body" data-provider-theme="loft" data-provider-layout="standard"><main id="analyticsView" data-report-tab="overview"><section id="reportCommandCenter">${metrics}</section>${exportDialog}</main></body></html>`);
    await page.addStyleTag({ path:resolve(root, 'styles.css') });
    await page.addStyleTag({ path:resolve(root, 'provider-ux.css') });
    const state = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.report-command-metrics article')];
      const font = card => parseFloat(getComputedStyle(card.querySelector('strong')).fontSize);
      return {
        primary:font(cards[0]), secondary:cards.slice(1).map(font),
        overflow:document.documentElement.scrollWidth - innerWidth,
        exportHintVisible:!!document.querySelector('.report-export-note')?.getClientRects().length
      };
    });
    assert.ok(state.secondary.every(size => size <= state.primary - 4), `${width}: primary metric must be visually stronger: ${JSON.stringify(state)}`);
    assert.ok(state.overflow <= 1, `${width}: horizontal overflow ${state.overflow}`);
    assert.equal(state.exportHintVisible, false, `${width}: Excel hint stays inside closed export dialog`);
    await page.close();
  }
  console.log('Statistics metric hierarchy and contextual export hint passed at 390, 760 and 1440');
} finally { await browser.close(); }
