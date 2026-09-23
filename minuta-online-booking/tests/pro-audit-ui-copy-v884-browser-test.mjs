import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const organization = readFileSync(new URL('../organization.js', import.meta.url), 'utf8');
assert.match(organization, /Часовой пояс: \$\{escapeHtml\(location\.timezone \|\| 'Europe\/Samara'\)\}/);
assert.match(html, /Новый филиал создаётся с часовым поясом Europe\/Samara/);

const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await page.setContent('<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width"><body></body></html>');
    await page.addStyleTag({ content:css });
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source,'text/html');
      const shell = document.createElement('main');
      shell.className = 'settings-layout';
      for (const id of ['locationCreator','dataGovernanceCard','fullDataExportDialog']) {
        const item = parsed.getElementById(id);
        if (!item) throw new Error(`Missing actual ${id}`);
        shell.append(item);
      }
      document.body.replaceChildren(shell);
      document.getElementById('locationCreator').open = true;
      document.getElementById('dataGovernanceCard').dataset.owner = 'true';
      document.getElementById('dataGovernanceCard').querySelectorAll('details').forEach(item => { item.open = true; });
    }, html);
    for (const label of ['Новый филиал создаётся с часовым поясом Europe/Samara',
      'Автоматического восстановления из ZIP в кабинете нет.',
      'Запросить удаление аккаунта','Запросить удаление организации']) {
      assert.ok(await page.getByText(label,{ exact:false }).first().isVisible(), `${width}px: ${label}`);
    }
    const geometry = await page.evaluate(() => ({
      viewport:innerWidth,
      shell:document.querySelector('main').getBoundingClientRect().right,
      overflow:document.documentElement.scrollWidth-innerWidth
    }));
    assert.ok(geometry.shell <= geometry.viewport+1, `${width}px shell overflow ${JSON.stringify(geometry)}`);
    assert.ok(geometry.overflow <= 1, `${width}px document overflow ${JSON.stringify(geometry)}`);
    console.log(`Pro UI-only copy visible without horizontal overflow: ${width}px`);
    await page.close();
  }
} finally { await browser.close(); }
