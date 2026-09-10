import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const contentTypes={
  '.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml',
  '.png':'image/png','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2'
};

const fixtureScript=`
document.documentElement.classList.remove('provider-booting','requires-top-level');
document.body.dataset.providerTheme='hitech';
document.body.dataset.providerLayout='soft';
document.body.dataset.providerTextScale='default';
document.body.dataset.bookingCardDensity='compact';
document.querySelector('#providerBoot').hidden=true;
document.querySelector('#dashboard').hidden=false;
document.querySelector('#providerBusinessName').textContent='PrimeTime Studio';
document.querySelector('#sidebarName').textContent='Марина';
document.querySelector('#todayLabel').textContent='Четверг, 10 сентября';
document.querySelector('#currentTimeLabel').textContent='14:30';
document.querySelector('#syncState').className='sync-state is-online';
document.querySelector('#syncState span').textContent='Синхронизировано';
document.querySelector('#syncVerifiedAt').textContent='Сверка 10.09, 14:30';
document.querySelector('#todayBookingsCount').textContent='2';
document.querySelector('#newBookingsCount').textContent='5';
document.querySelector('#activeServicesCount').textContent='8';
document.querySelector('#selectedDateTitle').textContent='Сегодня';
document.querySelector('#selectedDateSummary').textContent='2 записи · 1 перерыв';
document.querySelector('#desktopAppInstallButton').hidden=true;
document.querySelector('#dateStrip').innerHTML=['Пн|7','Вт|8','Ср|9','Сегодня|10','Пт|11','Сб|12','Вс|13'].map((item,index)=>{const [day,date]=item.split('|');return '<button type="button" class="'+(index===3?'active':'')+'"><span>'+day+'</span><strong>'+date+'</strong><small>сент</small></button>';}).join('');
document.querySelector('#providerBookings').innerHTML='<article class="provider-booking"><div><strong>10:00</strong><span>Массаж спины · 60 минут</span></div><div><strong>Анна</strong><small>Подтверждена</small></div></article><article class="provider-booking"><div><strong>13:30</strong><span>Общий массаж · 90 минут</span></div><div><strong>Елена</strong><small>Новая запись</small></div></article>';

let requestedMode='light';
const colorQuery=matchMedia('(prefers-color-scheme: dark)');
const theme=()=>window.MinutaThemeCatalog.theme(document.body.dataset.providerTheme);
function renderMode(){
  const state=window.MinutaProviderColorMode.apply(document.body,theme(),requestedMode,colorQuery.matches);
  document.querySelector('#providerAppearanceMenu').querySelectorAll('[data-provider-color-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.providerColorMode===requestedMode)));
  document.querySelector('#providerAppearanceIcon').setAttribute('href','ui-icons.svg#icon-'+(state.resolved==='dark'?'moon':'sun'));
  document.querySelector('#providerAppearanceThemeName').textContent=theme().label;
  document.querySelector('#providerAppearanceLayoutName').textContent='Мягкий минимализм';
  const label=requestedMode==='system'?'как на устройстве, сейчас '+(state.resolved==='dark'?'тёмный':'светлый'):requestedMode==='dark'?'тёмный':'светлый';
  document.querySelector('#providerAppearanceMenu>summary').setAttribute('aria-label','Оформление: '+label+' режим');
  return state;
}
const appearanceMenu=document.querySelector('#providerAppearanceMenu');
const toolsMenu=document.querySelector('.provider-topbar-tools');
appearanceMenu.addEventListener('click',event=>{
  const mode=event.target.closest('.provider-appearance-modes>[data-provider-color-mode]');
  if(mode){requestedMode=mode.dataset.providerColorMode;renderMode();appearanceMenu.open=false;return;}
  if(event.target.closest('#openProviderAppearanceSettings')){
    appearanceMenu.open=false;
    document.querySelectorAll('.provider-view').forEach(panel=>{panel.hidden=true;panel.classList.remove('active');});
    const settings=document.querySelector('[data-provider-panel="settings"]');settings.hidden=false;settings.classList.add('active');
    document.querySelectorAll('[data-provider-view]').forEach(button=>button.classList.toggle('active',button.dataset.providerView==='settings'));
    document.querySelector('[data-section-target="appearanceSettingsCard"]')?.click();
    document.querySelector('#appearanceSettingsCard')?.scrollIntoView({block:'start'});
  }
});
appearanceMenu.addEventListener('toggle',()=>{if(appearanceMenu.open)toolsMenu.open=false;});
toolsMenu.addEventListener('toggle',()=>{if(toolsMenu.open)appearanceMenu.open=false;});
document.addEventListener('pointerdown',event=>{if(appearanceMenu.open&&!event.target.closest('#providerAppearanceMenu'))appearanceMenu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&appearanceMenu.open){appearanceMenu.open=false;appearanceMenu.querySelector('summary').focus();}});
window.__appearanceFixture={setMode(mode){requestedMode=mode;return renderMode();},get mode(){return requestedMode;}};
renderMode();
`;

