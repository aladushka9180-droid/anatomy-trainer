const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const clientRecordsSource = fs.readFileSync(path.join(root, 'client-records.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(root, 'supabase-migration-v112.sql'), 'utf8');
const serviceWorkerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

async function harness(browser, gates = {}) {
  const page = await browser.newPage({viewport:{width:390,height:1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost/crm-client-record-isolation', route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
  await page.goto('http://localhost/crm-client-record-isolation');
  await page.setContent('<!doctype html><html><body><div id="clientRecords"></div><details><div id="clientHistory"></div></details></body></html>');
  await page.addScriptTag({content:clientRecordsSource});
  await page.evaluate(gates => {
    const deferred = active => {
      let release;
      const promise = active ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
      return {promise,release:release || (()=>{})};
    };
    const file = (id, name, path) => ({id,kind:'file',file_name:name,byte_size:9000,mime_type:'application/pdf',object_path:path,created_at:'2026-09-05T11:00:00+04:00',can_delete:true});
    window.confirm = () => true;
    window.crmIsolation = {
      context:{userId:'user-a',sessionGeneration:1},
      calls:[],storageCalls:[],createdUrls:[],revokedUrls:[],clickedDownloads:[],serverRows:new Map(),serverObjects:new Set(),
      gates:{download:deferred(gates.download),upload:deferred(gates.upload),complete:deferred(gates.complete),archive:deferred(gates.archive)},
      records:{
        '79999999991':[file('file-a','Только-клиент-A.pdf','org-a/file-a.pdf')],
        '79999999992':[file('file-b','Только-клиент-B.pdf','org-b/file-b.pdf')]
      }
    };
    URL.createObjectURL = blob => { crmIsolation.createdUrls.push(blob.size); return `blob:private-${crmIsolation.createdUrls.length}`; };
    URL.revokeObjectURL = url => { crmIsolation.revokedUrls.push(url); };
    HTMLAnchorElement.prototype.click = function () { crmIsolation.clickedDownloads.push({href:this.href,download:this.download}); };
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => nativeSetTimeout(callback, delay === 30000 ? 0 : delay, ...args);
    window.db = {
      rpc:async(name, parameters) => {
        crmIsolation.calls.push({name,parameters});
        if(name === 'get_minuta_client_records') return {data:{enabled:true,can_enable:true,entries:crmIsolation.records[parameters.p_phone] || []}};
        if(name === 'create_minuta_client_record') {
          const path = `${parameters.p_organization}/${parameters.p_id}.pdf`;
          crmIsolation.serverRows.set(parameters.p_id,{ready:false,path,phone:parameters.p_phone,organization:parameters.p_organization});
          return {data:{id:parameters.p_id,object_path:path,ready:false}};
        }
        if(name === 'complete_minuta_client_file') {
          await crmIsolation.gates.complete.promise;
          const row = crmIsolation.serverRows.get(parameters.p_id);
          if(row) row.ready = true;
          return {data:{id:parameters.p_id,ready:true}};
        }
        if(name === 'archive_minuta_client_record') {
          await crmIsolation.gates.archive.promise;
          return {data:{id:parameters.p_id,archived:true}};
        }
        return {data:null};
      },
      storage:{from:bucket => ({
        download:async objectPath => {
          crmIsolation.storageCalls.push({operation:'download',bucket,objectPath});
          await crmIsolation.gates.download.promise;
          return {data:new Blob(['private-file'])};
        },
        upload:async(objectPath,blob,options) => {
          crmIsolation.storageCalls.push({operation:'upload',bucket,objectPath,options,size:blob.size});
          await crmIsolation.gates.upload.promise;
          crmIsolation.serverObjects.add(objectPath);
          return {data:{path:objectPath}};
        }
      })}
    };
    window.clientRecords = MinutaClientRecords.createController({db,getContext:()=>crmIsolation.context,requireWrites:()=>true});
    clientRecords.bind();clientRecords.setOrganization({id:'org-a'});
  }, gates);
  return {page,errors};
}

async function openClient(page, phone) {
  await page.evaluate(phone => clientRecords.setClient({phone,bookings:[]}), phone);
  await page.waitForFunction(phone => document.querySelector('#clientRecords')?.textContent.includes(phone.endsWith('1') ? 'Только-клиент-A.pdf' : 'Только-клиент-B.pdf'), phone);
  await page.locator('[data-cr-panel="files"]>summary').click();
}

async function switchScope(page, kind) {
  await page.evaluate(kind => {
    if(kind === 'client') clientRecords.setClient({phone:'79999999992',bookings:[]});
    if(kind === 'organization') { clientRecords.setOrganization({id:'org-b'}); clientRecords.setClient({phone:'79999999992',bookings:[]}); }
    if(kind === 'session') {
      crmIsolation.context={userId:'user-b',sessionGeneration:crmIsolation.context.sessionGeneration+1};
      clientRecords.reset();clientRecords.setOrganization({id:'org-b'});clientRecords.setClient({phone:'79999999992',bookings:[]});
    }
  }, kind);
  await page.waitForFunction(() => document.querySelector('#clientRecords')?.textContent.includes('Только-клиент-B.pdf'));
}

async function staleDownload(browser, kind) {
  const {page,errors}=await harness(browser,{download:true});
  try {
    await openClient(page,'79999999991');
    await page.locator('[data-cr-download="file-a"]').first().click();
    await page.waitForFunction(() => crmIsolation.storageCalls.some(call => call.operation === 'download'));
    await switchScope(page,kind);
    await page.evaluate(() => crmIsolation.gates.download.release());
    await page.waitForTimeout(30);
    const state=await page.evaluate(()=>({createdUrls:crmIsolation.createdUrls.length,clicked:crmIsolation.clickedDownloads.length,text:document.querySelector('#clientRecords').textContent,busy:document.querySelector('#clientRecords').getAttribute('aria-busy')}));
    assert.equal(state.createdUrls,0,`${kind}: stale download must not create an object URL`);
    assert.equal(state.clicked,0,`${kind}: stale download must not click a detached link`);
    assert.match(state.text,/Только-клиент-B\.pdf/);
    assert.doesNotMatch(state.text,/Только-клиент-A\.pdf/);
    assert.equal(state.busy,'false');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}

async function successfulDownload(browser) {
  const {page,errors}=await harness(browser);
  try {
    await openClient(page,'79999999991');
    await page.locator('[data-cr-download="file-a"]').first().click();
    await page.waitForFunction(() => crmIsolation.revokedUrls.length === 1);
    const state=await page.evaluate(()=>({createdUrls:crmIsolation.createdUrls,revokedUrls:crmIsolation.revokedUrls,clicked:crmIsolation.clickedDownloads,blobLinks:[...document.querySelectorAll('a[href^="blob:"]')].length,local:Object.keys(localStorage),session:Object.keys(sessionStorage),storageCalls:crmIsolation.storageCalls}));
    assert.equal(state.createdUrls.length,1);
    assert.deepEqual(state.revokedUrls,['blob:private-1']);
    assert.deepEqual(state.clicked,[{href:'blob:private-1',download:'Только-клиент-A.pdf'}]);
    assert.equal(state.blobLinks,0,'temporary download link must be removed');
    assert.deepEqual(state.local,[]);assert.deepEqual(state.session,[]);
    assert.deepEqual(state.storageCalls,[{operation:'download',bucket:'minuta-client-records',objectPath:'org-a/file-a.pdf'}]);
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}

async function staleUploadBeforeFinalize(browser) {
  const {page,errors}=await harness(browser,{upload:true});
  try {
    await openClient(page,'79999999991');
    await page.locator('[name="file"]').setInputFiles({name:'Диагноз-клиента.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nprivate')});
    await page.locator('[data-cr-upload] button').click();
    await page.waitForFunction(() => crmIsolation.storageCalls.some(call => call.operation === 'upload'));
    await switchScope(page,'client');
    await page.evaluate(() => crmIsolation.gates.upload.release());
    await page.waitForTimeout(30);
    const state=await page.evaluate(()=>({calls:crmIsolation.calls,storageCalls:crmIsolation.storageCalls,rows:[...crmIsolation.serverRows.values()],objects:[...crmIsolation.serverObjects],text:document.querySelector('#clientRecords').textContent,busy:document.querySelector('#clientRecords').getAttribute('aria-busy')}));
    assert.equal(state.calls.filter(call=>call.name==='complete_minuta_client_file').length,0,'stale upload must not finalize under the new client');
    assert.equal(state.storageCalls[0].options.cacheControl,'0');
    assert.equal(state.storageCalls[0].options.upsert,false);
    assert.doesNotMatch(state.storageCalls[0].objectPath,/79999999991|Диагноз-клиента/,'Storage path must stay opaque');
    assert.equal(state.rows[0].ready,false);
    assert.equal(state.objects.length,1,'the mock reproduces an uploaded object left before finalize');
    assert.match(state.text,/Только-клиент-B\.pdf/);assert.equal(state.busy,'false');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}

async function staleFinalize(browser) {
  const {page,errors}=await harness(browser,{complete:true});
  try {
    await openClient(page,'79999999991');
    await page.locator('[name="file"]').setInputFiles({name:'Акт.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nprivate')});
    await page.locator('[data-cr-upload] button').click();
    await page.waitForFunction(() => crmIsolation.calls.some(call => call.name === 'complete_minuta_client_file'));
    await switchScope(page,'organization');
    await page.evaluate(() => crmIsolation.gates.complete.release());
    await page.waitForTimeout(30);
    const state=await page.evaluate(()=>({text:document.querySelector('#clientRecords').textContent,busy:document.querySelector('#clientRecords').getAttribute('aria-busy'),getCalls:crmIsolation.calls.filter(call=>call.name==='get_minuta_client_records').map(call=>call.parameters)}));
    assert.match(state.text,/Только-клиент-B\.pdf/);assert.doesNotMatch(state.text,/Только-клиент-A\.pdf/);assert.equal(state.busy,'false');
    assert.equal(state.getCalls.at(-1).p_organization,'org-b');assert.equal(state.getCalls.at(-1).p_phone,'79999999992');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}

async function staleArchive(browser) {
  const {page,errors}=await harness(browser,{archive:true});
  try {
    await openClient(page,'79999999991');
    await page.locator('[data-cr-archive="file-a"]').first().click();
    await page.waitForFunction(() => crmIsolation.calls.some(call => call.name === 'archive_minuta_client_record'));
    await switchScope(page,'session');
    await page.evaluate(() => crmIsolation.gates.archive.release());
    await page.waitForTimeout(30);
    const state=await page.evaluate(()=>({text:document.querySelector('#clientRecords').textContent,busy:document.querySelector('#clientRecords').getAttribute('aria-busy'),createdUrls:crmIsolation.createdUrls.length}));
    assert.match(state.text,/Только-клиент-B\.pdf/);assert.doesNotMatch(state.text,/Только-клиент-A\.pdf/);assert.equal(state.busy,'false');assert.equal(state.createdUrls,0);
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.MINUTA_BROWSER_CHANNEL?{channel:process.env.MINUTA_BROWSER_CHANNEL}:{})});
  try {
    for(const kind of ['client','organization','session']) await staleDownload(browser,kind);
    await successfulDownload(browser);
    await staleUploadBeforeFinalize(browser);
    await staleFinalize(browser);
    await staleArchive(browser);
    assert.doesNotMatch(clientRecordsSource,/localStorage|sessionStorage|indexedDB|caches\.|createSignedUrl|getPublicUrl/i,'private records must not use persistent browser storage or public/signed URLs');
    assert.match(serviceWorkerSource,/requestUrl\.origin\s*===\s*self\.location\.origin[\s\S]{0,120}if\s*\(!isOwnAsset\)\s*return/,'service worker must ignore cross-origin Storage downloads');
    const hasCleanup=/\bdelete\s+from\s+public\.client_record_entries/i.test(migrationSource)
      || /(?:cleanup|purge|expire)[a-z0-9_]*client_record/i.test(migrationSource);
    assert.equal(hasCleanup,true,'v112 has no cleanup/expiry for unready rows and uploaded objects abandoned by a stale upload');
    console.log('Client record isolation: stale download/upload/finalize/archive and object URL cleanup passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
