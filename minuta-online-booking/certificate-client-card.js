(function(){
  'use strict';
  function createController(options){
    const root=options.root||options.$?.('#clientCertificateDesigns'),R=window.MinutaCertificateRenderer;
    if(!root||!R)throw new Error('certificate_client_card_not_mounted');
    const repository=options.repository||{clientRecords:async(org,phone,cursor)=>{const {data,error}=await options.db.rpc('get_minuta_client_certificates',{p_organization:org,p_phone:phone,p_cursor:cursor});if(error)throw error;return data}};
    const $=selector=>root.querySelector(selector);let client=null,organization=null,revision=0,cursor=null,rows=[],today=null,busy=false;
    root.classList.add('certificate-designer');root.hidden=true;
    root.innerHTML='<h4>Подарочные сертификаты</h4><p class="certificate-help" data-card-message role="status"></p><div data-card-list></div><div class="certificate-buttons"><button type="button" data-card-more hidden>Показать ещё</button></div>';
    const capture=()=>({revision,org:organization?.id,phone:client?.phone,user:options.getCurrentUser?.()?.id,generation:options.getSessionGeneration?.()});
    const current=scope=>scope.revision===revision&&scope.org===organization?.id&&scope.phone===client?.phone&&(!options.sessionIsCurrent||options.sessionIsCurrent(scope.user,scope.generation));
    function render(){
      const list=$('[data-card-list]');list.replaceChildren();
      for(const item of rows){
        const article=document.createElement('article');article.className='certificate-row';
        const main=document.createElement('div');main.className='certificate-row-main';
        const title=document.createElement('strong');title.textContent=`№ ${item.number} · ${item.procedure}`;
        const dates=document.createElement('span');dates.className='certificate-help';dates.textContent=`Выдан ${R.dateLabel(item.issued_on)} · действует по ${R.dateLabel(item.expires_on)}`;
        const balance=document.createElement('span');balance.className='certificate-help';
        balance.textContent=Number.isInteger(item.remaining_visits)?`Остаток абонемента: ${item.remaining_visits} из ${item.sessions} сеансов`:`Всего ${item.sessions} ${R.plural(item.sessions,'сеанс','сеанса','сеансов')} · учёт остатка не подключён`;
        main.append(title,dates); if(Number.isInteger(item.sessions))main.append(balance);
        if(item.benefit_status&&item.benefit_status!=='active'){const status=document.createElement('span');status.className='certificate-help';status.textContent='Абонемент: '+({frozen:'заморожен',exhausted:'использован',expired:'истёк',cancelled:'отменён'}[item.benefit_status]||'статус недоступен');main.append(status)}
        const state=R.status(item,today,item.remind_days),badge=document.createElement('span');badge.className='certificate-status certificate-status-'+state.code;
        badge.textContent={active:'Действует',expiring:'Скоро истечёт',expired:'Истёк'}[state.code];article.append(main,badge);
        if(options.onOpen){const button=document.createElement('button');button.type='button';button.textContent='Открыть сертификат';button.addEventListener('click',async()=>{const scope=capture();button.disabled=true;try{await options.onOpen(item,organization)}catch{if(current(scope))$('[data-card-message]').textContent='Не удалось открыть сертификат. Попробуй снова.'}finally{if(current(scope))button.disabled=false}});article.append(button)}
        list.append(article);
      }
      $('[data-card-message]').textContent=rows.length?'':'Выданных сертификатов у этого клиента пока нет.';
      $('[data-card-more]').hidden=!cursor;$('[data-card-more]').disabled=busy;
    }
    async function load(append=false){
      if(!client?.phone||!organization?.id||busy)return;
      const scope=capture();busy=true;$('[data-card-more]').disabled=true;$('[data-card-message]').textContent='Загружаем сертификаты…';
      try{
        const data=await repository.clientRecords(scope.org,scope.phone,append?cursor:null);
        if(!current(scope))return;
        if(data.organization_id!==scope.org||data.client_phone!==scope.phone||!Array.isArray(data.records))throw new Error('stale_client');
        R.day(data.today);today=data.today;rows=append?[...rows,...data.records]:data.records;cursor=data.next_cursor||null;render();
      }catch{if(current(scope)){rows=[];cursor=null;$('[data-card-list]').replaceChildren();$('[data-card-more]').hidden=true;$('[data-card-message]').textContent='Не удалось загрузить сертификаты этого клиента.'}}
      finally{if(current(scope)){busy=false;$('[data-card-more]').disabled=false}}
    }
    function reset(){++revision;client=null;organization=null;rows=[];cursor=null;busy=false;root.hidden=true;$('[data-card-list]').replaceChildren();$('[data-card-message]').textContent='';$('[data-card-more]').hidden=true}
    async function setClient(value,org){reset();client=value||null;organization=org||null;if(!client?.phone||!organization?.id)return;root.hidden=false;await load()}
    $('[data-card-more]').addEventListener('click',()=>load(true));
    function reload(){if(!client?.phone||!organization?.id)return; ++revision;busy=false;cursor=null;return load()}
    return{bind(){},setClient,reset,load,reload};
  }
  window.MinutaCertificateClientCard={createController};
})();
