import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_SCREENSHOT_DIR ? resolve(process.env.MINUTA_SCREENSHOT_DIR) : '';
if (output) mkdirSync(output, { recursive:true });
const source = readFileSync(resolve(root, 'organization.js'), 'utf8');
const start = source.indexOf('function locationCard(');
const end = source.indexOf('\n    function memberCard(', start);
assert.ok(start >= 0 && end > start, 'locationCard source must be present');
const locationCardSource = source.slice(start, end);
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><body class="provider-body" data-provider-theme="loft"><main style="width:min(100%,700px);margin:auto"><div id="cards"></div></main></body></html>');
    await page.addStyleTag({ path:resolve(root, 'styles.css') });
    await page.addScriptTag({ content:`const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); ${locationCardSource}; window.renderLocationCard=locationCard;` });
    await page.evaluate(() => {
      const first = { id:'branch-a', name:'Основной филиал', address:'Город, улица, дом', timezone:'Europe/Samara', active:true, is_primary:true };
      const second = { id:'branch-b', name:'Второй филиал', address:'', timezone:'Asia/Yekaterinburg', active:true, is_primary:false };
      document.querySelector('#cards').innerHTML = renderLocationCard(first, true) + renderLocationCard(second, false);
    });
    const labels = page.locator('.organization-location-zone');
    assert.equal(await labels.count(), 2, `${width}: zone labels for managed and read-only cards`);
    assert.match(await page.locator('[data-location-card="branch-a"] summary').innerText(), /Часовой пояс: Europe\/Samara/);
    assert.match(await page.locator('#cards article').innerText(), /Часовой пояс: Asia\/Yekaterinburg/);
    const geometry = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - innerWidth,
      labels:[...document.querySelectorAll('.organization-location-zone')].map(element => ({
        visible:element.getBoundingClientRect().width > 0,
        fontSize:parseFloat(getComputedStyle(element).fontSize)
      }))
    }));
    assert.ok(geometry.overflow <= 1, `${width}: horizontal overflow ${geometry.overflow}`);
    assert.ok(geometry.labels.every(label => label.visible && label.fontSize >= 12), `${width}: readable zone labels ${JSON.stringify(geometry.labels)}`);
    if (output) await page.screenshot({ path:resolve(output, `o03-location-${width}.png`), fullPage:true });
    await page.close();
  }
  console.log('Organization location zone summary passed at 390, 760 and 1440');
} finally { await browser.close(); }
