import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});

try {
  const page=await browser.newPage();
  await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}</style></head>
    <body class="provider-body" data-provider-theme="midnight" style="--theme-surface:#101d31;--theme-surface-alt:#16263c;--theme-line:#6a7d95;--theme-ink:#f5f8ff;--theme-muted:#91a0b3;--theme-accent:#3e88b8;margin:0;background:#101d31">
      <main style="width:min(100% - 32px,800px);margin:24px auto">
        <div class="booking-sheet-summary">
          <div class="booking-sheet-client">
            <small class="booking-sheet-client-label">Клиент</small>
            <span class="client-avatar-control booking-client-avatar-control" style="width:48px;height:48px"></span>
            <div class="booking-sheet-client-name"><strong>Марина</strong></div>
            <a href="tel:+79090509525">+7 (909) 050-95-25</a>
          </div>
          <div class="booking-sheet-price"><small>Стоимость</small><strong>3 000 ₽</strong></div>
        </div>
        <div class="session-composer" style="margin-top:24px">
          <button class="session-add-button">＋ Дополнительная услуга</button>
          <div class="session-composer-summary">
            <span><small>Продолжительность</small><strong>60 мин</strong></span>
            <span><small>Итого</small><strong>3 000 ₽</strong></span>
          </div>
        </div>
      </main>
    </body></html>`);

  for (const width of [390,760,1440]) {
    await page.setViewportSize({width,height:900});
    const result=await page.evaluate(() => {
      const box=selector => document.querySelector(selector).getBoundingClientRect();
      const cssOf=selector => getComputedStyle(document.querySelector(selector));
      const label=box('.booking-sheet-client-label');
      const name=box('.booking-sheet-client-name');
      const phone=box('.booking-sheet-client>a');
      const avatar=box('.booking-client-avatar-control');
      const groupTop=label.top;
      const groupBottom=phone.bottom;
      return {
        labelNameGap:name.top-label.bottom,
        namePhoneGap:phone.top-name.bottom,
        groupHeight:groupBottom-groupTop,
        avatarCenterDelta:Math.abs((avatar.top+avatar.height/2)-(groupTop+(groupBottom-groupTop)/2)),
        bodyOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
        addBackground:cssOf('.session-add-button').backgroundColor,
        addColor:cssOf('.session-add-button').color,
        summaryBackground:cssOf('.session-composer-summary>span').backgroundColor,
        summaryColor:cssOf('.session-composer-summary strong').color,
        summaryMuted:cssOf('.session-composer-summary small').color
      };
    });
    assert.ok(result.labelNameGap>=1&&result.labelNameGap<=3,`${width}px: подпись и имя разошлись (${result.labelNameGap}px)`);
    assert.ok(result.namePhoneGap>=1&&result.namePhoneGap<=3,`${width}px: имя и телефон разошлись (${result.namePhoneGap}px)`);
    assert.ok(result.groupHeight<=50,`${width}px: текстовая группа клиента слишком высокая (${result.groupHeight}px)`);
    assert.ok(result.avatarCenterDelta<=1,`${width}px: аватар не отцентрирован по данным клиента (${result.avatarCenterDelta}px)`);
    assert.ok(result.bodyOverflow<=0,`${width}px: появился горизонтальный выход за экран (${result.bodyOverflow}px)`);
    assert.equal(result.addBackground,'rgb(22, 38, 60)',`${width}px: кнопка дополнительной услуги не использует поверхность темы`);
    assert.equal(result.summaryBackground,'rgb(22, 38, 60)',`${width}px: итоги не используют поверхность темы`);
    assert.equal(result.addColor,'rgb(62, 136, 184)',`${width}px: кнопка дополнительной услуги не использует акцент темы`);
    assert.equal(result.summaryColor,'rgb(245, 248, 255)',`${width}px: значение итога не использует основной цвет темы`);
    assert.equal(result.summaryMuted,'rgb(145, 160, 179)',`${width}px: подпись итога не использует приглушённый цвет темы`);
  }

  console.log('booking sheet compact theme browser test: OK');
} finally {
  await browser.close();
}
