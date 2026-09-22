import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const providerSource = readFileSync(new URL('provider.js', root), 'utf8');
const providerHtml = readFileSync(new URL('provider.html', root), 'utf8');
const statusLabelsSource = providerSource.match(/const statusLabels = (\{[\s\S]*?\n  \});/u)?.[1];
assert.ok(statusLabelsSource, 'legacy automatic status labels must exist');
const statusLabels = new Function(`return (${statusLabelsSource})`)();
assert.equal(statusLabels.sent, 'Передано каналу');
assert.match(providerSource, /task\.mark === 'sent' \? 'Отмечено отправленным'/u);
assert.doesNotMatch(providerSource, /sent: 'Доставлено'/u);
assert.match(providerHtml, /Ручная отметка означает, что вы отметили сообщение отправленным; PrimeTime не подтверждает доставку получателю\./u);
assert.match(providerHtml, /data-notification-filter="sent">Отмечено</u);

const styleFiles = [...providerHtml.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^" ]*)?"/gu)].map((match) => match[1]);
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(`<!doctype html><html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><body class="provider-body" data-provider-theme="warm" data-provider-layout="soft"><main class="provider-view"><section class="panel notification-queue-panel notification-primary-queue"><div class="notification-toolbar"><div><small>Исходящие</small><h3>Доставка</h3><p>Ручная отметка означает, что вы отметили сообщение отправленным; PrimeTime не подтверждает доставку получателю.</p></div></div><div class="notification-list"><article class="notification-card status-sent"><span class="notification-card-icon">✓</span><div class="notification-card-main"><div class="notification-card-head"><span>Напоминание</span><b>Отмечено отправленным</b></div><h3>Тестовый клиент</h3><p>Массаж · 22 сент. в 14:00</p></div></article><article class="notification-card status-sent"><span class="notification-card-icon">↗</span><div class="notification-card-main"><div class="notification-card-head"><span>Telegram мастеру</span><b>${statusLabels.sent}</b></div><h3>Новая запись</h3><p>Массаж · попыток: 1</p></div></article></div></section></main></body></html>`);
    for (const file of styleFiles) await page.addStyleTag({ content: readFileSync(new URL(file, root), 'utf8') });
    const copy = await page.locator('.notification-primary-queue').textContent();
    assert.match(copy, /Передано каналу/u);
    assert.match(copy, /Отмечено отправленным/u);
    assert.doesNotMatch(copy, /Доставлено/u);
    const geometry = await page.locator('.notification-primary-queue').evaluate((panel) => ({
      left: panel.getBoundingClientRect().left,
      right: panel.getBoundingClientRect().right,
      viewport: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
    }));
    assert.equal(geometry.overflow, false, `${width}px legacy notification copy must not overflow`);
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `${width}px panel must stay in viewport`);
    await page.close();
  }
  console.log('Legacy notification terminology: channel handoff and manual mark PASS at 390/760/1440');
} finally {
  await browser.close();
}
