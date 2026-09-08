import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const source = readFileSync(new URL('../code-scanner.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html><body>
    <button id="openScanner" type="button" data-code-scan-target="inventoryItemSku" data-code-scan-title="Сканировать товар">Сканировать</button>
    <input id="inventoryItemSku" maxlength="32">
    <dialog id="codeScannerDialog"><h2 id="codeScannerTitle"></h2><video id="codeScannerVideo"></video><p id="codeScannerStatus"></p><form id="codeScannerManualForm"><input id="codeScannerManual"><button type="submit">Применить</button></form><button type="button" data-close-code-scanner>Закрыть</button></dialog>
  </body></html>`);
  await page.evaluate(() => {
    window.scannerState = { requested:0, stopped:0, detected:0, detail:null, inputEvents:0, changeEvents:0 };
    Object.defineProperty(window, 'isSecureContext', { configurable:true, value:true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{
      getUserMedia:async constraints => {
        scannerState.requested += 1;
        scannerState.constraints = constraints;
        return { getTracks:() => [{ stop:() => { scannerState.stopped += 1; } }] };
      }
    } });
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code','ean_13','code_128']; }
      constructor(options) { scannerState.formats = options.formats; }
      async detect() {
        scannerState.detected += 1;
        return scannerState.detected === 1 ? [{ rawValue:'4601234567890' }] : [];
      }
    };
    const scannerVideo = document.querySelector('#codeScannerVideo');
    Object.defineProperty(scannerVideo, 'readyState', { configurable:true, value:2 });
    Object.defineProperty(scannerVideo, 'srcObject', { configurable:true, writable:true, value:null });
    scannerVideo.play = async () => {};
    document.querySelector('#inventoryItemSku').addEventListener('input', () => { scannerState.inputEvents += 1; });
    document.querySelector('#inventoryItemSku').addEventListener('change', () => { scannerState.changeEvents += 1; });
    document.addEventListener('minuta:code-scanned', event => { scannerState.detail = event.detail; });
  });
  await page.addScriptTag({ content:source });
  await page.click('#openScanner');
  await page.waitForFunction(() => document.querySelector('#inventoryItemSku').value === '4601234567890');
  const state = await page.evaluate(() => ({ ...scannerState, dialogOpen:document.querySelector('#codeScannerDialog').open, focused:document.activeElement?.id }));
  assert.equal(state.requested, 1);
  assert.equal(state.stopped, 1);
  assert.ok(state.detected >= 1);
  assert.deepEqual(state.detail, { code:'4601234567890', targetId:'inventoryItemSku', mode:'' });
  assert.equal(state.inputEvents, 1);
  assert.equal(state.changeEvents, 1);
  assert.equal(state.dialogOpen, false);
  assert.equal(state.focused, 'inventoryItemSku');
  assert.equal(state.constraints.video.facingMode.ideal, 'environment');
  assert.deepEqual(state.formats, ['qr_code','code_128','ean_13']);
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Camera scanner: permission, rear camera, successful detection, events and track cleanup PASS');
} finally {
  await browser.close();
}
