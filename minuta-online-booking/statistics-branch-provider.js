(function(root){'use strict';
 function activate({backendAccepted=false,document:doc=root.document}={}){
  if(backendAccepted!==true)throw new Error('branch_backend_not_accepted');
  if(typeof reportDataSource!=='undefined' && reportDataSource!=='own')throw new Error('branch_real_source_required');
  if(root.MinutaStatisticsBranchRuntime?.enabled)throw new Error('branch_runtime_already_active');
  if(!root.MinutaStatisticsBranchScope)throw new Error('branch_contract_not_loaded');
  if(root.MinutaStatisticsAuditProvider?.branchSourceReady!==true)throw new Error('branch_statistics_extension_not_loaded');
  const getIdentity=()=>({userId:currentUser?.id,organizationId:reportOrganizationId(),role:reportOrganization()?.current_role,sessionGeneration,source:reportDataSource});
  const scope=root.MinutaStatisticsBranchScope.create({backendAccepted:true,rpc:(name,args)=>db.rpc(name,args),getIdentity,onChange:()=>{
   reportScopedBookingsState={key:'',status:'idle',rows:[]};reportAvailabilityState={key:'',status:'idle',availableMinutes:null,configured:0,total:0,complete:false};
   reportTeamAnalyticsState={key:'',status:'idle',rows:[],canViewTeam:reportCanViewTeam};reportEventState={key:'',rows:[],status:'idle'};reportUtmFunnelState={key:'',status:'idle',data:null};
   root.MinutaStatisticsAuditProvider?.refresh();loadSelectedReportData();renderAnalytics();
  }});
  scope.snapshot();
  const panel=doc.querySelector('#analyticsView');if(!panel)throw new Error('branch_report_panel_required');root.MinutaStatisticsBranchRuntime=scope;
  const label=doc.createElement('label');label.className='report-filter';label.textContent='Филиал ';
  const select=doc.createElement('select');select.id='reportStatisticsLocation';select.setAttribute('aria-label','Филиал статистики');
  const all=doc.createElement('option');all.value='';all.textContent='Все филиалы';select.append(all);
  for(const item of reportOrganization()?.locations||[]){if(item.active===false)continue;const option=doc.createElement('option');option.value=String(item.id);option.textContent=String(item.name||'Филиал');select.append(option)}
  select.addEventListener('change',()=>scope.setLocation(select.value));label.append(select);panel.prepend(label);
  let identityToken=JSON.stringify(getIdentity());
  const observer=new MutationObserver(()=>{const next=JSON.stringify(getIdentity());if(next===identityToken)return;identityToken=next;label.remove();observer.disconnect();delete root.MinutaStatisticsBranchRuntime;resetReportSessionState();});
  observer.observe(panel,{attributes:true,childList:true,subtree:true});
  return scope;
 }
 root.MinutaStatisticsBranchProvider=Object.freeze({activate});
 if(root.MINUTA_CONFIG?.statisticsBranchBackendAccepted===true && typeof currentUser!=='undefined' && currentUser?.id && typeof reportDataSource!=='undefined' && reportDataSource==='own' && reportOrganizationId() && root.MinutaStatisticsAuditProvider?.branchSourceReady===true)activate({backendAccepted:true});
})(typeof window==='undefined'?globalThis:window);
