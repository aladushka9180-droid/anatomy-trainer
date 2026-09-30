import assert from 'node:assert/strict';
import {readFileSync, mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import {resolve, extname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=readFileSync(resolve(root,'provider.js'),'utf8');
const between=(start,end)=>{
  const a=source.indexOf(start), b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a, `Missing production code: ${start}`);
  return source.slice(a,b);
};
const fixture=`
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
document.documentElement.classList.remove('provider-booting','requires-top-level');
$('#providerBoot').remove(); $('#authCard').hidden=true;
$('#dashboard').hidden=false; $('#dashboard').dataset.activeView='settings';
$$('.provider-view').forEach(el=>{el.hidden=el.dataset.providerPanel!=='settings';});
$$('.settings-card').forEach(el=>{el.hidden=el.id!=='appearanceSettingsCard';});
const PROVIDER_THEME_FILTER_KEYS=['all','light','dark'];
const PROVIDER_COLOR_MODE_KEYS=['light','dark','system'];
const PROVIDER_COLOR_MODE_LABELS={light:'светлый',dark:'тёмный',system:'как на устройстве'};
const PROVIDER_LAYOUT_LABELS={capsule:'Капсульный Flow',soft:'Мягкий минимализм'};
const providerColorSchemeQuery=matchMedia('(prefers-color-scheme: dark)');
${between('const BOOKING_COLOR_KEYS =','const BOOKING_COLOR_DEFAULT =')}
let providerThemeFilter='', displayPreferencesUpdatedAt=0, displayPreferencesPending=false;
let displayPreferences={theme:'pink-porcelain',layout:'capsule',color_mode:'light',text_scale:'default',schedule_font_style:'current',porcelain:{shade:'gentle-pink',character:'petal'},automatic_break_color:'neutral',booking_card_density:'custom',show_phone:true,show_visit_number:true,show_client_type:true,show_client_labels:true,show_notes:true,ios_transitions:true};
const organizationController=null, PROVIDER_MOBILE_NAV_ITEMS=[];
const activeProviderRole=()=> 'specialist', editedProviderRole=activeProviderRole;
const navigationForRole=()=>[],viewOrderForRole=()=>[],mergeVisibleRoleViewOrder=()=>[];
const renderMobileNavigationPreview=()=>{},renderBookings=()=>{};
const escapeHtml=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const normalizeDisplayPreferences=value=>({...value});
const persistLocalDisplayPreferences=()=>{window.fixtureSaved=structuredClone(displayPreferences);};
const queueDisplayPreferencesSync=()=>{window.fixtureSyncs=(window.fixtureSyncs||0)+1;};
${between('function renderProviderAppearanceMenu(','function applyProviderColorMode(')}
${between('function applyProviderThemeFilter(','function providerAppIsInstalled(')}
${between('function displayPreferencesFromForm(','function classifyVisitHistory(')}
${between('function handleDisplayPreferencesClick(',"$('.report-view-tabs')")}
function applyDisplayPreferences(){
  document.body.dataset.providerTheme=displayPreferences.theme;
  document.body.dataset.providerLayout=displayPreferences.layout;
  document.body.dataset.providerTextScale=displayPreferences.text_scale;
  document.body.dataset.bookingCardDensity=displayPreferences.booking_card_density;
  const theme=MinutaThemeCatalog.theme(displayPreferences.theme);
  renderProviderAppearanceMenu(MinutaProviderColorMode.apply(document.body,theme,displayPreferences.color_mode,false));
}
applyDisplayPreferences(); renderDisplayPreferencesForm();
$('#appearanceSettingsCard').scrollIntoView({block:'start'});
`;

export async function startAppearanceLayoutFixture(port=0){
  const html=readFileSync(resolve(root,'provider.html'),'utf8')
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,'')
    .replace(/<script\b[\s\S]*?<\/script>/gi,'')
    .replace('</body>','<script src="theme-catalog.js"></script><script src="provider-color-mode.js"></script><script src="appearance-fixture.js"></script></body>');
  const types={'.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'};
  const server=createServer((req,res)=>{
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    const path=new URL(req.url,'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'");
    if(path==='/provider.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if(path==='/appearance-fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(fixture);return;}
    const file=resolve(root,'.'+decodeURIComponent(path));
    const extension=extname(file);
    const allowedScript=['/theme-catalog.js','/provider-color-mode.js'].includes(path);
    if(!file.startsWith(root)||!types[extension]||(extension==='.js'&&!allowedScript)){res.writeHead(404).end();return;}
    try {res.setHeader('Content-Type',types[extension]);res.end(readFileSync(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(done=>server.listen(port,'127.0.0.1',done));
  return {server,url:`http://127.0.0.1:${server.address().port}/provider.html`};
}

async function run(){
  const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
  const {server,url}=await startAppearanceLayoutFixture();
  const browser=await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
  const output=process.env.MINUTA_APPEARANCE_OUTPUT;
  if(output)mkdirSync(output,{recursive:true});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const requests=[];
    await page.route('**/*',route=>{
      const req=route.request();
      if(!req.url().startsWith(new URL(url).origin)||req.method()!=='GET'){requests.push(req.url());return route.abort();}
      return route.continue();
    });
    for(const width of [390,760,1440]){
      await page.setViewportSize({width,height:1000});await page.goto(url);
      assert.deepEqual(errors,[]);
      const form=page.locator('#providerDisplayForm');
      const values=()=>form.locator('input:checked').evaluateAll(els=>els.map(el=>[el.name||el.id,el.value]));
      const initial=await values();
      assert.equal(await form.locator('details[open]').count(),0);
      assert.equal(await page.locator('#providerCurrentTheme').textContent(),'Розовый фарфор');
      const positions=await form.evaluate(el=>({
        tops:['.provider-theme-disclosure','.provider-layout-picker','.provider-text-scale-picker','.provider-schedule-preferences'].map(s=>el.querySelector(s).getBoundingClientRect().top),
        overflow:document.documentElement.scrollWidth>innerWidth+1
      }));
      assert.equal(positions.overflow,false,`${width}: page overflow`);
      assert.ok(positions.tops.every((y,i)=>!i||y>positions.tops[i-1]),`${width}: appearance order`);
      if(output)await page.screenshot({path:resolve(output,`appearance-${width}.png`),fullPage:false});
      await form.locator('#providerThemeDisclosure>summary').click();
      assert.deepEqual(await form.locator('[data-provider-theme-filter]').allTextContents(),['Все темы','Светлые','Тёмные']);
      for(const [filter,count] of [['all',41],['light',21],['dark',20],['all',41]]){
        await form.locator(`[data-provider-theme-filter="${filter}"]`).click();
        assert.equal(await form.locator('.provider-theme-option:visible').count(),count);
        assert.deepEqual(await values(),initial,'Theme filter must preserve every saved choice');
        assert.equal(await page.evaluate(()=>window.fixtureSyncs||0),0,'Filtering must not autosave');
      }
      await form.locator('#providerThemeDisclosure>summary').click();
      await form.locator('.provider-schedule-preferences>summary').click();
      await form.locator('label:has(input[name="scheduleFontStyle"][value="refined"])').click();
      assert.equal(await page.evaluate(()=>window.fixtureSaved.schedule_font_style),'refined');
      await form.locator('label:has(input[name="automaticBreakColor"][value="theme"])').click();
      assert.equal(await page.evaluate(()=>window.fixtureSaved.automatic_break_color),'theme');
      await form.locator('#showBookingNotes').uncheck();
      assert.equal(await page.evaluate(()=>window.fixtureSaved.show_notes),false);
      assert.equal(await page.evaluate(()=>window.fixtureSyncs),3,'Every input change reaches the existing autosave boundary once');
      assert.equal(await page.evaluate(()=>window.fixtureSaved.porcelain.character),'petal');
      assert.equal(await page.evaluate(()=>window.fixtureSaved.layout),'capsule');
      if(output)await page.screenshot({path:resolve(output,`appearance-expanded-${width}.png`),fullPage:false});
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    // Compare the new ordinary card fill to Day and prove that excluded states keep their previous paint.
    await page.evaluate(()=>{
      $('#dashboard').dataset.activeView='bookings';
      const host=$('#providerBookings');host.hidden=false;
      $$('[data-provider-panel]').forEach(el=>el.hidden=el.dataset.providerPanel!=='bookings');
      host.innerHTML=['timeline-booking','calendar-week-booking','calendar-overview-booking'].map(type=>['color-auto','color-auto status-visited','color-mint','color-auto status-block is-block','color-auto status-cancelled'].map(state=>'<button class="'+type+' '+state+'">Тестовая запись</button>').join('')).join('');
    });
    await page.mouse.move(0,0);
    await page.addStyleTag({content:'#providerBookings button { transition:none!important; }'});
    const colors=()=>page.locator('#providerBookings button').evaluateAll(els=>els.map(el=>({classes:el.className,bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderColor,color:getComputedStyle(el).color})));
    const after=await colors();
    assert.equal(after[5].bg,after[0].bg,'Week matches Day');
    assert.equal(after[10].bg,after[0].bg,'Month matches Day');
    assert.equal(after[6].bg,after[1].bg,'Completed ordinary week stays calm');
    assert.equal(after[11].bg,after[1].bg,'Completed ordinary month stays calm');
    await page.evaluate(()=>{
      const sheet=[...document.styleSheets].find(s=>s.href?.includes('/schedule-flat.css'));
      const index=[...sheet.cssRules].findIndex(r=>r.selectorText?.includes('.calendar-week-booking')&&r.selectorText?.includes('.color-auto'));
      if(index<0)throw Error('Missing new ordinary-card rule');sheet.deleteRule(index);
    });
    const before=await colors();
    for(const i of [7,8,9,12,13,14])assert.deepEqual(after[i],before[i],`Excluded state changed: ${after[i].classes}`);
    for(const i of [5,6,10,11])assert.equal(after[i].border,before[i].border,'Status borders preserved');
    console.log('Provider appearance composition, filters, autosave boundary and calendar colours: PASS');
  }finally{await browser.close();server.close();}
}
if(process.argv.includes('--serve')){
  const {url}=await startAppearanceLayoutFixture(Number(process.env.APPEARANCE_FIXTURE_PORT||38640));console.log(url);
}else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
