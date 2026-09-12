import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const source = readFileSync(new URL('../portfolio-camera.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html><body>
    <dialog id="portfolioCameraDialog">
      <h2 id="portfolioCameraTitle"></h2>
      <button type="button" data-close-portfolio-camera>Закрыть</button>
      <video id="portfolioCameraVideo" playsinline muted autoplay></video>
      <div id="portfolioCameraPlaceholder"><span></span></div>
      <p id="portfolioCameraStatus"></p>
      <button type="button" data-portfolio-camera-fallback hidden>Системная камера</button>
      <button type="button" data-portfolio-camera-capture disabled>Сделать снимок</button>
    </dialog>
  </body></html>`);
  await page.evaluate(() => {
    window.cameraState = { requested:0, stopped:0, captured:null, fallback:0 };
    Object.defineProperty(window, 'isSecureContext', { configurable:true, value:true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{
      getUserMedia:async constraints => {
        cameraState.requested += 1;
        cameraState.constraints = constraints;
        return { getTracks:() => [{ stop:() => { cameraState.stopped += 1; } }] };
      }
    } });
    const video = document.querySelector('#portfolioCameraVideo');
    Object.defineProperty(video, 'srcObject', { configurable:true, writable:true, value:null });
    Object.defineProperty(video, 'videoWidth', { configurable:true, value:2400 });
    Object.defineProperty(video, 'videoHeight', { configurable:true, value:1800 });
    video.play = async () => {};
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    HTMLCanvasElement.prototype.toBlob = callback => callback(new Blob(['photo'], { type:'image/jpeg' }));
  });
  await page.addScriptTag({ content:source });
  await page.evaluate(() => MinutaPortfolioCamera.open({
    title:'Снять фото «После»',
    onCapture:file => { cameraState.captured = { name:file.name, type:file.type, size:file.size }; },
    onFallback:() => { cameraState.fallback += 1; }
  }));
  await page.waitForFunction(() => !document.querySelector('[data-portfolio-camera-capture]').disabled);
  assert.equal(await page.textContent('#portfolioCameraTitle'), 'Снять фото «После»');
  assert.equal(await page.locator('#portfolioCameraPlaceholder').isVisible(), false);
  await page.click('[data-portfolio-camera-capture]');
  await page.waitForFunction(() => cameraState.captured !== null);
  const captured = await page.evaluate(() => ({ ...cameraState, dialogOpen:document.querySelector('#portfolioCameraDialog').open }));
  assert.equal(captured.requested, 1);
  assert.equal(captured.stopped, 1);
  assert.equal(captured.captured.type, 'image/jpeg');
  assert.ok(captured.captured.name.startsWith('portfolio-'));
  assert.equal(captured.dialogOpen, false);
  assert.equal(captured.constraints.video.facingMode.ideal, 'environment');
  assert.equal(captured.constraints.audio, false);

  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { const error = new Error('denied'); error.name = 'NotAllowedError'; throw error; };
    MinutaPortfolioCamera.open({ onCapture:() => {}, onFallback:() => { cameraState.fallback += 1; } });
  });
  await page.waitForFunction(() => !document.querySelector('[data-portfolio-camera-fallback]').hidden);
  assert.match(await page.textContent('#portfolioCameraStatus'), /Доступ к камере не разрешён/);
  await page.click('[data-portfolio-camera-fallback]');
  assert.equal((await page.evaluate(() => cameraState.fallback)), 1);
  assert.deepEqual(errors, []);
  console.log('Portfolio camera: in-app preview, rear camera, capture, cleanup and fallback PASS');
} finally {
  await browser.close();
}
