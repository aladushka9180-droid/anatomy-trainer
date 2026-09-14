import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Playwright Chromium is available');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../client-messaging.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const start = html.indexOf('<dialog class="client-messaging-dialog"');
const end = html.indexOf('</dialog>', start) + '</dialog>'.length;
assert.ok(start >= 0 && end > start, 'Messaging dialog fixture exists');
const dialog = html.slice(start, end);
const browser = await chromium.launch({ headless:true });

try {
  for (const width of [390,760,1440]) {
    for (const theme of ['', 'oled-mono']) {
      const page = await browser.newPage({ viewport:{ width, height:width === 390 ? 844 : 900 } });
      await page.setContent(`<!doctype html><html lang="ru"><body class="provider-body" ${theme ? `data-provider-theme="${theme}"` : ''}><button id="open" data-message-client data-client-phone="+79990000000" data-client-name="Марина" data-message-service="Массаж" data-message-date="20 сентября 2026" data-message-time="10:30" data-message-address="Ижевск">Открыть</button>${dialog}</body></html>`);
      await page.addStyleTag({ content:styles });
      await page.addScriptTag({ content:source });
      await page.evaluate(() => {
        MinutaClientMessaging.configure({
          db:{ rpc:async name => name === 'get_provider_message_templates_v161'
            ? { data:{ organization_id:'00000000-0000-4000-8000-000000000010',performer_id:'00000000-0000-4000-8000-000000000011',templates:[] },error:null }
            : { data:null,error:null } },
          getOrganization:() => ({ id:'00000000-0000-4000-8000-000000000010' }),
          getCurrentUser:() => ({ id:'00000000-0000-4000-8000-000000000011' }),
          requireWrites:() => true
        });
      });
      await page.locator('#open').click();
      await page.locator('#clientMessagingTemplateStatus').waitFor();
      await page.waitForFunction(() => !document.querySelector('#clientMessagingTemplateStatus').textContent.includes('Загружаем'));
      const geometry = await page.evaluate(() => {
        const dialogNode = document.querySelector('#clientMessagingDialog');
        const head = dialogNode.querySelector('.client-messaging-head').getBoundingClientRect();
        const close = dialogNode.querySelector('[data-close-client-messaging]').getBoundingClientRect();
        const recipient = dialogNode.querySelector('.client-messaging-recipient').getBoundingClientRect();
        const presets = dialogNode.querySelector('.client-message-presets').getBoundingClientRect();
        const editor = dialogNode.querySelector('#clientMessagingText').getBoundingClientRect();
        const preview = dialogNode.querySelector('#clientMessagingPreview').textContent;
        const rect = dialogNode.getBoundingClientRect();
        return { rect:{ top:rect.top,left:rect.left,right:rect.right,bottom:rect.bottom },head:{ top:head.top },close:{ top:close.top,right:close.right,bottom:close.bottom },recipient:{ top:recipient.top },presets:{ top:presets.top },editorHeight:editor.height,preview,channelsHidden:dialogNode.querySelector('#clientMessagingChannels').hidden };
      });
      assert.ok(geometry.rect.top >= 0 && geometry.rect.left >= 0 && geometry.rect.right <= width + .5, `${width}/${theme || 'light'} dialog fits viewport`);
      assert.ok(geometry.head.top >= geometry.rect.top - .5, `${width}/${theme || 'light'} header is not clipped`);
      assert.ok(geometry.close.top >= 0 && geometry.close.right <= width + .5 && geometry.close.bottom <= 900, `${width}/${theme || 'light'} close is visible`);
      assert.ok(geometry.recipient.top - geometry.rect.top < 120 && geometry.presets.top - geometry.rect.top < 180, `${width}/${theme || 'light'} recipient and types are immediate: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.editorHeight <= 180, `${width}/${theme || 'light'} editor stays compact`);
      assert.equal(geometry.preview, 'Здравствуйте, Марина! Напоминаем о записи на услугу «Массаж» 20 сентября 2026 в 10:30. Адрес: Ижевск.');
      assert.equal(geometry.channelsHidden, true, 'Channel list starts collapsed');
      await page.locator('[data-message-preset="custom"]').click();
      await page.locator('#clientMessagingText').fill('');
      await page.locator('#clientMessagingSendChooser').click();
      await page.locator('[data-message-channel="whatsapp"]').click();
      assert.equal(await page.locator('#clientMessagingStatus').textContent(), 'Сначала подготовьте сообщение.');
      await page.locator('#clientMessagingText').fill('А'.repeat(4000));
      const previewBox = await page.locator('.client-message-preview p').evaluate(node => ({ scrollHeight:node.scrollHeight,clientHeight:node.clientHeight }));
      assert.ok(previewBox.clientHeight <= 92 && previewBox.scrollHeight >= previewBox.clientHeight, 'Long preview remains bounded and scrollable');
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log('Provider message templates v161 browser: 390/760/1440 light and dark geometry, exact preview, empty and long text passed.');
