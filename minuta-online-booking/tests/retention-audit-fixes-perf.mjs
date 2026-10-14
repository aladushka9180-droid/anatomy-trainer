import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildRetentionFixture} from './retention-delta-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
let html=buildRetentionFixture().replace('</style>',read('retention-mobile-ui.css')+'</style>');
html=html.replace('</body>','<script>'+read('retention-mobile-ui.js').replace(/<\/script/gi,'<\\/script')+'</script></body>');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})}),results=[],outbound=[];
async function bounded(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label+' exceeded '+ms+' ms')),ms))]);}finally{clearTimeout(timer);}}
try{
 for(const count of [100,1000,10000]){
  const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  await page.route('**/*',r=>{if(r.request().url()==='https://retention-perf.synthetic.test/')return r.fulfill({contentType:'text/html',body:html});outbound.push(r.request().url());return r.abort();});
  await page.goto('https://retention-perf.synthetic.test/');await page.evaluate(()=>retentionReady);
  const data={clients:count,iterations:0,samplesMs:[]};results.push(data);
  try{
   await bounded(page.evaluate(async count=>{const f=retentionFixture;f.deliveries=[];f.clients=Array.from({length:count},(_,i)=>({client_account_id:'bulk-'+i,client_name:'Вымышленный клиент '+i,client_phone:'+79990000000',last_visit_on:'2026-01-01',completed_visits:5,consent_status:'granted',eligible:true}));await retentionController.load();await new Promise(requestAnimationFrame);},count),20000,'initial render');
   for(let i=0;i<20;i++){
    const sample=await bounded(page.evaluate(async()=>{const start=performance.now();await retentionController.load();await new Promise(requestAnimationFrame);document.querySelector('#retentionClientsList').getBoundingClientRect();return performance.now()-start;}),15000,'render sample');
    data.samplesMs.push(+sample.toFixed(2));data.iterations++;
    if(sample>1500&&data.iterations>=3){data.sampleLimit='three slow samples; bounded resource use';break;}
   }
   const sorted=[...data.samplesMs].sort((a,b)=>a-b);data.medianMs=sorted[Math.floor(sorted.length/2)];data.p95Ms=sorted.length===20?sorted[18]:null;
   Object.assign(data,await bounded(page.evaluate(async()=>{const start=performance.now();document.querySelector('[data-retention-select-all]').click();await new Promise(requestAnimationFrame);document.querySelector('#retentionClientsList').getBoundingClientRect();return{selectAllMs:+(performance.now()-start).toFixed(2),visibleSelected:document.querySelectorAll('[data-retention-select]:checked').length,selectedTotal:Number(document.querySelector('.retention-selected-count').textContent.match(/\d+/)?.[0]),domElements:document.querySelectorAll('*').length};}),15000,'select all'));
   if(data.selectedTotal!==count||data.visibleSelected!==50)throw new Error('Pagination lost global selection');
  }catch(error){data.incomplete=error.message;}
  finally{console.log(JSON.stringify(data));await page.close();}
 }
}finally{await browser.close();}
const result={environment:'Isolated real controller/CSS/mobile helper with synthetic data and blocked network; same cohort and frame/layout timing as prior audit; no production latency claim',upperMedian:true,results,outboundRequests:outbound};
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));if(outbound.length||results.some(x=>x.incomplete))process.exitCode=1;