export async function startAppearanceFixture(port=0){
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url,'http://127.0.0.1');
      response.setHeader('Cache-Control','no-store');
      if(url.pathname==='/fixture.js'){
        response.setHeader('Content-Type','text/javascript; charset=utf-8');
        response.end(fixtureScript);return;
      }
      if(url.pathname!=='/'&&url.pathname!=='/provider.html'){
        const target=path.resolve(root,decodeURIComponent(url.pathname.slice(1)));
        if(!target.startsWith(root)||!contentTypes[path.extname(target)]){response.writeHead(404).end();return;}
        response.setHeader('Content-Type',contentTypes[path.extname(target)]);
        response.end(await readFile(target));return;
      }
      let html=await readFile(path.join(root,'provider.html'),'utf8');
      html=html
        .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
        .replace(/<script\b[\s\S]*?<\/script>/g,'')
        .replace('<section class="provider-app" id="dashboard" hidden>','<section class="provider-app" id="dashboard">')
        .replace('</body>','<script src="theme-catalog.js"></script><script src="provider-color-mode.js"></script><script src="fixture.js"></script></body>');
      response.setHeader('Content-Type','text/html; charset=utf-8');
      response.end(html);
    }catch(error){response.writeHead(500).end(String(error));}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,url:`http://127.0.0.1:${server.address().port}/provider.html`};
}

async function run(){
  const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
  const {server,url}=await startAppearanceFixture();
  let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
    const page=await browser.newPage();
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.goto(url);await page.locator('#dashboard').waitFor({state:'visible'});
    for(const width of [390,760,1440]){
      await page.setViewportSize({width,height:1000});
      for(const mode of ['light','dark','system']){
        await page.evaluate(mode=>window.__appearanceFixture.setMode(mode),mode);
        await page.locator('#providerAppearanceMenu>summary').click();
        const result=await page.evaluate(()=>{
          const menu=document.querySelector('.provider-appearance-popover').getBoundingClientRect();
          const bodyStyle=getComputedStyle(document.body),workspaceStyle=getComputedStyle(document.querySelector('.provider-app')),surfaceStyle=getComputedStyle(document.querySelector('.schedule-card'));
          return {
            requested:document.body.dataset.providerColorMode,resolved:document.body.dataset.providerResolvedColorMode,
            menu:{left:menu.left,right:menu.right,top:menu.top,bottom:menu.bottom},
            width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
            bodyBackground:bodyStyle.backgroundColor,workspaceBackground:workspaceStyle.backgroundColor,surfaceBackground:surfaceStyle.backgroundColor,
            pressed:[...document.querySelector('#providerAppearanceMenu').querySelectorAll('[data-provider-color-mode]')].filter(button=>button.getAttribute('aria-pressed')==='true').map(button=>button.dataset.providerColorMode)
          };
        });
        assert.equal(result.requested,mode);
        assert.ok(['light','dark'].includes(result.resolved));
        assert.deepEqual(result.pressed,[mode]);
        assert.ok(result.menu.left>=0&&result.menu.right<=width+1&&result.menu.bottom<=1000,'Меню оформления вышло за экран');
        assert.ok(result.scrollWidth<=width+1,'Страница получила горизонтальную прокрутку');
        assert.notEqual(result.surfaceBackground,'rgba(0, 0, 0, 0)');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#providerAppearanceMenu').getAttribute('open'),null);
      }
    }
    await page.setViewportSize({width:390,height:1000});
    await page.locator('#providerAppearanceMenu>summary').click();
    await page.locator('#openProviderAppearanceSettings').click();
    await page.locator('[data-provider-panel="settings"]').waitFor({state:'visible'});
    assert.ok(await page.locator('#appearanceSettingsCard').isVisible(),'Ссылка не открыла настройки оформления');
    assert.deepEqual(pageErrors,[]);
    console.log('Appearance menu browser: light/dark/system and Settings link verified at 390, 760 and 1440 px.');
  }finally{await browser?.close();server.close();}
}

if(process.argv.includes('--serve')){
  const {url}=await startAppearanceFixture(38511);console.log(url);
}else await run();
