import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8');
const start = html.indexOf('<div class="organization-invite-share" id="memberInviteShare" hidden>');
const end = html.indexOf('</button></div>', start) + '</button></div>'.length;
assert.ok(start >= 0 && end > start, 'Invite handoff is missing');
assert.match(html, /data-section-target="organizationPeopleSection">Люди и филиалы<\/button>/);
const snippet = html.slice(start, end).replace(' id="memberInviteShare" hidden', ' id="memberInviteShare"');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent('<body class="provider-body"><main style="width:min(100%,700px);margin:auto"><nav><button type="button">Люди и филиалы</button></nav>' + snippet + '</main></body>');
    await page.addStyleTag({ path:path.join(root, 'styles.css') });
    const state = await page.evaluate(() => {
      const share = document.querySelector('#memberInviteShare');
      const note = share?.querySelector('small');
      const target = document.querySelector('nav button');
      const button = document.querySelector('#copyMemberInviteLink');
      return {
        note:note?.textContent?.trim(),
        target:target?.textContent?.trim(),
        visible:getComputedStyle(share).display !== 'none',
        buttonVisible:getComputedStyle(button).display !== 'none',
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
    assert.equal(state.note, 'Войдите с этим email и откройте «Организация → Люди и филиалы».');
    assert.equal(state.target, 'Люди и филиалы');
    assert.equal(state.visible, true);
    assert.equal(state.buttonVisible, true);
    assert.equal(state.overflow, false, `${width}px overflow`);
    await page.close();
  }
  console.log('Invite handoff: correct destination and no overflow at 390/760/1440');
} finally {
  await browser.close();
}
