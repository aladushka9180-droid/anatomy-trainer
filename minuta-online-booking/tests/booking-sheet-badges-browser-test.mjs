import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = { window:{} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8'), catalog);
const themes = catalog.window.MinutaThemeCatalog.themes;
const output = process.env.MINUTA_BADGES_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });
const css = [
  'styles.css', 'provider-theme-loft-modern.css', 'provider-themes-signature.css',
  'provider-themes-calm.css', 'provider-themes-wildlife.css',
  'provider-theme-noir-safari.css', 'provider-themes-distinct.css'
].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:900 } });
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${css}</style>
    <body class="provider-body" data-provider-layout="soft">
      <main class="booking-sheet-panel" style="width:min(100% - 32px,600px);margin:24px auto">
        ${[
          ['Метки клиента', 'Добавить'], ['Заметка', 'Добавить'],
          ['Фото и результат', 'Не заполнено'], ['Результат и оплата', 'Запланирован']
        ].map(([label, state]) => `<details class="booking-sheet-disclosure"><summary><div><small>О клиенте</small><strong>${label}</strong></div><span>${state}</span></summary><p>Подробности</p></details>`).join('')}
      </main>
    </body></html>`);

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of themes) {
      const result = await page.evaluate(key => {
        document.body.dataset.providerTheme = key;
        const rgba = value => {
          const numbers = String(value).match(/[\d.]+/g)?.map(Number) || [];
          if (String(value).startsWith('color(srgb')) return [...numbers.slice(0, 3).map(n => n * 255), numbers[3] ?? 1];
          return [...numbers.slice(0, 3), numbers[3] ?? 1];
        };
        const effectiveBackground = element => {
          let front = [0, 0, 0, 0];
          for (let current = element; current && front[3] < .999; current = current.parentElement) {
            const back = rgba(getComputedStyle(current).backgroundColor);
            const alpha = front[3] + back[3] * (1 - front[3]);
            front = alpha ? [0, 1, 2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) : front;
          }
          return front;
        };
        const luminance = value => value.slice(0, 3).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
          .reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
        const contrast = (a, b) => {
          const x = luminance(a), y = luminance(b);
          return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
        };
        const pills = [...document.querySelectorAll('.booking-sheet-disclosure>summary>span')];
        return {
          contrast:Math.min(...pills.map(pill => contrast(rgba(getComputedStyle(pill).color), effectiveBackground(pill)))),
          backgrounds:[...new Set(pills.map(pill => getComputedStyle(pill).backgroundColor))],
          foreground:getComputedStyle(pills[0]).color,
          borders:pills.map(pill => getComputedStyle(pill).borderTopWidth),
          overflow:document.documentElement.scrollWidth > innerWidth + 2,
          clipped:pills.some(pill => pill.getBoundingClientRect().right > innerWidth),
          cursor:getComputedStyle(document.querySelector('summary')).cursor
        };
      }, theme.key);
      assert.ok(result.contrast >= 4.5, `${theme.key} at ${width}px: pill contrast ${result.contrast.toFixed(2)} (${result.foreground} on ${result.backgrounds[0]})`);
      assert.equal(result.backgrounds.length, 1, `${theme.key}: pill backgrounds differ`);
      if (theme.key === 'luxury') assert.equal(result.backgrounds[0], 'rgb(36, 29, 18)', 'Luxury badge treatment changed');
      assert.ok(result.borders.every(border => border === '1px'), `${theme.key}: missing pill border`);
      assert.equal(result.overflow || result.clipped, false, `${theme.key} at ${width}px: pill overflow`);
      assert.equal(result.cursor, 'pointer', `${theme.key}: disclosure is not clickable`);
      if (output && width === 390 && ['sage', 'warm', 'lavender', 'cobalt-forge', 'luxury', 'noir-safari'].includes(theme.key)) {
        await page.screenshot({ path:path.join(output, `${theme.key}-390.png`) });
      }
    }
  }
  await page.setViewportSize({ width:390, height:900 });
  await page.evaluate(() => { document.body.dataset.providerTheme = 'noir-safari'; });
  await page.locator('.booking-sheet-disclosure>summary').first().click();
  assert.equal(await page.locator('.booking-sheet-disclosure').first().getAttribute('open'), '');
  console.log('PrimeTime Pro booking sheet badges: PASS (40 themes, 390/760/1440)');
} finally {
  await browser.close();
}
