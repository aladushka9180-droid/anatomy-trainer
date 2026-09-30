import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)(process.env.MINUTA_PLAYWRIGHT_PACKAGE || 'playwright');

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
assert.doesNotMatch(providerHtml, /data-service-catalog-tab/);
assert.match(providerHtml, /id="servicesCount"/);
const cards = ['Массаж спины + ШВЗ — базовый', 'Спортивный массаж', 'Очень длинное название услуги без специальных сокращений'].map((name, index) => `<article class="managed-service"><button class="edit-service-button"><strong>${name}</strong><small>${40 + index * 20} мин · 2 500 ₽</small></button><button class="service-visibility-button">Доступна</button></article>`).join('');
const header = providerHtml.match(/<section class="provider-view" data-provider-panel="services" hidden>[\s\S]*?<\/section>\s*<\/div>\s*<\/section>/)[0].replace(' hidden', '').replace('<div class="service-manage-list" id="serviceManageList"></div>', `<div class="service-manage-list">${cards}</div>`).replace('id="servicesCount">0', 'id="servicesCount">128');
const screenshotDir = process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive:true });

const browser = await chromium.launch({ headless:true, channel:'chrome' });
try {
  for (const theme of ['pink-porcelain', 'midnight']) for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><style>${styles}\n${presetStyles}\n${signatureStyles}\n${layoutStyles}\n${uxStyles}\n${familyStyles}</style><body class="provider-body" data-provider-theme="${theme}" data-provider-layout="capsule" data-provider-text-scale="default">${header}<script>window.currentUser={id:'user',user_metadata:{minuta_profession_ids:['massage']}};window.db={rpc:async()=>({data:{catalog_version:'test',profession_ids:['massage']}})};</script><script>${catalog}</script><script>${presets}</script></body></html>`);

    const entry = page.locator('[data-open-service-creator]');
    assert.equal(await entry.count(), 1);
    assert.equal(await page.locator('#servicesCount').innerText(), '128');
    assert.equal(await page.locator('#openPriceList').isVisible(), true);
    assert.equal(await page.locator('.view-title-actions').evaluate(element => element.scrollWidth <= element.clientWidth), true, `${width}: header overflow`);
    if (screenshotDir) await page.screenshot({ path:resolve(screenshotDir, `provider-services-${theme}-${width}.png`), fullPage:true });

    await entry.click();
    await page.locator('#servicePresetsDialog').waitFor({ state:'visible' });
    if (screenshotDir) await page.screenshot({ path:resolve(screenshotDir, `provider-services-presets-${theme}-${width}.png`), fullPage:true });
    await page.locator('[data-close-service-presets]').click();
    await page.locator('#servicePresetsDialog').waitFor({ state:'hidden' });
    assert.equal(await entry.isVisible(), true);
    await page.close();
  }
} finally {
  await browser.close();
}

console.log('provider services single-entry browser test passed');
