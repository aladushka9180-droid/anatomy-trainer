import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;

export const root = process.env.SALES_AUDIT_SOURCE || resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ids = {
  organization:'11111111-1111-4111-8111-111111111151',
  secondOrganization:'11111111-1111-4111-8111-111111111152',
  owner:'22222222-2222-4222-8222-222222222151',
  seller:'33333333-3333-4333-8333-333333333151',
  client:'44444444-4444-4444-8444-444444444151',
  secondClient:'44444444-4444-4444-8444-444444444152',
  booking:'55555555-5555-4555-8555-555555555151',
  item:'66666666-6666-4666-8666-666666666151',
  warehouse:'77777777-7777-4777-8777-777777777151',
  cash:'88888888-8888-4888-8888-888888888151',
  bank:'99999999-9999-4999-8999-999999999151',
  benefit:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa151'
};

export function workspace() {
  return {
    organization_id:ids.organization, finance_enabled:true, benefits_enabled:true, inventory_enabled:true,
    accounts:[
      {id:ids.cash,name:'Тестовая касса',account_type:'cash',system_key:null},
      {id:ids.bank,name:'Тестовый счёт',account_type:'bank',system_key:null},
      {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb151',name:'Расходы',account_type:'expense',system_key:'operating_expense'}
    ],
    sellers:[{id:ids.owner,name:'Тестовый владелец',role:'владелец'},{id:ids.seller,name:'Тестовый специалист',role:'специалист'}],
    clients:[{id:ids.client,name:'Вымышленный клиент А'},{id:ids.secondClient,name:'Вымышленный клиент Б'}],
    bookings:[{id:ids.booking,client_account_id:ids.client,client_name:'Вымышленный клиент А',performer_id:ids.seller,booking_date:'2026-10-15',booking_time:'15:00',service_name:'Тестовая услуга'}],
    benefit_products:[{id:ids.benefit,name:'Тестовый абонемент',kind:'visit_pass',sale_price_minor:450000}],
    inventory_items:[{id:ids.item,name:'Тестовое масло',sku:'TEST-OIL-151',unit:'ml'}],
    warehouses:[{id:ids.warehouse,name:'Тестовый склад'}],
    sales:[],recurring_expenses:[],audit:[]
  };
}

export async function launch() {
  return chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
}

export async function createFixture(browser, {width=390, data=workspace(), blockedStorage=false, boot=true, role='owner', writes=true, context:providedContext=null}={}) {
  const context = providedContext || await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page = await context.newPage();
  const rejected = [], errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  const html = readFileSync(resolve(root,'provider.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'};
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='https://sales.audit.test'||route.request().method()!=='GET'){
      rejected.push(url.href);return route.abort();
    }
    if(url.pathname.endsWith('/provider.html'))return route.fulfill({contentType:'text/html',body:html});
    const relative=decodeURIComponent(url.pathname.replace('/minuta-online-booking/',''));
    const file=resolve(root,relative);
    if(!file.startsWith(root)||relative.includes('..'))return route.abort();
    try{return route.fulfill({contentType:mime[extname(file)]||'application/octet-stream',body:readFileSync(file)});}
    catch{return route.abort();}
  });
  if(blockedStorage)await page.addInitScript(()=>{
    for(const key of ['getItem','setItem','removeItem'])
      Object.defineProperty(Storage.prototype,key,{value(){throw new DOMException('Audit: storage denied','SecurityError');},configurable:true});
  });
  await page.goto('https://sales.audit.test/minuta-online-booking/provider.html',{waitUntil:'networkidle'});
  await page.evaluate(()=>{
    document.documentElement.classList.remove('provider-booting');
    document.documentElement.classList.add('top-level');
    document.querySelector('#providerBoot')?.remove();
    document.body.dataset.providerTheme='neutral';
    document.body.dataset.providerLayout='classic';
    document.querySelector('#authCard').hidden=true;
    document.querySelector('#dashboard').hidden=false;
    document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='organization';});
    document.querySelector('#organizationWorkspace').hidden=false;
    document.querySelector('#organizationLoading').hidden=true;
    document.querySelectorAll('.organization-section').forEach(panel=>{panel.hidden=panel.id!=='commercePanel';});
    document.querySelector('#commercePanel').hidden=false;
  });
  await page.addScriptTag({url:'https://sales.audit.test/minuta-online-booking/commerce-management.js'});
  await page.addScriptTag({url:'https://sales.audit.test/minuta-online-booking/commerce-soft-ui.js'});
  await page.evaluate(({ids,data,role,writes})=>{
    const $=selector=>document.querySelector(selector);
    window.auditData=data;
    window.auditIds=ids;
    window.auditCalls=[];
    window.auditNotices=[];
    window.auditPendingReads={};
    window.auditRequests=new Map();
    window.auditDropReplies=0;
    window.auditHoldSaleReply=false;
    window.auditReleaseSaleReply=null;
    window.auditHoldReads=false;
    window.auditFailRefresh=false;
    window.auditSessionGeneration=1;
    const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const db={rpc:async(name,args)=>{
      auditCalls.push({name,args:structuredClone(args)});
      if(name==='get_minuta_commerce_workspace_v151'){
        if(auditHoldReads)return new Promise(resolve=>{auditPendingReads[args.p_organization]=resolve;});
        if(auditFailRefresh){auditFailRefresh=false;return {data:null,error:{message:'temporary refresh error'}};}
        return {data:structuredClone(auditData),error:null};
      }
      if(name==='sell_minuta_commercial_product_v151'){
        const key=args.p_organization+':'+args.p_request_id;
        let sale=auditRequests.get(key);
        const replayed=Boolean(sale);
        if(!sale){
          const quantityMilli=Math.round(args.p_quantity*1000);
          const subtotal=Number((2n*BigInt(quantityMilli)*BigInt(args.p_unit_price_minor)+1000n)/2000n);
          sale={id:crypto.randomUUID(),organization_id:args.p_organization,status:'paid',
            booking_id:args.p_booking,client_account_id:args.p_client_account,client_name:args.p_client_account?'Вымышленный клиент А':null,
            seller_id:args.p_seller,seller_name:'Тестовый продавец',payment_method:args.p_payment_method,
            total_minor:subtotal-args.p_discount_minor,refunded_minor:0,occurred_at:'2026-10-15T10:00:00Z',
            line:{item_name:'Тестовая позиция',item_kind:args.p_item_kind,quantity:args.p_quantity,refunded_quantity:0,unit_price_minor:args.p_unit_price_minor}};
          auditRequests.set(key,sale);auditData.sales.unshift(sale);
        }
        if(auditDropReplies>0){auditDropReplies--;return {data:null,error:{message:'TypeError: Failed to fetch'}};}
        if(auditHoldSaleReply)await new Promise(resolve=>{window.auditReleaseSaleReply=resolve;});
        return {data:{...sale,replayed},error:null};
      }
      if(name==='refund_minuta_commercial_sale_v147'){
        const sale=auditData.sales.find(s=>s.id===args.p_sale);
        const key='refund:'+args.p_request_id;
        if(auditRequests.has(key))return {data:{replayed:true},error:null};
        sale.refunded_minor+=args.p_amount_minor;
        sale.line.refunded_quantity+=args.p_quantity;
        sale.status=sale.refunded_minor===sale.total_minor?'refunded':'partially_refunded';
        auditRequests.set(key,{});
        return {data:{id:crypto.randomUUID(),sale_id:sale.id,replayed:false},error:null};
      }
      if(name==='issue_client_identity_sale_claim_v155')return {data:null,error:{message:'Audit: claim unavailable'}};
      return {data:null,error:{message:'Audit unexpected rpc '+name}};
    }};
    window.auditController=MinutaCommerce.createController({
      db,$,escapeHtml,notify:value=>auditNotices.push(value),
      requireWrites:()=>writes,getCurrentUser:()=>({id:ids.owner}),
      getSessionGeneration:()=>auditSessionGeneration,
      sessionIsCurrent:(user,generation)=>generation===auditSessionGeneration,
      applyWriteAvailability:()=>{}
    });
    auditController.bind();
    window.auditOrganization={id:ids.organization,current_role:role};
  },{ids,data,role,writes});
  if(boot)await page.evaluate(()=>auditController.setOrganization(auditOrganization));
  return {context,page,rejected,errors};
}

export async function fillSale(page,{quantity='3',price='499.99',discount='100',client='',kind='inventory_item'}={}) {
  await page.evaluate(({quantity,price,discount,client,kind})=>{
    auditController.startSale({clientId:client});
    const $=s=>document.querySelector(s);
    $('#commerceItemKind').value=kind;
    $('#commerceItemKind').dispatchEvent(new Event('change',{bubbles:true}));
    if(kind!=='benefit_product')$('#commerceQuantity').value=quantity;
    $('#commerceUnitPrice').value=price;
    $('#commerceDiscount').value=discount;
    $('#commerceSaleForm').dispatchEvent(new Event('input',{bubbles:true}));
  },{quantity,price,discount,client,kind});
}

export async function submitSale(page,{expectError=false}={}) {
  await page.evaluate(()=>document.querySelector('#commerceSaleForm').requestSubmit());
  await page.waitForFunction(error=>error
    ?!document.querySelector('#commerceSaleError').hidden
    :!document.querySelector('#commerceSaleCreator').open,expectError,{timeout:5000});
}
