const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { chromium } = require('playwright');

const root = join(__dirname, '..');
const html = readFileSync(join(root, 'provider.html'), 'utf8');
const dialog = html.match(/<dialog class="price-list-dialog"[\s\S]*?<\/dialog>/)?.[0];
assert.ok(dialog, 'price list dialog exists');
const themes = [...html.matchAll(/name="providerTheme" value="([^"]+)"/g)].map(match => match[1]);
assert.equal(themes.length, 41, 'complete provider theme catalog');
const styles = ['styles.css', 'provider-theme-loft-modern.css', 'provider-themes-signature.css',
  'provider-themes-calm.css', 'provider-layout-responsive.css', 'provider-ux.css',
  'provider-theme-families.css', 'provider-themes-wildlife.css', 'provider-theme-noir-safari.css',
  'provider-price-list.css']
  .map(name => readFileSync(join(root, name), 'utf8')).join('\n');
const sample = Array.from({ length:41 }, (_, i) => `<div><strong>Тестовая услуга ${i + 1} с длинным названием массажа</strong><span>2 500 ₽ · 60 мин</span></div>`).join('');
const fixture = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><body class="provider-body" data-provider-theme="warm" data-provider-layout="linear"><div class="provider-app"><main class="provider-workspace"><section class="provider-view" data-provider-panel="services"><div class="view-title"><div><span>Каталог</span><h2>Мои услуги</h2></div><div class="view-title-actions"><div class="services-view-switch"><button>Услуги · 41</button><button>Шаблоны</button></div><button class="secondary-button compact-button" id="openPriceList">Поделиться прайсом</button><button class="primary compact-button">Добавить услугу</button></div></div><section class="panel service-catalog">Тестовые услуги</section></section></main></div>${dialog}<script>document.querySelector('#priceListItems').innerHTML=${JSON.stringify(sample)};document.querySelector('#priceListBookingLink').href='https://example.test/book';document.querySelector('#openPriceList').onclick=()=>document.querySelector('#priceListDialog').showModal();document.querySelector('#closePriceList').onclick=()=>document.querySelector('#priceListDialog').close();</script></body></html>`;

(async () => {
  const browser = await chromium.launch({ headless:true });
  const out = process.env.SCREENSHOT_DIR;
  if (out) mkdirSync(out, { recursive:true });
  try {
    for (const width of [390, 760, 1440]) {
      const page = await browser.newPage({ viewport:{ width, height:800 } });
      await page.setContent(fixture);
      if (width === 390) {
        await page.addScriptTag({ content:readFileSync(join(root, 'provider-price-list.js'), 'utf8') });
        const images = await page.evaluate(async () => {
          const items = Array.from({ length:41 }, (_, i) => ({
            name:`Тестовая услуга ${i + 1} с длинным названием массажа`, active:true,
            price_rub:2500, duration_minutes:60
          }));
          const files = await window.PrimeTimePriceList.imageFiles(items, 'https://example.test/book');
          return Promise.all(files.map(async file => ({ name:file.name, type:file.type, bytes:[...new Uint8Array(await file.arrayBuffer())] })));
        });
        assert.equal(images.length, 3);
        assert.ok(images.every(image => image.type === 'image/png' && image.bytes.length > 1000));
        if (out) writeFileSync(join(out, 'price-list-export-1.png'), Buffer.from(images[0].bytes));
      }
      assert.equal(await page.locator('#openPriceList').isVisible(), true);
      await page.locator('#openPriceList').click();
      assert.equal(await page.locator('#priceListDialog').evaluate(element => element.open), true);
      assert.equal(await page.locator('#priceListItems>div').count(), 41);
      const geometry = await page.evaluate(() => ({
        documentWidth:document.documentElement.scrollWidth,
        viewportWidth:innerWidth,
        dialogWidth:document.querySelector('#priceListDialog').getBoundingClientRect().width,
        actionsVisible:[...document.querySelectorAll('.price-list-actions button')].every(button => {
          const box = button.getBoundingClientRect(); return box.width > 0 && box.right <= innerWidth;
        })
      }));
      assert.ok(geometry.documentWidth <= geometry.viewportWidth, `${width}px horizontal overflow`);
      assert.ok(geometry.dialogWidth <= width, `${width}px dialog overflow`);
      assert.ok(geometry.actionsVisible, `${width}px actions hidden`);
      for (const theme of themes) {
        const checked = await page.evaluate(themeKey => {
          document.body.dataset.providerTheme = themeKey;
          const dialog = document.querySelector('#priceListDialog');
          const box = dialog.getBoundingClientRect();
          const style = getComputedStyle(dialog);
          return { right:box.right, left:box.left, background:style.backgroundColor, color:style.color };
        }, theme);
        assert.ok(checked.left >= 0 && checked.right <= width, `${theme} at ${width}px dialog overflow`);
        assert.notEqual(checked.background, 'rgba(0, 0, 0, 0)', `${theme} transparent dialog`);
      }
      await page.evaluate(() => { document.body.dataset.providerTheme = 'warm'; });
      if (out) await page.screenshot({ path:join(out, `price-list-${width}.png`) });
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(`Price list browser geometry passed in ${themes.length} themes at 390, 760, 1440 px`);
})().catch(error => { console.error(error); process.exitCode = 1; });
