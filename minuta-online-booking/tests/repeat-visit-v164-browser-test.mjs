import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { themes, layouts } from './theme-card-fixture.mjs';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.search(new RegExp(`^function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Actual ${name}`);
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(end > start, `Complete ${name}`);
  return source.slice(start, end);
}

const repeat = {
  source_booking_id:'44444444-4444-4444-8444-444444444444', source_signature:'a'.repeat(64),
  duration_minutes:105, total_price_rub:5200, comment:'Без масла лаванды. Особое внимание шейно-воротниковой зоне.',
  items:[
    { kind:'primary', service_id:'11111111-1111-4111-8111-111111111111', title:'Массаж спины и шейно-воротниковой зоны', duration_minutes:75, price_rub:4200, extends_duration:true },
    { kind:'addon', service_id:'22222222-2222-4222-8222-222222222222', title:'Уход с восстанавливающей маской', duration_minutes:30, price_rub:1000, extends_duration:true }
  ],
  materials:[
    { inventory_item_id:'55555555-5555-4555-8555-555555555555', name:'Массажное масло гипоаллергенное', unit:'мл', quantity:35.5 },
    { inventory_item_id:'66666666-6666-4666-8666-666666666666', name:'Восстанавливающая маска', unit:'шт', quantity:1 }
  ]
};

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}</style></head>
    <body class="provider-body" data-provider-theme="graphite" data-provider-layout="capsule" style="--theme-surface:#fff;--theme-surface-alt:#f4f7f5;--theme-line:#d9e3dd;--theme-ink:#183326;--theme-muted:#718278;--theme-accent:#2f7654;--theme-accent-soft:#e8f3ec;margin:0">
      <div class="booking-sheet new-booking-sheet"><button class="booking-sheet-backdrop"></button><section class="booking-sheet-panel" role="dialog"><button class="booking-sheet-close">×</button>
        <form class="booking-editor-form new-booking-form" data-mode="client"><h2>Повторная запись</h2><div class="new-booking-layout"><section class="new-booking-section" id="content"></section><section class="new-booking-section new-booking-date-time-section"><div class="new-booking-section-title"><div><strong>Когда</strong><small>Выберите свободное окно</small></div></div><label class="new-booking-date-field">Дата<input type="date" value="2026-10-15"></label><div class="booking-time-picker"><div class="booking-time-hours"><button type="button" class="active">14:00</button><button type="button">15:00</button></div></div></section></div><div class="booking-sheet-submit-bar"><button class="primary new-booking-submit" type="submit">Создать запись</button></div></form>
      </section></div></body></html>`);
  await page.addScriptTag({ content:`
    var escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    var money=value=>new Intl.NumberFormat('ru-RU').format(value)+' ₽';
    ${declaration('repeatVisitPreviewMarkup')}
    document.querySelector('#content').innerHTML=repeatVisitPreviewMarkup(${JSON.stringify(repeat)});
  ` });

  assert.equal(await page.locator('.repeat-visit-row').count(), 2);
  assert.equal(await page.locator('.repeat-visit-materials li').count(), 2);
  assert.equal(await page.locator('#repeatVisitTotalPrice').inputValue(), '5200');
  assert.match(await page.locator('#repeatVisitComment').inputValue(), /Без масла лаванды/);
  await page.locator('#repeatVisitTotalPrice').fill('5400');
  await page.locator('#repeatVisitComment').fill('Обновлённый комментарий');
  assert.equal(await page.locator('#repeatVisitTotalPrice').inputValue(), '5400');
  assert.equal(await page.locator('#repeatVisitComment').inputValue(), 'Обновлённый комментарий');

  const variants = themes.flatMap(theme => layouts.map(layout => ({ theme, layout })));
  for (const variant of variants) {
    await page.locator('body').evaluate((body, value) => { body.dataset.providerTheme=value.theme; body.dataset.providerLayout=value.layout; }, variant);
    for (const width of [390,760,1440]) {
      await page.setViewportSize({ width, height:900 });
      const metrics = await page.evaluate(() => {
        const panel=document.querySelector('.booking-sheet-panel').getBoundingClientRect();
        const preview=document.querySelector('.repeat-visit-preview').getBoundingClientRect();
        const submit=document.querySelector('.new-booking-submit').getBoundingClientRect();
        const sections=[...document.querySelectorAll('.new-booking-section')].map(node=>node.getBoundingClientRect());
        return { overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth, panel, preview, submit, sections, columns:getComputedStyle(document.querySelector('.new-booking-layout')).gridTemplateColumns };
      });
      assert.ok(metrics.overflow<=0, `${variant.theme}/${variant.layout}/${width}: no horizontal overflow`);
      assert.ok(metrics.panel.left>=0 && metrics.panel.right<=width+.5, `${variant.theme}/${variant.layout}/${width}: panel inside viewport`);
      assert.ok(metrics.preview.left>=metrics.panel.left && metrics.preview.right<=metrics.panel.right+.5, `${variant.theme}/${variant.layout}/${width}: repeat preview inside panel`);
      assert.ok(metrics.submit.height>=44, `${variant.theme}/${variant.layout}/${width}: submit target`);
      if (width<=760) assert.ok(metrics.sections[1].top>=metrics.sections[0].bottom-1, `${variant.theme}/${variant.layout}/${width}: sections stack (${metrics.columns})`);
      if (process.env.MINUTA_UI_SCREENSHOT && variant.theme==='graphite' && variant.layout==='capsule') await page.screenshot({ path:`${process.env.MINUTA_UI_SCREENSHOT}-${width}.png`, fullPage:true });
    }
  }
  console.log(`repeat visit v164 browser test: OK (${variants.length*3} theme/layout/viewport combinations)`);
} finally { await browser.close(); }
