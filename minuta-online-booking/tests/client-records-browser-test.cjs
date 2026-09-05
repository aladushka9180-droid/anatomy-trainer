const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const root = path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.MINUTA_BROWSER_CHANNEL?{channel:process.env.MINUTA_BROWSER_CHANNEL}:{})});
  try {
    const page=await browser.newPage({viewport:{width:390,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.abort());
    await page.route('http://localhost/client-records-test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
    await page.goto('http://localhost/client-records-test');
    await page.setContent('<body class="provider-body" data-provider-theme="sage" data-provider-layout="bento"><main style="max-width:700px;margin:auto;padding:16px;background:var(--theme-surface)"><div id="clientRecords"></div><details><div id="clientHistory"></div></details></main></body>');
    const styles=[...fs.readFileSync(path.join(root,'provider.html'),'utf8').matchAll(/<link\s+rel="stylesheet"\s+href="([^"?]+)/g)].map(m=>m[1]);
    for(const name of styles)await page.addStyleTag({content:fs.readFileSync(path.join(root,name),'utf8')});
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'client-records.js'),'utf8')});
    await page.evaluate(()=>{
      window.ctx={userId:'user1',sessionGeneration:1};window.calls=[];window.data=[];window.serverEnabled=true;
      window.db={rpc:async(name,p)=>{
        calls.push({name,p});
        if(name==='get_minuta_client_records'){
          if(p.p_phone==='79999999992')await new Promise(r=>setTimeout(r,150));
          return {data:{enabled:serverEnabled,can_enable:true,entries:data.slice(p.p_offset,p.p_offset+31)}};
        }
        if(name==='create_minuta_client_record'){
          if(!data.some(e=>e.id===p.p_id))data.unshift({id:p.p_id,kind:p.p_kind,body:p.p_body,file_name:p.p_file_name||'',
            byte_size:p.p_byte_size,mime_type:p.p_mime_type,object_path:'org/'+p.p_id,created_at:new Date().toISOString(),can_delete:true});
          if(window.failNote){window.failNote=false;return {error:{message:'lost response'}};}
          return {data:{id:p.p_id,object_path:'org/'+p.p_id,ready:false}};
        }
        if(name==='set_minuta_client_records_enabled'){serverEnabled=p.p_enabled;return {data:null};}
        return {data:null};
      },storage:{from:()=>({upload:async()=>({data:{}}),download:async()=>({data:new Blob(['file'])})})}};
      window.client={phone:'79999999991',bookings:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',at:'2026-09-05T10:00:00+04:00',title:'Массаж спины',status:'Завершён',payment:'Получено 3 000 ₽'}]};
      window.controller=MinutaClientRecords.createController({db,getContext:()=>ctx,requireWrites:()=>true});
      controller.bind();controller.setOrganization({id:'org1'});controller.setClient(client);
    });
    await page.locator('[data-cr-panel="history"]>summary').click();
    await page.locator('[data-cr-panel="note"]>summary').click();
    await page.locator('[name="note"]').fill('Клиент предпочитает спокойную музыку. <script>window.leak=true</script>');
    await page.evaluate(()=>{window.failNote=true;});
    await page.locator('[data-cr-note] button').click();
    await page.waitForFunction(()=>document.querySelector('.cr-status').textContent.includes('Не удалось'));
    await page.locator('[data-cr-note] button').click();
    await page.waitForFunction(()=>document.querySelector('.cr-timeline').textContent.includes('спокойную музыку'));
    const saved=await page.evaluate(()=>calls.filter(c=>c.name==='create_minuta_client_record'));
    assert.equal(saved[0].p.p_id,saved[1].p.p_id,'retry must reuse UUID');
    assert.equal(await page.evaluate(()=>window.leak),undefined,'notes must be escaped');
    await page.locator('[data-cr-panel="files"]>summary').click();
    await page.locator('[name="file"]').setInputFiles({name:'Памятка.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntest')});
    await page.evaluate(()=>controller.setClient(client));
    assert.equal(await page.locator('[name="file"]').evaluate(el=>el.files.length),1,'refresh preserves selected file');
    await page.locator('[data-cr-upload] button').click();
    await page.waitForFunction(()=>document.querySelector('.cr-files').textContent.includes('Памятка.pdf'));
    assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='complete_minuta_client_file').length),1);
    await page.evaluate(()=>{data[0].file_name='Очень_длинное_название_файла_без_пробелов_'.repeat(5)+'.pdf';controller.setClient(client);});
    const failures=[];
    for(const width of [320,390,760,1440]) {
      await page.setViewportSize({width,height:1100});
      for(const theme of ['sage','graphite','luxury']) {
        await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;},theme);
        const violations=await page.evaluate(()=>{
          const result=[];
          for(const el of document.querySelectorAll('#clientRecords button,#clientRecords input,#clientRecords select,#clientRecords textarea,#clientRecords strong')){
            if(!el.getClientRects().length)continue;const r=el.getBoundingClientRect();
            if(r.left<0 || r.right>innerWidth+1)result.push('overflow '+el.tagName);
            if(el.tagName==='BUTTON' && r.height<44)result.push('small button');
          }
          return result;
        });failures.push(...violations.map(v=>`${width}/${theme}: ${v}`));
      }
    }
    assert.deepEqual(failures,[]);
    await page.setViewportSize({width:390,height:1100});
    await page.evaluate(()=>{document.body.dataset.providerTheme='sage';});
    const preview=path.join(os.tmpdir(),'minuta-client-records-preview.png');
    await page.screenshot({path:preview,fullPage:true});
    // Delayed reads cannot repopulate a signed-out user's DOM.
    await page.evaluate(()=>{controller.setClient({...client,phone:'79999999992'});ctx.sessionGeneration++;controller.reset();});
    await page.waitForTimeout(180);
    assert.equal(await page.locator('#clientRecords').innerText(),'');
    assert.deepEqual(errors,[]);
    console.log('Client records: note retry, XSS escaping, file draft/upload, session isolation and 12 responsive/theme cases passed. Preview: '+preview);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
