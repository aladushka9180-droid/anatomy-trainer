import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const catalog = { window:{} };
runInNewContext(readFileSync(new URL('../theme-catalog.js', import.meta.url), 'utf8'), catalog);
const themes = catalog.window.MinutaThemeCatalog.themes;
const provider = readFileSync(new URL('../provider.js', import.meta.url),'utf8');
assert.match(provider, /const view = event\.target\.closest\('\[data-provider-view\]'\)/);
assert.match(provider, /setProviderView\(view\.dataset\.providerView\)/);
assert.match(provider, /if \(openNotificationTemplates\) \{[\s\S]*?renderNotificationTemplates\(\)/);
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml' };
const server = createServer((request,response) => {
  const relative = decodeURIComponent(new URL(request.url,'http://localhost').pathname).replace(/^\//,'');
  const file = resolve(root, relative);
  if (!file.startsWith(root+sep) || !existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('content-type', mime[extname(file)] || 'text/plain');
  createReadStream(file).pipe(response);
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390,760,1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    await page.goto(`http://127.0.0.1:${server.address().port}/provider-messages-preview.html`);
    const links = page.getByRole('navigation',{ name:'Связанные разделы' });
    const delivery = links.getByRole('button',{ name:'Доставка уведомлений' });
    const templates = links.getByRole('button',{ name:'Шаблоны сообщений' });
    assert.ok(await delivery.isVisible());
    assert.ok(await templates.isVisible());
    if (process.env.MINUTA_MESSAGE_CONTEXT_SCREENSHOT_DIR) {
      mkdirSync(process.env.MINUTA_MESSAGE_CONTEXT_SCREENSHOT_DIR, { recursive:true });
      await page.locator('.message-center-heading').screenshot({ path:join(process.env.MINUTA_MESSAGE_CONTEXT_SCREENSHOT_DIR, `message-context-${width}.png`) });
    }
    assert.equal(await delivery.getAttribute('data-provider-view'),'notifications');
    assert.ok(await templates.getAttribute('data-open-notification-templates') !== null);
    await page.evaluate(() => {
      window.contextClicks = [];
      document.addEventListener('click', event => {
        const button = event.target.closest('.message-center-context-links button');
        if (button) window.contextClicks.push(button.textContent.trim());
      });
    });
    await delivery.click();
    await templates.click();
    assert.deepEqual(await page.evaluate(() => window.contextClicks),['Доставка уведомлений','Шаблоны сообщений']);
    assert.equal(await page.evaluate(() => window.previewMessageCenter.snapshot().outbox.length),0);
    assert.equal(await page.evaluate(() => window.previewBridgeState.sequence),4);
    for (const theme of themes) {
      const state = await page.evaluate(palette => {
        const names = { bg:'bg', surface:'surface', surfaceAlt:'surface-alt', ink:'ink', muted:'muted',
          line:'line', accent:'accent', accentSoft:'accent-soft', contrast:'accent-contrast' };
        for (const [name, cssName] of Object.entries(names)) document.body.style.setProperty(`--theme-${cssName}`, palette[name]);
        const buttons = [...document.querySelectorAll('.message-center-context-links button')];
        const rgb = value => (value.match(/[\d.]+/g) || []).slice(0,3).map(Number);
        const luminance = value => rgb(value).map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
          .reduce((sum,n,i) => sum + n * [.2126,.7152,.0722][i],0);
        const contrast = (a,b) => { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
        return { overflow:document.documentElement.scrollWidth > innerWidth + 1,
          buttons:buttons.map(button => { const style=getComputedStyle(button); return {
            contrast:contrast(style.color,style.backgroundColor), height:button.getBoundingClientRect().height,
            clipped:button.scrollWidth > button.clientWidth + 1 }; }) };
      }, theme.palette);
      assert.equal(state.overflow,false,`${theme.key} ${width}px overflow`);
      for (const button of state.buttons) {
        assert.ok(button.contrast >= 4.5,`${theme.key} ${width}px contrast ${button.contrast.toFixed(2)}`);
        assert.ok(button.height >= 40 && !button.clipped,`${theme.key} ${width}px button geometry`);
      }
    }
    await page.locator('#messageCenterTitle').focus();
    await page.keyboard.press('Tab');
    assert.equal(await delivery.evaluate(button => button.matches(':focus-visible')),true,`${width}px keyboard focus`);
    console.log(`Message context links visible and non-sending: ${width}px`);
    await page.close();
  }
} finally { await browser.close(); server.close(); }
