import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map(await Promise.all(['styles.css','provider-themes-signature.css','provider-ux.css','client-themes.css','theme-catalog.js','provider.html'].map(async name => [name, await readFile(path.join(root,name),'utf8')])));
const card = assets.get('provider.html').match(/<section class="panel settings-card client-appearance-settings-card[\s\S]*?<\/section>/)?.[0];
assert.ok(card);
const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#fff5f8"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/provider-themes-signature.css"><link rel="stylesheet" href="/provider-ux.css"><link rel="stylesheet" href="/client-themes.css"><style>body{margin:0}.visual-stage{max-width:1260px;margin:0 auto;padding:24px}.visual-stage>.panel{width:100%}*{transition:none!important}</style></head><body class="provider-body" data-provider-theme="warm"><main class="visual-stage">${card}</main><script src="/theme-catalog.js"></script><script>
const catalog=window.MinutaThemeCatalog,form=document.querySelector('#clientAppearanceForm');
document.querySelector('#providerClientThemeOptions').innerHTML=catalog.clientThemes.map(item=>'<label class="client-theme-option theme-'+item.key+'" data-theme-groups="'+item.groups.join(' ')+'"><input type="radio" name="providerClientTheme" value="'+item.key+'" '+(item.key==='pink-porcelain'?'checked':'')+'><i></i><span><strong>'+item.label+'</strong><small>'+item.description+'</small></span></label>').join('');
document.querySelector('#porcelainCharacterOptions').innerHTML=catalog.porcelainCharacters.map(item=>'<label class="porcelain-option porcelain-art-'+item.key+'"><input type="radio" name="porcelainCharacter" value="'+item.key+'" '+(item.key==='petal'?'checked':'')+'><span class="porcelain-art"><i></i><b></b></span><span class="porcelain-option-copy"><strong>'+item.label+'</strong><small>'+item.tagline+'</small><span class="porcelain-mini-palette"><i></i><i></i><i></i><i></i><i></i></span></span></label>').join('');
document.querySelector('#porcelainShadeOptions').innerHTML=catalog.porcelainShades.map(item=>'<label class="porcelain-shade-choice porcelain-shade-'+item.key+'"><input type="radio" name="porcelainShade" value="'+item.key+'" '+(item.key==='gentle-pink'?'checked':'')+'><span class="porcelain-shade-disc"></span><strong>'+item.label+'</strong>'+(item.recommended?'<em>Рекомендуем</em>':'')+'</label>').join('');
document.querySelector('#clientHeadlineOptions').innerHTML=catalog.headlines.map(item=>'<label class="client-headline-option"><input type="radio" name="providerClientHeadline" value="'+item.key+'" '+(item.key==='care'?'checked':'')+'><strong>'+item.label+'</strong><small>'+item.description+'</small></label>').join('');
document.querySelector('#providerClientThemeChooser').open=true;document.querySelector('#porcelainCustomization').hidden=false;document.querySelector('#resetPorcelainTheme').hidden=false;document.querySelector('#applyClientAppearance').textContent='Применить тему';
function preview(){const settings=catalog.normalizeSettings({theme_key:form.querySelector('[name="providerClientTheme"]:checked').value,headline_key:form.querySelector('[name="providerClientHeadline"]:checked').value,porcelain:{shade:form.querySelector('[name="porcelainShade"]:checked').value,character:form.querySelector('[name="porcelainCharacter"]:checked').value}}),palette=catalog.paletteForSettings(settings),el=document.querySelector('#clientAppearancePreview');el.dataset.previewTheme=settings.theme_key;el.dataset.previewCharacter=settings.porcelain?.character||'';for(const [key,value] of Object.entries(palette))if(typeof value==='string')el.style.setProperty('--client-preview-'+key,value);document.querySelector('#clientAppearanceThemeName').textContent=catalog.theme(settings.theme_key).label;document.querySelector('#clientAppearanceThemeDescription').textContent=catalog.porcelainShades.find(item=>item.key===settings.porcelain.shade).label+' · '+catalog.porcelainCharacters.find(item=>item.key===settings.porcelain.character).label;document.querySelector('#clientAppearancePreviewHeadline').textContent=catalog.headline(settings.headline_key).label;document.querySelector('#clientAppearancePreviewTagline').hidden=false;document.querySelector('#clientAppearancePreviewTagline').textContent=catalog.porcelainCharacters.find(item=>item.key===settings.porcelain.character).tagline;}form.addEventListener('change',preview);preview();
</script></body></html>`;
const server=createServer((request,response)=>{const name=new URL(request.url,'http://127.0.0.1').pathname.slice(1);response.setHeader('Cache-Control','no-store');if(assets.has(name)){response.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');response.end(assets.get(name));return;}response.setHeader('Content-Type','text/html; charset=utf-8');response.end(fixture);});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const out=path.join(root,'.test-artifacts');await mkdir(out,{recursive:true});
  for(const width of [390,760,1440]){
    const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.locator('#providerClientThemeChooser').evaluate(element => { element.open = false; });
    await page.locator('label.porcelain-shade-petal-pink').click();
    await page.locator('label.porcelain-art-silk').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    const result=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,theme:document.querySelector('#clientAppearancePreview').dataset.previewTheme,character:document.querySelector('#clientAppearancePreview').dataset.previewCharacter,tagline:document.querySelector('#clientAppearancePreviewTagline').textContent,previewRect:document.querySelector('#clientAppearancePreview').getBoundingClientRect().toJSON(),pickerRect:document.querySelector('#porcelainCustomization').getBoundingClientRect().toJSON()}));
    assert.equal(result.theme,'pink-porcelain');assert.equal(result.character,'silk');assert.match(result.tagline,/Лёгкость/);assert.ok(result.scrollWidth<=result.innerWidth+1,`${width}px horizontal overflow: ${result.scrollWidth}`);assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(out,`pink-porcelain-${width}.png`),fullPage:true});
    console.log(`${width}px: no overflow; preview ${Math.round(result.previewRect.width)}px; choices ${Math.round(result.pickerRect.width)}px`);
    await page.close();
  }
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
