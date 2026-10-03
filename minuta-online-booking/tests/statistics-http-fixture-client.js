'use strict';
// Only this isolated fixture loads this transport. Real provider code does not.
(()=>{
  let failSummary=false;
  const mode=()=>document.querySelector('#fixtureMode')?.value||'scenario';
  async function read(path,params){
    const url=new URL(path,location.origin);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    const response=await fetch(url,{method:'GET',credentials:'omit',cache:'no-store'});
    const result=await response.json();
    document.querySelector('#qaResult').textContent='GET '+path+' → HTTP '+response.status;
    return response.ok?result:{error:result.error||{code:'fixture_http_'+response.status},data:null};
  }
  const db={
    async rpc(name,args){if(name!=='get_minuta_finance_screen_v163')throw Error('fixture_write_forbidden');return read('/qa/rpc',{mode:failSummary?'rpc503':mode(),args:JSON.stringify(args)});},
    from(table){
      const filters=[],orders=[];let limit=Infinity;
      const query={
        select(){return query;},eq(key,value){filters.push(row=>row[key]===value);return query;},
        gte(key,value){filters.push(row=>row[key]>=value);return query;},lte(key,value){filters.push(row=>row[key]<=value);return query;},
        lt(key,value){filters.push(row=>row[key]<value);return query;},neq(key,value){filters.push(row=>row[key]!==value);return query;},
        in(key,values){filters.push(row=>values.includes(row[key]));return query;},
        order(key,options={}){orders.push([key,options.ascending!==false]);return query;},limit(value){limit=value;return query;},
        async range(start,end){
          const result=await read('/qa/table',{mode:mode(),table});if(result.error)return result;
          const rows=result.data.filter(row=>filters.every(filter=>filter(row)));
          rows.sort((a,b)=>{for(const [key,ascending]of orders){const order=String(a[key]).localeCompare(String(b[key]));if(order)return ascending?order:-order;}return 0;});
          return {error:null,data:rows.slice(start,Math.min(end+1,limit))};
        },
        then(resolve,reject){return query.range(0,limit-1).then(resolve,reject);}
      };return query;
    }
  };
  window.MinutaStatisticsHttpFixture={db};
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('#qaTextScale').addEventListener('change',event=>{document.documentElement.style.fontSize=event.target.value+'%';});
    document.querySelector('#qaFailSummary').addEventListener('click',async()=>{failSummary=true;await financeController.load(reportRange(),{force:true,masterId:reportPerformerFilter});});
    document.querySelector('#qaRestore').addEventListener('click',()=>{failSummary=false;document.querySelector('#qaResult').textContent='Источник восстановлен. Нажмите «Повторить» в обзоре.';});
  });
})();
