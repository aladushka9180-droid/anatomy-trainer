import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureHtml} from './statistics-clarity-fixture-server.mjs';
import {candidateProvider} from './statistics-clarity-provider-patch.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const org='11111111-1111-4111-8111-111111111111',master='33333333-3333-4333-8333-333333333333',rent='22222222-2222-4222-8222-222222222222';
const cash=amount=>({side:amount<0?'credit':'debit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}});
const operation=(id,date,type,amount,source_id=id)=>({id,organization_id:org,occurred_at:date,operation_type:type,source_id,financial_postings:[cash(amount)]});
export const rows={
  financial_transactions:[
    operation('advance','2026-09-30T10:00:00Z','visit_service',300000,'partial'),
    operation('rent','2026-10-01T09:00:00Z','supplier_expense_payment',-1800000,'rent-source'),
    operation('partial','2026-10-02T10:00:00Z','visit_service',200000,'partial'),
    operation('goods','2026-10-02T12:00:00Z','commercial_sale',200000,'goods-sale'),
    operation('refund','2026-10-03T10:00:00Z','commercial_refund',-50000,'goods-refund')
  ],
  financial_manual_expenses_v163:[{id:'rent-source',expense_source_id:'rent-source',category_id:rent,category_name_snapshot:'Аренда',performer_id:null}],
  commercial_sales:[{id:'goods-sale',seller_id:master,occurred_at:'2026-10-02T12:00:00Z',commercial_sale_lines:[{item_kind:'inventory_item',item_name:'Крем',quantity:2,total_minor:200000}]}],
  commercial_sale_refunds:[{id:'goods-refund',sale_id:'goods-sale'}],
  bookings:[{id:'partial',performer_id:master,booking_date:'2026-10-02'}],
  financial_debt_settlement_sources:[],financial_payroll_payment_sources:[]
};
for(const table of Object.values(rows))for(const row of table)row.organization_id=org;
function summary(args,mode){
  const current=mode==='empty'?[]:rows.financial_transactions.filter(row=>row.occurred_at.slice(0,10)>=args.p_start&&row.occurred_at.slice(0,10)<=args.p_end
    &&(!args.p_performer||row.operation_type!=='supplier_expense_payment'));
  const amount=row=>row.financial_postings.reduce((sum,p)=>sum+(p.side==='credit'?-1:1)*p.amount_minor,0);
  const expense=current.filter(row=>row.operation_type==='supplier_expense_payment').reduce((sum,row)=>sum-amount(row),0);
  return {schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:org,currency:'RUB',timezone:'Europe/Samara',finance_enabled:true,
    period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:args.p_performer,
    summary:{received_minor:current.filter(row=>row.operation_type!=='supplier_expense_payment').reduce((sum,row)=>sum+amount(row),0),expense_minor:expense,services_minor:0,debt_minor:0},
    confidence:{completed_visits:1,payment_marked_visits:1,unposted_payment_visits:1,service_value_known_visits:1,is_complete:false,result_reliable:false},
    categories:[{id:rent,system_key:'rent',name:'Аренда',active:true}],performers:[{id:master,name:'Сотрудник'}],accounts:[],
    expense_structure:expense?[{category_id:rent,name:'Аренда',amount_minor:expense}]:[],series:[],operations:[]};
}
const csp="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; worker-src 'none'; object-src 'none'; form-action 'none'";
export async function serveHttpFixture(port=0){
  const requests=[];
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
    const log={method:req.method,path,status:0};requests.push(log);
    const send=(status,type,body)=>{log.status=status;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}).end(body);};
    if(req.method!=='GET')return send(405,'application/json','{"error":"writes_forbidden"}');
    if(req.headers.authorization)return send(403,'application/json','{"error":"authentication_forbidden"}');
    if(path==='/qa/rpc'){
      const mode=url.searchParams.get('mode');
      if(mode==='unavailable'||mode==='rpc503')return send(503,'application/json','{"error":{"code":"fixture_http_503"}}');
      let args;try{args=JSON.parse(url.searchParams.get('args')||'{}');}catch{return send(400,'application/json','{}');}
      if(args.p_organization!==org||! /^\d{4}-\d{2}-\d{2}$/.test(args.p_start)||! /^\d{4}-\d{2}-\d{2}$/.test(args.p_end)||args.p_start>args.p_end)
        return send(400,'application/json','{"error":"invalid_scope"}');
      return send(200,'application/json',JSON.stringify({error:null,data:summary(args,mode)}));
    }
    if(path==='/qa/table'){
      const table=url.searchParams.get('table'),mode=url.searchParams.get('mode');
      if(!Object.hasOwn(rows,table))return send(400,'application/json','{"error":"unknown_table"}');
      if(mode==='partial'&&table==='financial_transactions')return send(503,'application/json','{"error":{"code":"fixture_ledger_http_503"}}');
      return send(200,'application/json',JSON.stringify({error:null,data:mode==='empty'?[]:rows[table]}));
    }
    const relative=decodeURIComponent(path.replace(/^\/minuta-online-booking\//,''));
    const target=resolve(root,relative);
    if(!target.startsWith(root+sep))return send(403,'text/plain','forbidden');
    if(relative==='provider.html'){
      let html=fixtureHtml().replace('connect-src \'none\'','connect-src \'self\'')
        .replace('<strong>Изолированная проверка · тестовые данные</strong>','<strong>Проверка окончательного кода · только тестовые данные</strong>')
        .replace('Мои данные','Тестовые данные').replace('Ваши реальные записи и оплаты','Контрольная выборка · без рабочих записей')
        .replace('<option value="audit">Как в аудите</option><option value="dashboard">Выбранный макет — условные данные</option>','')
        .replace('<option value="scenario">Предоплата, доплата, возврат, аренда, товары</option>','<option value="scenario">Поступления и отдельный день возврата</option>')
        .replace('<option value="partial">Известные суммы, журнал недоступен</option>','<option value="partial">HTTP 503 журнала, суммы известны</option>')
        .replace('<p id="fixtureJournalResult" hidden>','<p><button type="button" id="qaFailSummary">Отказ сводки HTTP 503</button> <button type="button" id="qaRestore">Восстановить источник</button></p><label>Текст <select id="qaTextScale"><option value="100">100%</option><option value="200">200%</option></select></label><p id="qaSource" role="status">Изолированный HTTP-источник · GET · без авторизации и записи</p><p id="qaResult"></p><p id="fixtureJournalResult" hidden>')
        .replace('<script src="tests/statistics-clarity-fixture.js">','<script src="tests/statistics-http-fixture-client.js"></script><script src="tests/statistics-clarity-fixture.js">');
      return send(200,'text/html; charset=utf-8',html);
    }
    if(relative==='tests/statistics-clarity-fixture.js'){
      const source=readFileSync(target,'utf8').replace("let fixtureMode='audit';","let fixtureMode='scenario';")
        .replace("reportPeriod='last30'","reportPeriod='month'").replace("const db={","const db=window.MinutaStatisticsHttpFixture.db||{")
        .replace("return '2026-10-02';","return '2026-10-03';").replace("custom:'2026-08-01'","custom:'2024-01-01'")
        .replace("end:'2026-10-02',period:reportPeriod","end:'2026-10-03',period:reportPeriod");
      return send(200,'text/javascript; charset=utf-8',source);
    }
    if(relative==='tests/statistics-clarity-provider-functions.js'){
      const source=candidateProvider(readFileSync(resolve(root,'provider.js'),'utf8'));
      return send(200,'text/javascript; charset=utf-8',source.slice(source.indexOf('function reportPerformerName()'),source.indexOf('\nasync function loadReportAvailability(')));
    }
    if(!['.css','.js','.svg','.png','.webp','.woff2'].includes(extname(target)))return send(403,'text/plain','forbidden');
    try{return send(200,({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'})[extname(target)],readFileSync(target));}
    catch{return send(404,'text/plain','not found');}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  return {server,requests,url:'http://127.0.0.1:'+server.address().port+'/minuta-online-booking/provider.html'};
}
if(process.argv.includes('--serve')){const result=await serveHttpFixture(Number(process.env.MINUTA_HTTP_FIXTURE_PORT)||4321);console.log(result.url);}
