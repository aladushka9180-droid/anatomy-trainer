import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8');
const output = process.env.MINUTA_SCREENSHOT_DIR ? resolve(process.env.MINUTA_SCREENSHOT_DIR) : '';
if (output) mkdirSync(output, { recursive:true });
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><body class="provider-body client-profile-detail-open" data-provider-theme="loft" data-provider-layout="standard"><main class="provider-main"><section class="provider-dashboard" data-provider-panel="clients"><div class="clients-layout is-detail" id="clientsLayout"></div></section></main></body></html>');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const profile = parsed.querySelector('.client-profile');
      document.querySelector('#clientsLayout').append(document.importNode(profile, true));
      document.querySelector('#clientProfileContent').hidden = false;
      document.querySelector('#clientProfileEmpty').hidden = true;
      document.querySelector('#clientName').textContent = 'Тестовый клиент с длинной историей';
      document.querySelector('#clientQuickRepeat').hidden = false;
      document.querySelector('#clientContactButton').hidden = false;
      document.querySelector('#clientRecords').hidden = false;
      document.querySelector('#clientRecords').innerHTML = Array.from({ length:24 }, (_, index) => `<article class="client-history-item"><div><strong>Визит ${index + 1}</strong><small>Тестовая услуга · 60 минут</small></div><span>Состоялся</span></article>`).join('');
      document.querySelector('#clientResultsList').innerHTML = Array.from({ length:12 }, (_, index) => `<article class="client-history-item"><strong>Тестовый файл ${index + 1}</strong></article>`).join('');
    }, html);
    for (const name of ['styles.css', 'provider-ux.css', 'client-records.css', 'client-directory.css', 'provider-ui-refinements.css', 'provider-clients-premium.css']) {
      await page.addStyleTag({ path:resolve(root, name) });
    }
    const measure = () => page.evaluate(() => {
      const bounds = selector => document.querySelector(selector).getBoundingClientRect();
      return {
        action:bounds('#clientQuickRepeat').toJSON(), tabs:bounds('.client-profile-tabs').toJSON(),
        history:bounds('#clientRecords').toJSON(), filesHidden:document.querySelector('#clientProfilePanelFiles').hidden,
        historyCount:document.querySelectorAll('#clientRecords .client-history-item').length,
        overflow:document.documentElement.scrollWidth - innerWidth,
        pageHeight:document.documentElement.scrollHeight
      };
    });
    const history = await measure();
    assert.equal(history.historyCount, 24, `${width}: long synthetic history loaded`);
    assert.ok(history.action.bottom < history.tabs.top && history.tabs.bottom < history.history.top, `${width}: main action precedes long history`);
    assert.ok(history.action.top < 900 && history.action.height >= 44, `${width}: main action visible in first viewport`);
    assert.ok(history.pageHeight > 900, `${width}: profile is genuinely long`);
    assert.equal(history.filesHidden, true, `${width}: files stay out of initial history view`);
    assert.ok(history.overflow <= 1, `${width}: horizontal overflow ${history.overflow}`);
    if (output) await page.screenshot({ path:resolve(output, `x04-history-${width}.png`), fullPage:true });
    await page.close();
  }
  console.log('Long client profile hierarchy passed on synthetic data at 390, 760 and 1440');
} finally { await browser.close(); }
