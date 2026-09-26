import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const [html, script, css, sw] = await Promise.all([
  'provider.html', 'provider.js', 'provider-ux.css', 'sw.js'
].map(name => readFile(path.join(root, name), 'utf8')));

assert.match(html, /data-section-target="telegramClientSettingsCard">Telegram и связь<\/button>/);
assert.match(html, /<nav class="telegram-client-related"[^>]*aria-label="Другие разделы сообщений"[^>]*>[\s\S]*?data-provider-view="messages"[\s\S]*?data-open-notification-templates[\s\S]*?data-open-notification-delivery[\s\S]*?<\/nav>/);
assert.match(script, /if \(openNotificationDelivery\) \{\s*await Promise\.resolve\(setProviderView\('notifications'\)\);[\s\S]*?importantNotificationState\.status === 'loading'[\s\S]*?new MutationObserver\([\s\S]*?showDelivery\(\)/);
assert.match(html, /<h3 id="notificationDeliveryTitle" tabindex="-1">Доставка<\/h3>/);
assert.match(html, /provider-ux\.css\?v=956/);
assert.match(html, /provider\.js\?v=960/);
assert.match(sw, /CACHE_PREFIX}v960/);
assert.match(sw, /provider-ux\.css\?v=956/);
assert.match(sw, /provider\.js\?v=960/);
assert.match(sw, /const OPTIONAL_ASSETS = \[[\s\S]*?'\.\/utm-funnel\.css\?v=811'/);

const section = html.match(/<nav class="telegram-client-related"[\s\S]*?<\/nav>/)?.[0];
assert.ok(section);
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage();
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:844 });
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}.provider-body{--theme-line:#dce7df;--theme-surface-alt:#f7faf8;--theme-ink:#173b2a}.secondary-button{min-height:42px;border:1px solid var(--theme-line);border-radius:12px;background:var(--theme-surface-alt);color:var(--theme-ink);font-size:13px;font-weight:700}</style><style>${css}</style><body class="provider-body" data-provider-theme="sage" data-provider-layout="soft"><section style="display:grid;grid-template-columns:42px minmax(0,1fr);width:min(100%,640px);padding:12px">${section}</section></body>`);
    const result = await page.locator('.telegram-client-related').evaluate(nav => ({
      labels:[...nav.querySelectorAll('button')].map(button => button.textContent.trim()),
      heights:[...nav.querySelectorAll('button')].map(button => button.getBoundingClientRect().height),
      tops:[...nav.querySelectorAll('button')].map(button => button.getBoundingClientRect().top),
      width:nav.getBoundingClientRect().width,
      overflow:document.documentElement.scrollWidth > innerWidth
    }));
    assert.deepEqual(result.labels, ['Переписка', 'Шаблоны', 'Доставка']);
    assert.ok(result.heights.every(height => height >= 44), `${width}px: target under 44px`);
    assert.ok(result.width > 250, `${width}px: links trapped in icon column`);
    assert.equal(result.tops[0], result.tops[2], `${width}px: links should fit one row`);
    assert.equal(result.overflow, false, `${width}px: horizontal overflow`);
  }
} finally {
  await browser.close();
}
console.log('Settings message destinations: structure, PWA and 390/760/1440 passed');
