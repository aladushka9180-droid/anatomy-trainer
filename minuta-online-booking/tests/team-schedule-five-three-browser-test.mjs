import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {fixtureHtml} from './team-schedule-fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.TEAM_ACCEPTANCE_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{
 for(const width of [390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!=='https://team-acceptance.test'||r.request().method()!=='GET'){external.push(u.href);return r.abort();}if(u.pathname==='/')return r.fulfill({contentType:'text/html',body:fixtureHtml({acceptance:true})});try{return r.fulfill({body:readFileSync(resolve(root,'.'+u.pathname)),contentType:({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(u.pathname)]||'application/octet-stream'});}catch{return r.abort();}});
  await page.goto('https://team-acceptance.test/');await page.locator('#teamScheduleRange').waitFor({state:'visible'});
  assert.equal(await page.locator('#teamSchedulePerson option').count(),6);
  assert.equal(await page.locator('#teamScheduleLocation option').count(),4);
  assert.equal(await page.locator('.ts-desktop tbody tr').count(),5);
  assert.equal(await page.locator('.ts-days [data-ts-day]').count(),7);
  assert.equal(await page.locator('.ts-desktop .ts-conflict').count(),3,'cross-branch overlap plus absence conflict');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const callsBefore=await page.locator('#testCalls').textContent();
  if(width<760){await page.locator('#teamScheduleFilters>summary').click();}
  // Native selects are hidden by the existing select presentation; use the public change event.
  await page.locator('#teamScheduleLocation').evaluate(el=>{el.value='l1';el.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.locator('.ts-desktop .ts-conflict').count(),2,'hidden foreign-branch overlap remains a visible risk');
  await page.locator('[data-ts-clear]').click();
  assert.equal(await page.locator('.ts-desktop .ts-conflict').count(),3);
  if(width<760){await page.locator('[data-ts-day]').nth(1).click();assert.equal(await page.locator('[data-ts-day][aria-pressed=true]').count(),1);await page.locator('[data-ts-day]').first().click();}
  if(output)await page.locator('#shiftsPanel').screenshot({path:resolve(output,'team-5x3-'+width+'.png')});
  await page.getByRole('button',{name:'Добавить смену',exact:true}).click();await page.locator('dialog[open]').press('Escape');
  assert.equal(await page.locator('#testCalls').textContent(),callsBefore,'filters/day/dialog cancel perform no writes');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
 }
 console.log('O09 local 5 specialists × 3 branches: 390/760/1440, seven days, three conflicts, branch filter preserves hidden conflict, day/reset/dialog cancel; no external transport.');
}finally{await browser.close();}
