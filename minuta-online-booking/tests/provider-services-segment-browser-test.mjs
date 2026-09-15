import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const root = new URL('../', import.meta.url);
const styles = await readFile(new URL('styles.css', root), 'utf8');
const presetStyles = await readFile(new URL('service-presets.css', root), 'utf8');
const signatureStyles = await readFile(new URL('provider-themes-signature.css', root), 'utf8');
const layoutStyles = await readFile(new URL('provider-layout-responsive.css', root), 'utf8');
const uxStyles = await readFile(new URL('provider-ux.css', root), 'utf8');
const familyStyles = await readFile(new URL('provider-theme-families.css', root), 'utf8');
const presets = await readFile(new URL('service-presets.js', root), 'utf8');
const catalog = await readFile(new URL('service-presets-catalog.js', root), 'utf8');
const providerHtml = await readFile(new URL('provider.html', root), 'utf8');
assert.match(providerHtml, /class="services-view-switch"[\s\S]*data-service-catalog-tab="services"[\s\S]*id="servicesCount"[\s\S]*data-service-catalog-tab="presets"[\s\S]*data-open-service-presets/, 'provider header must use the shared services and templates segmented control');
const cards = ['Массаж спины + ШВЗ — базовый', 'Спортивный массаж', 'Очень длинное название услуги без специальных сокращений'].map((name, index) => `<article class="managed-service"><button class="edit-service-button"><strong>${name}</strong><small>${40 + index * 20} мин · 2 500 ₽</small></button><button class="service-visibility-button">Доступна</button></article>`).join('');
const header = `<section class="provider-view" data-provider-panel="services"><div class="view-title"><div><span>Каталог</span><h2>Мои услуги</h2></div><div class="view-title-actions"><div class="services-view-switch" role="group" aria-label="Раздел каталога"><button type="button" data-service-catalog-tab="services" aria-pressed="true"><span>Услуги</span><span aria-hidden="true">·</span><span id="servicesCount">128</span></button><button type="button" data-service-catalog-tab="presets" data-open-service-presets aria-pressed="false"><span>Шаблоны</span></button></div><button class="primary compact-button" type="button" data-open-service-creator><span>Добавить услугу с очень длинным названием</span></button></div></div><div class="services-layout"><section class="panel service-catalog"><div class="service-manage-list">${cards}</div></section></div></section>`;
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive:true });

const browser = await chromium.launch({ headless:true });
try {
  for (const theme of ['sage', 'midnight']) for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${styles}\n${presetStyles}\n${signatureStyles}\n${layoutStyles}\n${uxStyles}\n${familyStyles}</style><body class="provider-body" data-provider-theme="${theme}" data-provider-layout="capsule" data-provider-text-scale="default">${header}<script>window.currentUser={id:'user',user_metadata:{minuta_profession_ids:['massage']}};window.db={rpc:async()=>({data:{catalog_version:'test',profession_ids:['massage']}})};</script><script>${catalog}</script><script>${presets}</script></body></html>`);

    const control = page.locator('.services-view-switch');
    const services = page.locator('[data-service-catalog-tab="services"]');
    const templates = page.locator('[data-service-catalog-tab="presets"]');
    const controlBox = await control.boundingBox();
    const serviceBox = await services.boundingBox();
    const templateBox = await templates.boundingBox();
    assert.ok(controlBox && serviceBox && templateBox, `${width}: переключатель должен быть видим`);
    assert.equal(Math.round(serviceBox.height), Math.round(templateBox.height), `${width}: сегменты должны быть одной высоты`);
    assert.ok(Math.abs(serviceBox.width - templateBox.width) < 2, `${width}: сегменты должны быть одинаковой ширины`);
    assert.equal(await services.innerText(), 'Услуги\n·\n128', `${width}: количество должно быть связано с подписью услуг`);
    assert.equal(await templates.innerText(), 'Шаблоны', `${width}: подпись шаблонов не должна обрезаться`);
    assert.equal(await templates.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}: сегмент шаблонов не должен переполняться`);
    assert.equal(await control.evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}: переключатель не должен переполняться`);
    assert.equal(await page.locator('.view-title-actions').evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}: действия шапки не должны переполняться`);
    if (screenshotDir) await page.screenshot({ path:resolve(screenshotDir, `provider-services-${theme}-${width}.png`), fullPage:true });

    await templates.click();
    await page.locator('#servicePresetsDialog').waitFor({ state:'visible' });
    assert.equal(await templates.getAttribute('aria-pressed'), 'true', `${width}: шаблоны должны иметь выбранное состояние`);
    assert.equal(await services.getAttribute('aria-pressed'), 'false', `${width}: услуги должны снять выбранное состояние`);
    if (screenshotDir) await page.screenshot({ path:resolve(screenshotDir, `provider-services-presets-${theme}-${width}.png`), fullPage:true });
    await page.locator('[data-close-service-presets]').click();
    await page.locator('#servicePresetsDialog').waitFor({ state:'hidden' });
    await page.waitForFunction(() => document.querySelector('[data-service-catalog-tab="services"]')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await services.getAttribute('aria-pressed'), 'true', `${width}: после закрытия должен восстановиться список услуг`);
    assert.equal(await templates.getAttribute('aria-pressed'), 'false', `${width}: после закрытия шаблоны не должны оставаться выбранными`);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('provider services segmented switch browser test passed');
