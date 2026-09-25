import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const toRgb = hex => `rgb(${hex.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16)).join(', ')})`;
const contrast = (foreground, background) => {
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};

const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport:{ width:390, height:900 } });
  await page.setContent(`<body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="soft">
    <main id="dashboard"><section class="provider-view" data-provider-panel="clients">
      <button class="primary" id="clientAction">Новая запись</button>
      <button class="primary danger" id="dangerAction">Удалить</button>
      <nav class="provider-section-nav"><button class="active">Ресурсы</button></nav>
      <div class="provider-theme-filter"><button class="active">Рекомендуемые</button></div>
      <div class="notification-filters"><button class="active">К отправке</button></div>
      <div class="report-periods"><button class="active">30 дней</button></div>
      <div class="report-data-source"><button class="active">Мои данные</button></div>
      <div class="report-view-tabs"><button class="active">Обзор</button></div>
      <div class="feedback-inbox-filters"><button class="active">Все</button></div>
      <button class="report-export-button secondary-button">Экспорт</button>
      <button class="message-center-send">Отправить</button>
      <label class="day-toggle"><input checked type="checkbox"><span></span></label>
      <div class="important-notification-card is-unread"><i></i></div>
      <div class="service-visibility-toggle"><i></i></div>
      <div class="report-chart-column"><span><i></i></span></div>
    </section></main></body>`);
  for (const file of ['styles.css', 'messages-center.css', 'provider-themes-signature.css', 'provider-themes-calm.css', 'provider-porcelain-detail.css']) {
    await page.addStyleTag({ path:path.join(root, file) });
  }
  await page.addStyleTag({ content:'*{transition:none!important;animation:none!important}' });
  await page.addScriptTag({ path:path.join(root, 'provider-porcelain-matrix.js') });
  const controls = ['#clientAction', '.provider-section-nav button.active', '.provider-theme-filter button.active', '.notification-filters button.active', '.report-periods button.active', '.report-data-source button.active', '.report-view-tabs button.active', '.feedback-inbox-filters button.active', '.report-export-button', '.message-center-send'];
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const character of ['pearl', 'petal', 'silk']) {
      for (const shade of ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent']) {
        const palette = await page.evaluate(({ character, shade }) => {
          const palette = window.MinutaProviderPorcelainMatrix.paletteFor(character, shade);
          document.body.dataset.providerPorcelainCharacter = character;
          for (const [name, value] of Object.entries({
            '--theme-bg':palette.bg, '--theme-surface':palette.surface, '--theme-surface-alt':palette.surfaceAlt,
            '--theme-ink':palette.ink, '--theme-muted':palette.muted, '--theme-line':palette.line,
            '--theme-accent':palette.accent, '--theme-accent-soft':palette.accentSoft,
            '--porcelain-action-bg':palette.actionBg, '--porcelain-action-ink':palette.actionInk
          })) document.body.style.setProperty(name, value);
          return palette;
        }, { character, shade });
        for (const selector of controls) {
          const result = await page.locator(selector).evaluate(element => ({ background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color }));
          assert.equal(result.background, toRgb(palette.actionBg), `${width} ${character}/${shade} ${selector} fill`);
          assert.equal(result.color, toRgb(palette.actionInk), `${width} ${character}/${shade} ${selector} text`);
          assert.ok(contrast(result.color, result.background) >= 4.5, `${width} ${character}/${shade} ${selector} contrast`);
        }
        assert.equal(await page.locator('.day-toggle input:checked+span').evaluate(element => getComputedStyle(element).backgroundColor), toRgb(palette.actionBg));
        assert.notEqual(await page.locator('#dangerAction').evaluate(element => getComputedStyle(element).backgroundColor), toRgb(palette.actionBg));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width} ${character}/${shade} overflow`);
      }
    }
    console.log(`${width}px: 15 Pink Porcelain palettes, 10 section controls, contrast and exclusion PASS`);
  }
  await page.evaluate(() => document.body.dataset.providerTheme = 'sage');
  assert.notEqual(await page.locator('#clientAction').evaluate(element => getComputedStyle(element).backgroundColor), toRgb('#e5a3be'), 'other theme should retain its own controls');
} finally { await browser.close(); }
