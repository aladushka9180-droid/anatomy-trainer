'use strict';
// Synthetic, read-only browser fixture. No authentication, RPC writes or PWA.
let sessionGeneration=1, currentUser={id:'fixture-owner'}, reportDataSource='own', reportPeriod='last30';
let reportPerformerFilter='all', reportCanViewTeam=true, importedBookingHistory=[], allBookings=[];
let fixtureMode='audit';
const fixtureOrg='11111111-1111-4111-8111-111111111111', fixtureMaster='33333333-3333-4333-8333-333333333333';
let reportScopedBookingsState={status:'ready',rows:[],key:''};
let reportTeamAnalyticsState={status:'ready',canViewTeam:true,rows:[{performer_id:fixtureMaster,performer_name:'Сотрудник'}]};
const $=selector=>document.querySelector(selector);
function escapeHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
function previousReportRange(){return null;}
function reportForecastEnd(range){return range.end;}
function loadReportScopedBookings(){}
function loadReportAvailability(){}
const fixtureVisit=(id,date,value,method='cash',paid=value)=>({
  id,organization_id:fixtureOrg,performer_id:fixtureMaster,booking_date:date,booking_time:'10:00',
  status:'confirmed',services:{name:'Услуга',price_rub:value,duration_minutes:60},value,
  booking_outcomes:{visit_status:'completed',payment_method:method,amount_rub:paid}
});
const fixtureVisits=[
  ...Array.from({length:34},(_,i)=>fixtureVisit('visit-'+i,'2026-09-'+String(4+i%27).padStart(2,'0'),i===33?5400:3200)),
  fixtureVisit('october','2026-10-02',5800,'card'),
  {...fixtureVisit('imported','2026-09-03',3000,'imported',0),is_imported_history:true}
];
function reportTodayIso(){return '2026-10-02';}
function reportRange(){
  const starts={week:'2026-09-26',last30:'2026-09-03',quarter:'2026-07-05',month:'2026-10-01',year:'2026-01-01',all:'2026-08-04',custom:'2026-08-01'};
  return {start:starts[reportPeriod],end:'2026-10-02',period:reportPeriod};
}
function reportSessionKey(org,...parts){return [sessionGeneration,currentUser.id,org,...parts].join(':');}
function reportUsesScopedBookings(){return true;}
function reportOrganizationId(){return fixtureOrg;}
function reportOrganization(){return {id:fixtureOrg,name:'Тестовый кабинет',current_role:'owner',locations:[]};}
function reportPerformerName(){return reportPerformerFilter==='all'?'Вся команда':'Сотрудник';}
function reportVisitWord(count){return count%10===1&&count%100!==11?'визит':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'визита':'визитов';}
function reportPeriodName(){return reportPeriod==='month'?'Этот месяц':'Выбранный период';}
function bookingOutcome(row){return row.booking_outcomes;}
function reportServiceValue(row){return row.value;}
function reportReceivedAmount(row){return MinutaReportReconciliation.amounts(row,bookingOutcome(row),row.value).received;}
function reportCompletedItems(rows){return rows.filter(row=>MinutaReportReconciliation.completed(row,bookingOutcome(row)));}
function reportBookings(scope=reportRange()){
  const rows=fixtureMode==='empty'?[]:fixtureMode==='scenario'?[fixtureVisit('partial','2026-10-02',5800,'card',2000)]:fixtureVisits;
  return rows.filter(row=>row.booking_date>=scope.start&&row.booking_date<=scope.end
    &&(reportPerformerFilter==='all'||row.performer_id===reportPerformerFilter));
}
function reportClientIdentity(row){return row.id;}
function isScheduleBlock(){return false;}
function reportDateText(value,opts){return new Date(value+'T12:00:00Z').toLocaleDateString('ru-RU',{...opts,timeZone:'UTC'});}
function setReportText(selector,value){const node=document.querySelector(selector);if(node)node.textContent=value;}
function updateReportFilterSummary(){}
function openReportBookings(options){
  document.querySelector('#fixtureJournalResult').textContent=JSON.stringify(options.scope);
  document.querySelector('#fixtureJournalResult').hidden=false;
}
function renderAnalytics(){
  const range=reportRange(),completed=reportCompletedItems(reportBookings(range));
  reportScopedBookingsState={status:fixtureMode==='unavailable'?'failed':'ready',rows:completed,
    key:reportSessionKey(fixtureOrg,range.start,range.end,reportPerformerFilter)};
  reportTeamAnalyticsState=reportPeriod==='all'?{status:'ready',canViewTeam:true,derived:true,rows:[]}
    :{status:'ready',canViewTeam:true,rows:[{performer_id:fixtureMaster,performer_name:'Сотрудник'}]};
  if(typeof renderReportPerformerFilter==='function')renderReportPerformerFilter(range);
  const panel=document.querySelector('#analyticsView');
  panel.dataset.reportLoadState='ready';panel.dataset.reportSource=reportDataSource;
  document.querySelectorAll('[data-report-period]').forEach(button=>button.classList.toggle('active',button.dataset.reportPeriod===reportPeriod));
  document.querySelectorAll('[data-report-source]').forEach(button=>{const selected=button.dataset.reportSource===reportDataSource;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
  setReportText('#reportPeriodLabel',reportDateText(range.start,{day:'numeric',month:'short'})+' — '+reportDateText(range.end,{day:'numeric',month:'short',year:'numeric'})+' · '+reportPerformerName());
  setReportText('#reportCompletedValue',MinutaFinanceCenter.formatRubles(completed.reduce((sum,row)=>sum+row.value*100,0)));
  const known=completed.filter(row=>!MinutaReportReconciliation.paymentUnknown(row,bookingOutcome(row))).length;
  const unknown=completed.length-known;
  setReportText('#reportPaymentUnknown',unknown?`${unknown} ${reportVisitWord(unknown)} без отметки`:'Все оплаты отмечены');
  setReportText('#reportPaymentUnknownValue',MinutaFinanceCenter.formatRubles(completed.filter(row=>MinutaReportReconciliation.paymentUnknown(row,bookingOutcome(row))).reduce((sum,row)=>sum+row.value*100,0)));
  setReportText('#reportDataQuality','Оплата указана · '+known+' из '+completed.length);
  window.MinutaStatisticsAuditProvider?.refresh();
}
const cash=amount=>({side:amount<0?'credit':'debit',amount_minor:Math.abs(amount),financial_accounts:{account_class:'asset',account_type:'cash'}});
const db={
  async rpc(name,args){
    if(name!=='get_minuta_finance_screen_v163')throw Error('fixture_write_forbidden');
    if(fixtureMode==='unavailable')return {error:{code:'fixture_unavailable'},data:null};
    return {error:null,data:{schema:'minuta-finance-screen-v1',ledger_version:163,organization_id:fixtureOrg,currency:'RUB',timezone:'Europe/Samara',finance_enabled:true,
      period:{start:args.p_start,end:args.p_end,bucket_grain:'day'},selected_performer_id:args.p_performer,
      summary:{received_minor:0,expense_minor:0,services_minor:0,debt_minor:0},
      confidence:{completed_visits:37,payment_marked_visits:17,unposted_payment_visits:17,service_value_known_visits:36,is_complete:false,result_reliable:false},
      categories:[{id:'22222222-2222-4222-8222-222222222222',system_key:'rent',name:'Аренда',active:true}],
      performers:[{id:fixtureMaster,name:'Сотрудник'}],accounts:[],expense_structure:[],series:[],operations:[]}};
  },
  from(table){
    const filters=[],orders=[];
    let limit=Infinity;
    const query={
      select(){return query;},eq(key,value){filters.push(row=>row[key]===value);return query;},
      gte(key,value){filters.push(row=>row[key]>=value);return query;},lte(key,value){filters.push(row=>row[key]<=value);return query;},lt(key,value){filters.push(row=>row[key]<value);return query;},
      neq(key,value){filters.push(row=>row[key]!==value);return query;},in(key,values){filters.push(row=>values.includes(row[key]));return query;},
      order(key,options={}){orders.push([key,options.ascending!==false]);return query;},limit(value){limit=value;return query;},
      async range(start,end){
        const operation=(id,day,type,amount,source_id=id)=>({id,organization_id:fixtureOrg,occurred_at:day,operation_type:type,source_id,financial_postings:[cash(amount)]});
        const scenario=[
          operation('advance','2026-09-20T10:00:00Z','visit_service',300000,'partial'),
          operation('partial','2026-10-02T10:00:00Z','visit_service',200000,'partial'),
          operation('refund','2026-10-02T11:00:00Z','commercial_refund',-50000,'refund-sale'),
          operation('rent','2026-10-01T09:00:00Z','supplier_expense_payment',1000000*-1,'rent-source'),
          operation('materials','2026-10-02T09:00:00Z','supplier_expense_payment',-200000,'materials-source'),
          operation('goods','2026-10-02T09:00:00Z','commercial_sale',200000,'goods-sale')
        ];
        let rows=fixtureMode==='empty'?[]:table==='financial_transactions'?(fixtureMode==='scenario'?scenario:[operation('rent','2026-09-22T01:12:00Z','supplier_expense_payment',-1800000,'rent-source')])
          :table==='financial_manual_expenses_v163'?[
            {expense_source_id:'rent-source',category_id:'22222222-2222-4222-8222-222222222222',category_name_snapshot:'Аренда'},
            {expense_source_id:'materials-source',category_id:'materials',category_name_snapshot:'Материалы'}
          ]:table==='bookings'?[fixtureVisit('partial','2026-10-02',5800,'card',2000)]
          :table==='commercial_sales'&&fixtureMode==='scenario'?[{id:'goods-sale',seller_id:fixtureMaster,occurred_at:'2026-10-02T09:00:00Z',commercial_sale_lines:[{item_kind:'inventory_item',item_name:'Крем',quantity:2,total_minor:200000},{item_kind:'benefit_product',item_name:'Абонемент',quantity:1,total_minor:500000}]}]:[];
        rows=rows.map(row=>({...row,organization_id:fixtureOrg})).filter(row=>filters.every(filter=>filter(row)));
        rows.sort((a,b)=>{for(const [key,ascending]of orders){const order=String(a[key]).localeCompare(String(b[key]));if(order)return ascending?order:-order;}return 0;});
        return {error:null,data:rows.slice(start,Math.min(end+1,limit))};
      },
      then(resolve,reject){return query.range(0,limit-1).then(resolve,reject);}
    };
    return query;
  }
};
let financeController=MinutaFinanceProvider.createController({db,$:selector=>document.querySelector(selector),notify:()=>{},requireWrites:()=>false});
document.documentElement.classList.remove('requires-top-level','provider-booting');
document.documentElement.classList.add('top-level');
document.querySelector('#providerBoot')?.remove();
document.querySelector('#authCard').hidden=true;
document.querySelector('#dashboard').hidden=false;
document.querySelector('#dashboard').dataset.activeView='analytics';
document.querySelectorAll('[data-provider-panel]').forEach(panel=>{panel.hidden=panel.dataset.providerPanel!=='analytics';panel.classList.toggle('active',!panel.hidden);});
document.querySelectorAll('[data-provider-view]').forEach(button=>button.classList.toggle('active',button.dataset.providerView==='analytics'));
document.querySelector('#analyticsView').dataset.reportTab='overview';
document.querySelector('#analyticsView').dataset.reportSource='own';
document.querySelector('#reportDataSource').hidden=false;
document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
for(const [name,value] of Object.entries({'--theme-bg':'#fff5f8','--theme-surface':'#fff','--theme-surface-alt':'#ffe8f0','--theme-ink':'#302b31','--theme-muted':'#625c64','--theme-line':'#e9cbd6','--theme-accent':'#c43372','--theme-accent-soft':'#ffe8f0','--theme-accent-contrast':'#fff'}))document.body.style.setProperty(name,value);
document.querySelector('#reportPerformerFilterWrap').hidden=false;
document.querySelector('#reportPerformerFilter').innerHTML='<option value="all">Вся команда</option><option value="'+fixtureMaster+'">Сотрудник</option>';
document.querySelector('#reportPerformerFilter').addEventListener('change',event=>{reportPerformerFilter=event.target.value;renderAnalytics();});
document.querySelector('#reportFilterToggle').addEventListener('click',event=>{const button=event.currentTarget;const expanded=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(expanded));document.querySelector('.report-filters').classList.toggle('is-open',expanded);});
document.querySelectorAll('[data-report-period]').forEach(button=>button.addEventListener('click',()=>{reportPeriod=button.dataset.reportPeriod;renderAnalytics();}));
document.querySelectorAll('[data-report-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelector('#analyticsView').dataset.reportTab=button.dataset.reportView;document.querySelectorAll('[data-report-view]').forEach(tab=>{tab.classList.toggle('active',tab===button);tab.toggleAttribute('aria-current',tab===button);});}));
document.querySelectorAll('[data-report-source]').forEach(button=>button.addEventListener('click',()=>{reportDataSource=button.dataset.reportSource;renderAnalytics();}));
// A new synthetic dataset is a new context; an earlier in-flight read cannot win.
document.querySelector('#fixtureMode').addEventListener('change',async event=>{fixtureMode=event.target.value;sessionGeneration+=1;renderAnalytics();await financeController.load(reportRange(),{force:true,masterId:reportPerformerFilter});});
financeController.setOrganization(reportOrganization());
renderAnalytics();
