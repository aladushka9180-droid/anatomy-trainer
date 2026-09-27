import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const scanner = readFileSync(new URL('../code-scanner.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../code-scanner.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><html><body>
      <button id="benefitScan" data-code-scan-target="benefitSearch" data-code-scan-mode="benefit" data-code-scan-title="Абонемент или сертификат">Сканировать</button>
      <input id="benefitSearch"><button id="itemScan" data-code-scan-target="itemSku" data-code-scan-mode="inventory" data-code-scan-title="Код складской позиции">Сканировать</button>
      <input id="itemSku" maxlength="80"><button id="movementScan" data-code-scan-target="movementItem" data-code-scan-match="option" data-code-scan-mode="inventory" data-code-scan-title="Товар для операции">Сканировать</button>
      <select id="movementItem"><option value="one" data-sku="12345">Масло</option><option value="two" data-sku="67890">Крем</option></select>
      <dialog class="code-scanner-dialog" id="codeScannerDialog" aria-labelledby="codeScannerTitle"><div class="code-scanner-shell">
        <div class="code-scanner-head"><div><small>Камера устройства</small><h2 id="codeScannerTitle">Сканировать код</h2></div><button type="button" data-close-code-scanner>Закрыть</button></div>
        <div class="code-scanner-camera"><video id="codeScannerVideo"></video></div><p id="codeScannerStatus"></p>
        <form class="code-scanner-manual" id="codeScannerManualForm"><label>Или введите код<input id="codeScannerManual"></label><button type="submit">Применить</button></form>
      </div></dialog>
    </body></html>`);
    await page.addStyleTag({ content:css });
    await page.evaluate(() => {
      Object.defineProperty(window, 'isSecureContext', { configurable:true, value:false });
      window.appliedCodes = [];
      document.addEventListener('minuta:code-scanned', event => window.appliedCodes.push(event.detail));
    });
    await page.addScriptTag({ content:scanner });
    for (const [opener, code, action, target, expected] of [
      ['benefitScan', 'MIN-TEST', 'Найти', 'benefitSearch', 'MIN-TEST'],
      ['itemScan', '12345', 'Использовать код', 'itemSku', '12345'],
      ['movementScan', '67890', 'Найти материал', 'movementItem', 'two'],
    ]) {
      await page.locator(`#${opener}`).click();
      assert.equal(await page.locator('#codeScannerStatus').innerText(), 'Сканирование недоступно в этом браузере. Введите код');
      assert.equal(await page.locator('.code-scanner-camera').isVisible(), false);
      assert.equal(await page.locator('.code-scanner-head small').innerText(), 'Ручной ввод');
      assert.equal(await page.locator('#codeScannerManual').evaluate(input => input.closest('label').textContent.trim()), 'Код');
      assert.equal(await page.locator('#codeScannerManualForm button').innerText(), action);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width}px overflow`);
      await page.locator('#codeScannerManual').fill(code);
      await page.locator('#codeScannerManualForm button').click();
      assert.equal(await page.locator(`#${target}`).inputValue(), expected);
      assert.equal(await page.locator('#codeScannerDialog').evaluate(dialog => dialog.open), false);
    }
    await page.locator('#itemScan').click();
    await page.locator('#codeScannerManual').fill('CANCELLED');
    await page.locator('[data-close-code-scanner]').click();
    assert.equal(await page.locator('#itemSku').inputValue(), '12345');
    assert.equal(await page.locator('#codeScannerDialog').evaluate(dialog => dialog.open), false);
    assert.equal(await page.evaluate(() => window.appliedCodes.length), 3);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('Manual scanner fallback: 390/760/1440, contextual actions, selection and cancel PASS');
} finally {
  await browser.close();
}
