import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startServer} from './certificate-designer-fixture-server.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.MINUTA_PLAYWRIGHT_MODULE||'playwright');
const {server,url}=await startServer(),browser=await chromium.launch({headless:true}),context=await browser.newContext({acceptDownloads:true});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const output=process.env.MINUTA_CERTIFICATE_OUTPUT||fileURLToPath(new URL('../../outputs/certificate-designer/',import.meta.url));mkdirSync(output,{recursive:true});
let checks=0;
const store='drafts-'+Date.now();
async function saved(){await page.locator('[data-save-draft]').click();await page.locator('[data-message]').filter({hasText:'Черновик сохранён'}).waitFor();}
try{
  await page.goto(url+'/fixture.html?automatic&store='+store);await page.locator('[data-canvas]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-number-mode]').inputValue(),'auto');assert.equal(await page.locator('[data-number]').inputValue(),'1');assert.equal(await page.locator('[data-number]').evaluate(n=>n.readOnly),true);checks++;
  for(const selector of ['[data-download]','[data-share]','[data-print]'])assert.equal(await page.locator(selector).isDisabled(),true);checks++;
  await page.locator('[data-content-mode]').selectOption('custom');await page.locator('[data-custom-text]').fill('');await page.locator('[data-date]').fill('');await saved();
  assert.equal(await page.evaluate(()=>window.certificateFixture.getState().records.length),0);checks++;
  await page.reload();await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  assert.equal(await page.locator('[data-content-mode]').inputValue(),'custom');assert.equal(await page.locator('[data-custom-text]').inputValue(),'');assert.equal(await page.locator('[data-date]').inputValue(),'');checks++;
  await page.locator('[data-custom-text]').fill('Любая услуга\nПодарок к празднику');await page.locator('[data-date]').fill('2026-10-03');await page.locator('[data-expiry]').fill('2027-05-04');await page.locator('[data-remind]').fill('14');await page.locator('[data-format]').selectOption('pdf');await page.locator('[data-paper]').selectOption('a4');
  await page.locator('[data-font]').selectOption('History Pro 02');await page.locator('[data-font-file]').setInputFiles(fileURLToPath(new URL('../manrope-cyrillic-v20.woff2',import.meta.url)));
  await page.locator('[data-message]').filter({hasText:'Шрифт подключён'}).waitFor();
  const version=await page.evaluate(()=>window.certificateFixture.getState().drafts[0].revision);
  await saved();assert.equal(await page.evaluate(()=>window.certificateFixture.getState().drafts.length),1);assert.notEqual(await page.evaluate(()=>window.certificateFixture.getState().drafts[0].revision),version);checks++;
  const snapshot=await page.evaluate(()=>window.certificateFixture.getState().drafts[0].body);
  assert.ok(snapshot.template.font_files['History Pro 02']);assert.equal(snapshot.template.saved,false);checks++;
  await page.reload();await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await page.locator('[data-canvas]').waitFor({state:'visible'});
  for(const [field,value] of Object.entries({'custom-text':'Любая услуга\nПодарок к празднику',font:'History Pro 02',date:'2026-10-03',expiry:'2027-05-04',remind:'14',format:'pdf',paper:'a4'}))assert.equal(await page.locator(`[data-${field}]`).inputValue(),value);checks++;
  assert.equal(await page.locator('[data-issue]').isDisabled(),true);assert.equal(await page.locator('[data-font-upload]').isVisible(),false);checks++;
  await page.getByText('Загрузить и настроить макет',{exact:true}).click();await page.locator('[data-save-template]').click();await page.locator('[data-message]').filter({hasText:'Макет сохранён'}).waitFor();await saved();
  for(const width of [390,760,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+`/draft-create-${width}.png`,fullPage:true});checks++;}
  await page.getByRole('tab',{name:'Черновики',exact:true}).click();
  for(const width of [390,760,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:output+`/draft-list-${width}.png`,fullPage:true});checks++;}
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  // Another specialist takes the suggested number after preview. The ACK must redraw the assigned one.
  await page.evaluate(()=>{const repo=window.certificateFixture.repository,issue=repo.issue;let first=true;window.autoRequests=[];repo.issue=async(org,record,request)=>{window.autoRequests.push({record:structuredClone(record),request});if(first){first=false;const competing={...record,number_mode:undefined,draft_id:undefined,draft_revision:undefined};delete competing.number_mode;delete competing.draft_id;delete competing.draft_revision;await issue(org,competing,crypto.randomUUID());const result=await issue(org,record,request);throw new Error('unknown response after commit');}return issue(org,record,request)}});
  await page.locator('[data-issue]').click();await page.locator('[data-error]').waitFor({state:'visible'});assert.equal(await page.locator('[data-number]').inputValue(),'1');assert.equal(await page.locator('[data-number]').isDisabled(),true);checks++;
  const dispatched=await page.evaluate(()=>window.autoRequests[0]);await page.reload();await page.locator('[data-canvas]').waitFor({state:'visible'});
  assert.equal(await page.locator('[data-number]').inputValue(),'1');assert.equal(await page.locator('[data-download]').isDisabled(),true);checks++;
  await page.evaluate(first=>{const repo=window.certificateFixture.repository,issue=repo.issue;window.autoRequests=[first];repo.issue=(org,record,request)=>{window.autoRequests.push({record:structuredClone(record),request});return issue(org,record,request)}},dispatched);
  await page.locator('[data-issue]').click();await page.locator('[data-message]').filter({hasText:'№ 2 сохранён'}).waitFor();
  const requests=await page.evaluate(()=>window.autoRequests);assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0]);assert.equal(await page.locator('[data-number]').inputValue(),'2');assert.ok((await page.locator('[data-canvas]').getAttribute('aria-label')).includes('Номер 2'));checks++;
  assert.equal(await page.locator('[data-download]').isDisabled(),false);await page.locator('[data-format]').selectOption('pdf');const promise=page.waitForEvent('download');await page.locator('[data-download]').click();assert.equal((await promise).suggestedFilename(),'certificate-2.pdf');checks++;
  await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.getByText('Сохранённых черновиков пока нет.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.certificateFixture.getState().drafts.filter(d=>!d.issued_id).length),0);checks++;
  await page.getByRole('tab',{name:'Создать',exact:true}).click();await page.locator('[data-new]').click();assert.equal(await page.locator('[data-number]').inputValue(),'3');assert.equal(await page.locator('[data-download]').isDisabled(),true);checks++;
  // A draft retry freezes the same body and does not create a second draft after an unknown ACK.
  await page.evaluate(()=>{const repo=window.certificateFixture.repository,save=repo.saveDraft;let first=true;window.draftRequests=[];repo.saveDraft=async(...args)=>{window.draftRequests.push(structuredClone(args));const result=await save(...args);if(first){first=false;throw new Error('draft reply lost')}return result}});
  await page.locator('[data-save-draft]').click();await page.locator('[data-error]').waitFor({state:'visible'});assert.equal(await page.locator('[data-date]').isDisabled(),true);assert.equal(await page.locator('[data-issue]').isDisabled(),true);checks++;
  await saved();assert.deepEqual(...await page.evaluate(()=>window.draftRequests));assert.equal(await page.locator('[data-date]').isDisabled(),false);checks++;
  await page.locator('[data-fresh-draft]').click();await page.locator('[data-sessions]').fill('3');await saved();assert.equal(await page.evaluate(()=>window.certificateFixture.getState().drafts.filter(d=>!d.issued_id).length),2);checks++;
  // Stale revision is a definite rejection: editable form survives and the newer draft stays intact.
  await page.evaluate(async()=>{const state=window.certificateFixture.getState(),d=state.drafts.filter(d=>!d.issued_id).at(-1);await window.certificateFixture.repository.saveDraft('00000000-0000-4000-8000-000000000004',d.id,{...d.body,form:{...d.body.form,sessions:'9'}},d.revision,crypto.randomUUID())});
  await page.locator('[data-sessions]').fill('4');await page.locator('[data-save-draft]').click();await page.locator('[data-error]').filter({hasText:'другом устройстве'}).waitFor();assert.equal(await page.locator('[data-sessions]').inputValue(),'4');assert.equal(await page.locator('[data-sessions]').isDisabled(),false);assert.equal(await page.evaluate(()=>window.certificateFixture.getState().drafts.at(-1).body.form.sessions),'9');checks++;
  await page.reload();await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.locator('[data-drafts] .certificate-row').first().getByRole('button',{name:'Продолжить'}).click();assert.equal(await page.locator('[data-sessions]').inputValue(),'9');checks++;
  // Revoked service does not silently become a different service on resume.
  await page.evaluate(async()=>{const repo=window.certificateFixture.repository,workspace=repo.workspace;repo.workspace=async(...args)=>({...await workspace(...args),services:[]});await window.certificateFixture.controller.reload()});
  await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.locator('[data-drafts] .certificate-row').first().getByRole('button',{name:'Продолжить'}).click();assert.equal(await page.locator('[data-service]').inputValue(),'00000000-0000-4000-8000-000000000007');assert.equal(await page.locator('[data-error]').isVisible(),true);checks++;
  // Delayed lazy body cannot restore a draft into another organization/session.
  await page.evaluate(()=>{const repo=window.certificateFixture.repository,get=repo.draft;repo.draft=(...args)=>new Promise(resolve=>{window.resolveDraft=async()=>resolve(await get(...args))})});
  await page.getByRole('tab',{name:'Черновики',exact:true}).click();await page.locator('[data-drafts] .certificate-row').first().getByRole('button',{name:'Продолжить'}).click();
  await page.evaluate(async()=>{await window.certificateFixture.controller.setOrganization(null);await window.resolveDraft()});assert.equal(await page.locator('#certificateDesignerPanel').isVisible(),false);checks++;
  const linked=await context.newPage();linked.on('pageerror',e=>errors.push(e.message));await linked.goto(url+'/fixture.html?automatic&store='+store+'-client');await linked.locator('[data-canvas]').waitFor({state:'visible'});
  await linked.locator('[data-sessions]').fill('3');await linked.getByText('Связать с клиентом (необязательно)',{exact:true}).click();await linked.locator('[data-client] option[value="79990000001"]').waitFor({state:'attached'});await linked.locator('[data-client]').selectOption('79990000001');await linked.locator('[data-benefit-wrapper]').waitFor({state:'visible'});await linked.locator('[data-benefit]').selectOption('00000000-0000-4000-8000-000000000023');
  await linked.locator('[data-save-draft]').click();await linked.locator('[data-message]').filter({hasText:'Черновик сохранён'}).waitFor();await linked.reload();await linked.getByRole('tab',{name:'Черновики',exact:true}).click();await linked.getByRole('button',{name:'Продолжить',exact:true}).click();
  assert.equal(await linked.locator('[data-sessions]').inputValue(),'3');assert.equal(await linked.locator('[data-client]').inputValue(),'79990000001');assert.equal(await linked.locator('[data-benefit]').inputValue(),'00000000-0000-4000-8000-000000000023');checks++;
  await linked.evaluate(()=>{window.certificateFixture.repository.clientOptions=async()=>{throw new Error('invalid_certificate_client')}});await linked.getByRole('tab',{name:'Черновики',exact:true}).click();await linked.getByRole('button',{name:'Продолжить',exact:true}).click();await linked.locator('[data-message]').filter({hasText:'Клиент недоступен'}).waitFor();
  assert.equal(await linked.locator('[data-client]').inputValue(),'');assert.equal(await linked.locator('[data-sessions]').inputValue(),'3');checks++;await linked.close();
  assert.deepEqual(errors,[]);checks++;
  writeFileSync(output+'/drafts-checks.json',JSON.stringify({checks,widths:[390,760,1440],environment:'isolated fixture',pageErrors:errors,actualUserTab:'not accessed',crossDevicePersistence:'server database proof; no physical device claim'},null,2));
  console.log(`Certificate autonumber/drafts browser checks: ${checks} PASS; isolated fixture, not live acceptance.`);
}catch(error){await page.screenshot({path:output+'/drafts-failure.png',fullPage:true});console.error(await page.locator('[data-error]').textContent());throw error;}
finally{await browser.close();server.close();}
