import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const read=name=>readFileSync(new URL(`../${name}`,import.meta.url),'utf8');
const css=['styles.css','client-records.css','client-directory.css','provider-ui-refinements.css'].map(read).join('\n');
const modulePath=process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright';
const playwright=await import(modulePath);
const chromium=playwright.chromium||playwright.default?.chromium;
assert.ok(chromium,'Playwright Chromium is unavailable');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});

try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.setContent(`
    <main class="provider-main"><section class="provider-dashboard" data-provider-panel="clients">
      <h2 class="view-title">Клиенты</h2><p class="view-description">История посещений</p>
      <div class="clients-layout is-detail" id="clientsLayout">
        <aside class="clients-directory">Список клиентов</aside>
        <section class="client-profile"><div id="clientProfileContent">
          <button class="client-profile-back">Назад</button>
          <div class="client-profile-head"><div class="client-profile-identity"><small>Карточка клиента</small><h3>Евгения Большшева</h3></div><div class="client-profile-contact"><a href="tel:79990000000">+7 999 000-00-00</a><button>Копировать</button></div></div>
          <div class="client-profile-primary-actions"><button class="primary">Записать</button><button class="secondary-button">Связаться</button><button class="secondary-button client-more-action"><span>Ещё</span></button></div>
          <section class="client-next-visit"><div><small>Ближайшая запись</small><strong>12 сент. · 10:00</strong></div></section>
          <div class="client-summary"><article><strong>15</strong><small>визитов</small></article><article><strong>48 300 ₽</strong><small>получено</small></article><article><strong>4 сент.</strong><small>последний визит</small></article></div>
          <section class="client-birthday-info"><div><small>День рождения</small><strong>12 апреля 1990 г.</strong></div><button>Изменить</button></section>
        </div></section>
      </div>
      <dialog class="client-profile-dialog"><div class="client-profile-dialog-head"><h3>Связаться</h3><button>×</button></div><div class="client-contact-options"><button>Скопировать номер</button></div></dialog>
    </section></main>`);
  await page.addStyleTag({content:css});
  await page.locator('body').evaluate(body=>{body.className='provider-body client-profile-detail-open';body.dataset.providerTheme='graphite';});

  for(const width of [390,760]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>{
      const profile=document.querySelector('.client-profile').getBoundingClientRect();
      const actions=[...document.querySelectorAll('.client-profile-primary-actions button')].map(node=>node.getBoundingClientRect());
      return {scrollWidth:document.documentElement.scrollWidth,profile:{left:profile.left,right:profile.right,width:profile.width},actions:actions.map(({height,width})=>({height,width})),directory:getComputedStyle(document.querySelector('.clients-directory')).display,title:getComputedStyle(document.querySelector('.view-title')).display};
    });
    assert.ok(layout.scrollWidth<=width,`Profile must not overflow at ${width}px`);
    assert.ok(layout.profile.left>=0&&layout.profile.right<=width+0.5,`Profile must stay inside ${width}px`);
    assert.equal(layout.directory,'none',`Directory must be hidden in detail at ${width}px`);
    assert.equal(layout.title,'none',`List title must be hidden in detail at ${width}px`);
    assert.ok(layout.actions.every(item=>item.height>=44),`All actions must be at least 44px at ${width}px`);
  }

  await page.setViewportSize({width:1440,height:1000});
  assert.notEqual(await page.locator('.clients-directory').evaluate(node=>getComputedStyle(node).display),'none','Desktop keeps split client context');
  await page.locator('dialog').evaluate(dialog=>dialog.showModal());
  const desktopDialog=await page.locator('dialog').evaluate(node=>{const rect=node.getBoundingClientRect();return {width:rect.width,left:rect.left,right:rect.right};});
  assert.ok(desktopDialog.width<=430&&desktopDialog.left>0&&desktopDialog.right<1440,'Desktop contact menu stays compact');
  console.log('Client profile actions: 390/760/1440 layout PASS (browser fixture)');
}finally{await browser.close();}
