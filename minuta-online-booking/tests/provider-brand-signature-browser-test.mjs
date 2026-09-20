import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog = fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8');
const themes = [...catalog.matchAll(/defineTheme\('([^']+)'/g)].map(match => match[1]);
assert.equal(themes.length, 40, 'Каталог тем прочитан не полностью');
const output = process.env.MINUTA_BRAND_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const file = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) {
    content = content.toString()
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  }
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#dashboard').hidden = false;
    document.body.dataset.providerLayout = 'capsule';
    document.querySelector('#editProviderBusinessName').disabled = false;
    document.querySelector('#providerBusinessName').textContent = 'Массаж в Ижевске';
  });

  const tierColors = new Set();
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    for (const theme of themes) {
      const state = await page.evaluate(themeKey => {
        document.body.dataset.providerTheme = themeKey;
        const signature = document.querySelector('.provider-product-signature');
        const name = document.querySelector('.provider-product-name');
        const tier = document.querySelector('.provider-product-tier');
        const card = document.querySelector('.provider-brand');
        const copy = document.querySelector('.provider-brand-copy');
        const nameAction = document.querySelector('#editProviderBusinessName');
        const signatureStyle = getComputedStyle(signature);
        const nameStyle = getComputedStyle(name);
        const tierStyle = getComputedStyle(tier);
        const signatureRect = signature.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        return {
          transform:signatureStyle.textTransform,
          size:Number.parseFloat(signatureStyle.fontSize),
          spacing:Number.parseFloat(signatureStyle.letterSpacing),
          nameColor:nameStyle.color,
          tierColor:tierStyle.color,
          nameWeight:Number.parseInt(nameStyle.fontWeight, 10),
          tierWeight:Number.parseInt(tierStyle.fontWeight, 10),
          visible:signatureRect.width > 0 && signatureRect.height > 0,
          inside:signatureRect.right <= cardRect.right + 1,
          copyOffset:copy.getBoundingClientRect().left - cardRect.left,
          markCount:card.querySelectorAll('.brand-mark').length,
          editIconCount:document.querySelectorAll('.provider-brand-edit,#editProviderBusinessName svg').length,
          nameActionCount:document.querySelectorAll('#editProviderBusinessName.provider-business-name-action').length,
          nameActionBackground:getComputedStyle(nameAction).backgroundColor,
          nameActionDisplay:getComputedStyle(nameAction).display,
          nameActionWidth:nameAction.getBoundingClientRect().width,
          businessNameVisible:nameAction.getBoundingClientRect().width > 0 && nameAction.getBoundingClientRect().height > 0,
          copyWidth:copy.getBoundingClientRect().width,
          nameHeight:nameRect.height,
          nameLineHeight:Number.parseFloat(getComputedStyle(name).lineHeight),
          signatureAboveName:signatureRect.bottom <= nameAction.getBoundingClientRect().top,
          overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        };
      }, theme);
      assert.equal(state.transform, 'none', `${theme} ${width}px: подпись снова набрана капсом`);
      assert.equal(state.size, width >= 761 ? 23 : 14, `${theme} ${width}px: неверный размер подписи`);
      assert.ok(state.spacing < 0, `${theme} ${width}px: вернулась разреженная подпись (${state.spacing}px)`);
      assert.notEqual(state.nameColor, state.tierColor, `${theme} ${width}px: Pro потерял акцент`);
      assert.ok(state.tierWeight > state.nameWeight, `${theme} ${width}px: Pro не отделён начертанием`);
      assert.equal(state.markCount, 0, `${theme} ${width}px: PT всё ещё занимает место`);
      assert.equal(state.editIconCount, 0, `${theme} ${width}px: большая кнопка или карандаш редактирования всё ещё видны`);
      assert.equal(state.nameActionCount, 1, `${theme} ${width}px: название бизнеса не стало компактным переходом к редактированию`);
      assert.equal(state.nameActionBackground, 'rgba(0, 0, 0, 0)', `${theme} ${width}px: название постоянно выглядит как отдельная кнопка`);
      assert.equal(state.nameActionDisplay, width < 761 ? 'block' : 'none', `${theme} ${width}px: desktop-скрытие затронуло неверный breakpoint`);
      if (width < 761 && state.businessNameVisible) assert.ok(state.nameActionWidth >= state.copyWidth - 1, `${theme} ${width}px: название не использует освобождённую ширину карточки`);
      assert.equal(state.overflow, false, `${theme} ${width}px: появился горизонтальный overflow`);
      if (output && ['warm', 'midnight', 'petrol-steel'].includes(theme)) {
        await page.evaluate(() => document.activeElement?.blur());
        await page.mouse.move(width - 4, 896);
        await page.waitForTimeout(180);
        await page.screenshot({ path:path.join(output, `${theme}-${width}.png`) });
      }
      if (width === 1440) {
        assert.equal(state.visible, true, `${theme}: подпись не видна в боковой панели`);
        assert.equal(state.inside, true, `${theme}: подпись вышла за карточку бренда`);
        tierColors.add(state.tierColor);
      }
    }
  }
  assert.ok(tierColors.size >= 20, `Акцент Pro недостаточно меняется между темами: ${tierColors.size}`);
  console.log('Provider brand signature browser matrix: PASS (40 themes × 3 widths)');
} finally {
  if (browser) await browser.close();
  server.close();
}
