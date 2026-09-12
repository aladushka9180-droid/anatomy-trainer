import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'provider.html');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !(await stat(target)).isFile()) throw new Error('not found');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypes.get(path.extname(target)) || 'application/octet-stream');
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true });
const catalogContext = { window:{} };
vm.createContext(catalogContext);
vm.runInContext(await readFile(path.join(root, 'theme-catalog.js'), 'utf8'), catalogContext);
const themes = [...catalogContext.window.MinutaThemeCatalog.themeKeys];

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', route => route.request().resourceType() === 'script' ? route.abort() : route.continue());
  await page.goto(`${origin}/provider.html`, { waitUntil:'networkidle' });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('[data-open-product-feedback]').hidden = false;
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'schedule';
      view.classList.toggle('active', view.dataset.providerPanel === 'schedule');
    });
    document.querySelectorAll('[data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === 'schedule'));
    document.body.dataset.providerLayout = 'soft';
  });
  assert.equal(await page.locator('#dashboard').isVisible(), true, 'кабинет должен быть видим на контрольном экране');
  assert.equal(await page.locator('[data-provider-panel="schedule"]').isVisible(), true, 'раздел рабочих часов должен быть видим');

  const widths = [390, 760, 1440];
  const failures = [];
  const screenshotDirectory = process.env.MINUTA_THEME_SCREENSHOT_DIR;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive:true });

  for (const width of widths) {
    await page.setViewportSize({ width, height:1000 });
    for (const theme of themes) {
      const snapshot = await page.evaluate(themeKey => {
        document.body.dataset.providerTheme = themeKey;
        const bodyStyle = getComputedStyle(document.body);
        const step = document.querySelector('.booking-step-setting strong');
        const feedback = document.querySelector('.provider-feedback-link');
        const stepStyle = getComputedStyle(step);
        const feedbackStyle = getComputedStyle(feedback);
        const surface = document.querySelector('.booking-step-setting');
        const surfaceStyle = getComputedStyle(surface);
        const stepRect = step.getBoundingClientRect();
        const surfaceRect = surface.getBoundingClientRect();
        const normalizeColor = value => {
          const probe = document.createElement('span');
          probe.style.color = value;
          document.body.append(probe);
          const result = getComputedStyle(probe).color;
          probe.remove();
          return result;
        };
        return {
          theme:themeKey,
          stepColor:stepStyle.color,
          feedbackColor:feedbackStyle.color,
          expectedStep:normalizeColor(bodyStyle.getPropertyValue('--theme-ink').trim()),
          expectedFeedback:normalizeColor(bodyStyle.getPropertyValue('--theme-muted').trim()),
          documentOverflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
          stepInset:stepRect.left - surfaceRect.left,
          stepClipped:step.scrollWidth > step.clientWidth || step.scrollHeight > step.clientHeight,
          feedbackClipped:feedback.scrollWidth > feedback.clientWidth || feedback.scrollHeight > feedback.clientHeight,
        };
      }, theme);
      if (snapshot.stepColor !== snapshot.expectedStep) failures.push({ width, ...snapshot, problem:'Шаг записи не использует --theme-ink' });
      if (snapshot.feedbackColor !== snapshot.expectedFeedback) failures.push({ width, ...snapshot, problem:'Помощь и обратная связь не использует --theme-muted' });
      if (snapshot.documentOverflow > 1 || snapshot.stepClipped || snapshot.feedbackClipped) failures.push({ width, ...snapshot, problem:'переполнение или обрезание текста' });
      if (width <= 760 && snapshot.stepInset < 12) failures.push({ width, ...snapshot, problem:'Шаг записи прижат к краю' });
      if (screenshotDirectory && ['sage', 'luxury', 'noir-safari'].includes(theme)) {
        await page.screenshot({ path:path.join(screenshotDirectory, `${theme}-${width}.png`), fullPage:true });
      }
    }
  }

  assert.deepEqual(failures, []);
  console.log(`PASS: ${themes.length} тем, ширины ${widths.join('/')}, оба системных текста следуют палитре без обрезания.`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
