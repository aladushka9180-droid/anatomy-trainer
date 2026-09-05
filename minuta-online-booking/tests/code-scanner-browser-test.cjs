const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const scanner = fs.readFileSync(path.join(root, 'code-scanner.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.MINUTA_BROWSER_CHANNEL ? { channel:process.env.MINUTA_BROWSER_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    await page.route('http://localhost/code-scanner-test', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html><body></body></html>' }));
    await page.goto('http://localhost/code-scanner-test');
    await page.setContent(`
      <button id="openSku" data-code-scan-target="sku">scan sku</button>
      <input id="sku" maxlength="80">
      <button id="openSale" data-code-scan-target="item" data-code-scan-match="option" data-code-scan-preset="sale">scan sale</button>
      <select id="item"><option value="long" data-code="12345" data-sku="12345">Long</option><option value="exact" data-code="123" data-sku="123">Exact</option></select>
      <select id="inventoryMovementKind"><option value="receipt">receipt</option><option value="write_off">write_off</option></select>
      <input id="inventoryMovementQuantity"><input id="inventoryMovementReason">
      <dialog id="codeScannerDialog"><h2 id="codeScannerTitle"></h2><button data-close-code-scanner>close</button><video id="codeScannerVideo"></video><p id="codeScannerStatus"></p><form id="codeScannerManualForm"><input id="codeScannerManual"><button type="submit">apply</button></form></dialog>
    `);
    await page.evaluate(() => {
      window.cameraStops = 0;
      window.pendingCamera = {};
      Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{ getUserMedia:() => new Promise((resolve, reject) => { pendingCamera.resolve = resolve; pendingCamera.reject = reject; }) } });
      window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code','code_128']; } async detect() { return []; } };
      HTMLMediaElement.prototype.play = async function () {};
    });
    await page.addScriptTag({ content:scanner });

    await page.click('#openSku');
    await page.waitForFunction(() => typeof pendingCamera.resolve === 'function');
    await page.click('[data-close-code-scanner]');
    await page.evaluate(() => pendingCamera.resolve({ getTracks:() => [{ stop:() => { cameraStops += 1; } }] }));
    await page.waitForFunction(() => cameraStops === 1);
    assert.equal(await page.evaluate(() => document.querySelector('#codeScannerVideo').srcObject), null, 'late camera stream must never attach after close');

    await page.click('#openSale');
    await page.fill('#codeScannerManual', '123');
    await page.click('#codeScannerManualForm button[type="submit"]');
    assert.deepEqual(await page.evaluate(() => ({ item:item.value,kind:inventoryMovementKind.value,quantity:inventoryMovementQuantity.value,reason:inventoryMovementReason.value })),
      { item:'exact',kind:'write_off',quantity:'1',reason:'Продажа' }, 'sale scan must use exact SKU and only prepare the form');

    await page.click('#openSku');
    await page.fill('#codeScannerManual', 'X'.repeat(81));
    await page.click('#codeScannerManualForm button[type="submit"]');
    assert.equal(await page.inputValue('#sku'), '', 'code longer than target maxlength must not be applied');
    assert.match(await page.textContent('#codeScannerStatus'), /80 символов/);

    console.log('Code scanner browser checks passed: late-camera cleanup, exact sale match and maxlength guard.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
