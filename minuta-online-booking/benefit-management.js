(function () {
  'use strict';

  const kindLabels = { visit_pass:'Абонемент', certificate:'Сертификат', package:'Пакет услуг' };
  const statusLabels = { active:'Активен', frozen:'Заморожен', exhausted:'Использован', expired:'Истёк', cancelled:'Отменён' };
  const redemptionStatusLabels = { reserved:'Зарезервировано', redeemed:'Погашено', released:'Возвращено' };

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let availability = null;
    let revision = 0;
    let writing = false;
    let pendingOrganization;
    let issueIntent = null;
    let issueConfirmed = false;
    let issueRejected = false;
    let issueStorageFailed = false;
    let issueStorageScope = '';
    let issueCreatorHome = null;

    function issueKey() { return `minuta_benefit_issue_v1:${getCurrentUser()?.id}:${organization?.id}`; }
    function restoreIssueIntent() {
      issueStorageScope=issueKey();issueIntent=null;issueConfirmed=false;issueRejected=false;issueStorageFailed=false;
      try {
        const raw=window.localStorage.getItem(issueStorageScope);if(!raw)return;
        const value=JSON.parse(raw);
        if(value.organization_id!==organization?.id || value.actor_id!==getCurrentUser()?.id
          || !value.request_id || !value.product_id || !value.client_account_id
          || !(value.expires_on===null || /^\d{4}-\d{2}-\d{2}$/.test(value.expires_on)))throw Error('invalid_issue_intent');
        issueIntent=value;
      } catch { issueStorageFailed=true; }
    }
    function persistIssueIntent(intent) {
      const key=issueKey(),old=window.localStorage.getItem(key);
      if(old && JSON.parse(old).request_id!==intent.request_id)throw Error('another_issue_intent');
      // Opaque identifiers and the requested expiry only: no client details or balances.
      const encoded=JSON.stringify(intent);window.localStorage.setItem(key,encoded);
      if(window.localStorage.getItem(key)!==encoded)throw Error('issue_intent_not_saved');
      issueIntent=intent;
    }
    function renderIssueRecovery() {
      const form=$('#benefitIssueForm');if(!form)return;
      if(document.createElement && !document.getElementById('benefitIssueRecovery')) {
        const recovery=document.createElement('div');recovery.id='benefitIssueRecovery';
        recovery.innerHTML='<p id="benefitIssueRecoveryStatus" role="status"></p><button id="benefitIssueNew" class="secondary-button" type="button" data-benefit-write>Новая выдача</button>';
        form.before(recovery);
        const help=form.querySelector('.benefit-form-help');
        if(help){const details=document.createElement('details');details.className='ux-disclosure';details.innerHTML='<summary>Подробнее о сроке действия</summary>';form.append(details);details.append(help);}
      }
      const active=Boolean(issueIntent||issueStorageFailed);
      const creator=$('#benefitIssueCreator');
      if(creator?.parentElement&&!issueCreatorHome)issueCreatorHome={parent:creator.parentElement,next:creator.nextSibling};
      if(active)$('#benefitWorkflowStatus')?.after?.(creator);
      else if(issueCreatorHome)issueCreatorHome.parent.insertBefore(creator,issueCreatorHome.next);
      const creatorLabel=creator?.querySelector?.('summary span');
      if(creatorLabel)creatorLabel.textContent=active?'Проверка выдачи':'Выдать клиенту';
      if(active&&$('#benefitWorkflowStatus'))$('#benefitWorkflowStatus').textContent=issueConfirmed
        ? 'Выдача подтверждена. Повторная выдача — только отдельным действием.'
        : issueRejected?'Прежняя выдача отклонена. Можно исправить параметры новой операцией.'
          : 'Сначала проверьте результат прежней выдачи.';
      if($('#benefitIssueRecovery'))$('#benefitIssueRecovery').hidden=!active;
      if($('#benefitIssueRecoveryStatus'))$('#benefitIssueRecoveryStatus').textContent=issueStorageFailed
        ? 'Не удалось прочитать сохранённую выдачу. Новая операция заблокирована до восстановления хранилища.'
        : issueConfirmed ? 'Продукт уже выдан клиенту. Для отдельного абонемента или сертификата нажмите «Новая выдача».'
          : issueRejected ? 'Выдача отклонена сервером и не появилась в журнале. Нажмите «Новая выдача», чтобы исправить параметры.'
          : 'Выдача ожидает проверки. Проверим прежнюю операцию перед безопасным повтором.';
      if($('#benefitIssueNew')){$('#benefitIssueNew').hidden=!(issueConfirmed||issueRejected);$('#benefitIssueNew').disabled=writing;}
      const button=form.querySelector?.('button[type="submit"]');
      if(button){button.textContent=issueIntent?'Проверить выдачу':'Выдать клиенту';button.disabled=writing||issueStorageFailed;}
      if(active){$('#benefitIssueCreator').hidden=false;$('#benefitIssueCreator').open=true;}
      for(const [id,key,label] of [['benefitIssueProduct','product_id','Сохранённый продукт'],['benefitIssueClient','client_account_id','Сохранённый клиент']]) {
        const field=$(`#${id}`);if(!field)continue;
        if(issueIntent){
          if(![...(field.options||[])].some(option=>option.value===issueIntent[key]))field.innerHTML+=`<option value="${escapeHtml(issueIntent[key])}">${label}</option>`;
          field.value=issueIntent[key];
        }
        field.disabled=writing||Boolean(issueIntent);
      }
      const expiry=$('#benefitIssueExpiry');
      if(expiry){if(issueIntent)expiry.value=issueIntent.expires_on||'';expiry.disabled=writing||Boolean(issueIntent);}
    }
    async function checkIssueIntent(intent,isCurrent) {
      const {data,error}=await db.from('client_benefit_instruments')
        .select('id,organization_id,request_id,product_id,client_account_id,public_code,expires_on')
        .eq('organization_id',intent.organization_id).eq('request_id',intent.request_id).maybeSingle();
      if(!isCurrent())return 'stale';
      if(error)throw Error('issue_check_unavailable');
      if(!data)return 'missing';
      if(!scopeMatches(data,intent.organization_id)||data.request_id!==intent.request_id
        || data.product_id!==intent.product_id||data.client_account_id!==intent.client_account_id
        || !data.id || !data.public_code)throw Error('issue_check_mismatch');
      issueConfirmed=true;return 'confirmed';
    }
    function newIssue() {
      if(writing||!(issueConfirmed||issueRejected)||!issueIntent||!requireWrites())return;
      try {
        const key=issueKey();
        if(JSON.parse(window.localStorage.getItem(key)||'null')?.request_id!==issueIntent.request_id)throw Error('another_issue_intent');
        window.localStorage.removeItem(key);if(window.localStorage.getItem(key)!==null)throw Error('issue_clear_failed');
      } catch { showFormError('#benefitIssueError','Не удалось завершить проверку. Новая выдача пока недоступна.');return; }
      issueIntent=null;issueConfirmed=false;issueRejected=false;$('#benefitIssueForm').reset();render();
    }

    function unsupported(error) {
      return /PGRST202|42883|get_minuta_benefit_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function scopeMatches(data,id) { return Boolean(data && String(data.organization_id || '')===String(id)); }
    function rubles(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`; }
    function clientName(id) { const item=payload?.clients?.find(row=>row.id===id); return item ? `${item.client_name} · ${item.client_phone}` : 'Клиент'; }
    function productName(id) { return payload?.products?.find(row=>row.id===id)?.name || 'Продукт'; }
    function serviceName(id) { return payload?.services?.find(row=>row.id===id)?.name || 'Услуга'; }
    function dateLabel(value) { const date=new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? String(value||'') : date.toLocaleDateString('ru-RU'); }
    function optionsList(items,label) { return items.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(label(item))}</option>`).join(''); }
    function selectOptions(items,label,emptyLabel) { return items.length ? optionsList(items,label) : `<option value="" selected disabled>${escapeHtml(emptyLabel)}</option>`; }
    function empty(title,text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }
    function todayIso() {
      const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Samara',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
      const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
      return `${values.year}-${values.month}-${values.day}`;
    }
    function uuid() {
      if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
      throw Error('secure_request_id_unavailable');
    }
    function showFormError(selector,message){const holder=$(selector);if(!holder)return;holder.textContent=message;holder.hidden=false;}

    function setBusy(value) {
      $('#benefitsPanel')?.querySelectorAll('[data-benefit-write]').forEach(control=>{
        if(value && !control.disabled){control.disabled=true;control.dataset.benefitBusy='true';}
        else if(!value && control.dataset.benefitBusy==='true'){control.disabled=false;delete control.dataset.benefitBusy;}
      });
    }
    function reset() {
      revision+=1; organization=null; payload=null; availability=null; writing=false; pendingOrganization=undefined;
      issueIntent=null;issueConfirmed=false;issueRejected=false;issueStorageFailed=false;issueStorageScope='';
      $('#benefitsPanel').hidden=true; $('#benefitsLoading').hidden=true; $('#benefitsUnavailable').hidden=true; $('#benefitsWorkspace').hidden=true;
    }
    async function setOrganization(next) {
      const normalized=next?.id?{...next}:null;
      if(writing){pendingOrganization=normalized;revision+=1;$('#benefitsPanel').hidden=!normalized;$('#benefitsWorkspace').hidden=true;return {ok:false,optional:true,pending:true};}
      if(!normalized){reset();return {ok:false,optional:true};}
      if(!['owner','admin'].includes(normalized.current_role)){reset();return {ok:false,optional:true,forbidden:true};}
      organization=normalized;if(issueStorageScope!==issueKey())restoreIssueIntent();pendingOrganization=undefined;return load();
    }
    async function load() {
      if(writing)return {ok:false,optional:true,pending:true};
      const userId=getCurrentUser()?.id, generation=getSessionGeneration(), organizationId=organization?.id, current=++revision;
      if(!userId||!organizationId){reset();return {ok:false,optional:true};}
      availability='loading'; payload=null; $('#benefitsPanel').hidden=false; $('#benefitsLoading').hidden=false; $('#benefitsUnavailable').hidden=true; $('#benefitsWorkspace').hidden=true;
      const {data,error}=await db.rpc('get_minuta_benefit_workspace',{p_organization:organizationId});
      if(!sessionIsCurrent(userId,generation)||current!==revision||organization?.id!==organizationId)return {ok:false,optional:true,stale:true};
      $('#benefitsLoading').hidden=true;
      if(error){availability=unsupported(error)?'unsupported':'error';if(availability==='unsupported'){$('#benefitsPanel').hidden=true;return {ok:false,optional:true,unsupported:true};}$('#benefitsUnavailable').hidden=false;$('#benefitsUnavailableText').textContent='Записи клиентов продолжают работать. Не удалось загрузить только абонементы.';return {ok:false,optional:true};}
      if(!scopeMatches(data,organizationId)){availability='error';$('#benefitsUnavailable').hidden=false;$('#benefitsUnavailableText').textContent='Сервер вернул данные другой организации. Изменения заблокированы.';return {ok:false,optional:true};}
      payload=data; for(const key of ['services','clients','bookings','products','instruments','redemptions','audit'])if(!Array.isArray(payload[key]))payload[key]=[];
      availability='ready'; render(); return {ok:true,optional:true};
    }

    function productCard(item) {
      const value=item.kind==='certificate'?rubles(item.face_value_rub):`${item.visits_count} посещ.`;
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(item.name)} · ${escapeHtml(value)}</strong><small>${escapeHtml(kindLabels[item.kind]||item.kind)} · продажа ${escapeHtml(rubles(item.sale_price_rub))} · ${item.validity_days} дней</small></div><span class="organization-status ${item.active?'is-active':''}">${item.active?'Доступен':'Скрыт'}</span></article>`;
    }
    function instrumentCard(item,today) {
      const expired=String(item.expires_on)<today;
      const status=expired&&item.status==='active'?'expired':item.status;
      const snapshot=item.product_snapshot||{};
      const balance=snapshot.kind==='certificate'?rubles(item.remaining_amount_rub):`${item.remaining_visits} посещ.`;
      const actions=status==='active'?`<button class="secondary-button" type="button" data-benefit-status="frozen" data-benefit-instrument="${escapeHtml(item.id)}" data-benefit-write>Заморозить</button>`:status==='frozen'?`<button class="secondary-button" type="button" data-benefit-status="active" data-benefit-instrument="${escapeHtml(item.id)}" data-benefit-write>Разморозить</button>`:'';
      return `<article class="organization-row" data-benefit-code="${escapeHtml(item.public_code)}"><div class="organization-row-main"><strong>${escapeHtml(snapshot.name||productName(item.product_id))} · ${escapeHtml(balance)}</strong><small>${escapeHtml(clientName(item.client_account_id))} · код ${escapeHtml(item.public_code)} · до ${escapeHtml(dateLabel(item.expires_on))}</small></div><span class="organization-tags"><span class="organization-status ${status==='active'?'is-active':''}">${escapeHtml(statusLabels[status]||status)}</span>${actions}</span></article>`;
    }
    function filterInstruments() {
      const query=String($('#benefitInstrumentSearch')?.value||'').trim().toLocaleLowerCase('ru-RU');
      $('#benefitInstrumentsList')?.querySelectorAll('[data-benefit-code]').forEach(card=>{card.hidden=Boolean(query&&!String(card.dataset.benefitCode||'').toLocaleLowerCase('ru-RU').includes(query));});
    }
    function redemptionCard(item) {
      const booking=payload.bookings.find(row=>row.id===item.booking_id);
      const actions=item.status==='reserved'?`<button class="primary-button" type="button" data-benefit-action="redeem" data-benefit-redemption="${escapeHtml(item.id)}" data-benefit-write>Погасить</button><button class="secondary-button" type="button" data-benefit-action="release" data-benefit-redemption="${escapeHtml(item.id)}" data-benefit-write>Вернуть</button>`:item.status==='redeemed'&&payload.current_role==='owner'?`<button class="secondary-button" type="button" data-benefit-action="release" data-benefit-redemption="${escapeHtml(item.id)}" data-benefit-write>Вернуть</button>`:'';
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(booking?.service_name||'Запись')} · ${item.amount_rub?escapeHtml(rubles(item.amount_rub)):`${item.units} посещ.`}</strong><small>${escapeHtml(booking?.client_name||'Клиент')} · ${escapeHtml(redemptionStatusLabels[item.status]||item.status)}</small></div><span class="organization-tags">${actions}</span></article>`;
    }
    function renderProductServices() {
      const holder=$('#benefitProductServices');
      const kind=$('#benefitProductKind').value;
      const certificate=kind==='certificate';
      const servicesFieldset=holder.closest('fieldset');
      if(servicesFieldset)servicesFieldset.hidden=certificate;
      $('#benefitProductVisitsField').hidden=kind!=='visit_pass';
      $('#benefitProductValueField').hidden=!certificate;
      holder.innerHTML=payload.services.map(service=>`<label class="benefit-service-option"><input type="checkbox" data-benefit-service="${escapeHtml(service.id)}"><span>${escapeHtml(service.name)}</span><input type="number" data-benefit-units="${escapeHtml(service.id)}" min="1" max="10000" value="1" aria-label="Количество посещений"></label>`).join('');
      $('#benefitProductServicesHint').textContent=kind==='package'?'Выберите хотя бы одну услугу. Количество по услугам автоматически станет размером пакета.':'Выберите услуги, на которые действует абонемент. Если ничего не выбрать, он действует на все услуги.';
    }
    function renderApplyAmount() {
      const instrument=payload.instruments.find(item=>item.id===$('#benefitApplyInstrument').value);
      const certificate=instrument?.product_snapshot?.kind==='certificate';
      const input=$('#benefitApplyAmount');
      input.disabled=!certificate;
      if(!certificate)input.value='';
      $('#benefitApplyAmountHint').textContent=certificate?'Оставьте пустым, чтобы списать стоимость записи, но не больше остатка сертификата.':'Для абонемента и пакета сумма не требуется.';
    }
    function renderBookingOptions() {
      const instrument=payload.instruments.find(item=>item.id===$('#benefitApplyInstrument').value);
      const bookings=instrument?payload.bookings.filter(item=>item.client_account_id===instrument.client_account_id):[];
      $('#benefitApplyBooking').innerHTML=selectOptions(bookings,item=>`${dateLabel(item.booking_date)} · ${item.client_name} · ${item.service_name}`,'Нет подходящих записей этого клиента');
      renderApplyAmount();
    }
    function render() {
      if(availability!=='ready'||!payload)return;
      const panel=$('#benefitsPanel'),workflowStatus=$('#benefitWorkflowStatus');
      const head=panel?.querySelector?.('.panel-head'),guide=panel?.querySelector?.('.benefit-guide')?.closest('details');
      if(head&&workflowStatus)head.after(workflowStatus);
      if(guide){const intro=panel.querySelector(':scope > .organization-invite-help');if(intro)guide.querySelector('summary').after(intro);panel.append(guide);}
      const today=todayIso();
      $('#benefitsWorkspace').hidden=false; $('#benefitsUnavailable').hidden=true; $('#benefitsEnabled').checked=Boolean(payload.enabled); $('#benefitsEnabled').disabled=payload.current_role!=='owner';
      $('#benefitProductsCount').textContent=String(payload.products.length); $('#benefitInstrumentsCount').textContent=String(payload.instruments.length);
      $('#benefitProductsList').innerHTML=payload.products.length?payload.products.map(productCard).join(''):empty('Продуктов пока нет','Создайте абонемент, сертификат или пакет услуг.');
      $('#benefitInstrumentsList').innerHTML=payload.instruments.length?payload.instruments.map(item=>instrumentCard(item,today)).join(''):empty('Ничего не выдано','Выданные продукты появятся здесь.');
      filterInstruments();
      $('#benefitRedemptionsList').innerHTML=payload.redemptions.length?payload.redemptions.map(redemptionCard).join(''):empty('Списаний пока нет','Примените продукт к записи клиента.');
      $('#benefitProductCreator').hidden=!payload.enabled; $('#benefitIssueCreator').hidden=!payload.enabled; $('#benefitApplyCreator').hidden=!payload.enabled;
      const activeProducts=payload.products.filter(item=>item.active);
      $('#benefitIssueProduct').innerHTML=selectOptions(activeProducts,item=>`${item.name} · ${kindLabels[item.kind]||item.kind}`,'Сначала создайте продукт');
      $('#benefitIssueClient').innerHTML=selectOptions(payload.clients,item=>`${item.client_name} · ${item.client_phone}`,'Нет клиентов с записями');
      $('#benefitIssueExpiry').min=today;
      const activeInstruments=payload.instruments.filter(item=>item.status==='active'&&item.expires_on>=today);
      $('#benefitApplyInstrument').innerHTML=selectOptions(activeInstruments,item=>`${item.product_snapshot?.name||productName(item.product_id)} · ${item.public_code}`,'Сначала выдайте продукт клиенту');
      renderBookingOptions();
      renderProductServices();
      const workflow=$('#benefitWorkflowStatus');
      if(workflow)workflow.textContent=!payload.enabled?'Система выключена. Включить её может владелец организации.':!payload.products.length?'Система включена. Следующий шаг: создайте первый продукт.':!payload.instruments.length?'Продукты созданы. Следующий шаг: выдайте продукт клиенту.':`Система работает. Выдано клиентам: ${payload.instruments.length}.`;
      setBusy(false); applyWriteAvailability();renderIssueRecovery();
    }

    function messageFor(error) {
      const text=`${error?.message||''} ${error?.details||''}`;
      const rows=[['benefits_disabled','Сначала включите абонементы.'],['booking_benefit_conflict','Для одной записи можно выбрать только один вариант: абонемент или сертификат, бонусы либо промокод.'],['package_units_mismatch','Для пакета выберите услуги и укажите количество посещений для каждой.'],['invalid_benefit_product_service','Выберите действующие услуги и проверьте количество посещений.'],['invalid_benefit_product','Заполните название, цену, срок и данные выбранного типа продукта.'],['benefit_request_conflict','Параметры выдачи изменились. Проверьте форму и повторите.'],['benefit_request_id_required','Не удалось защитить выдачу от повтора. Обновите раздел и попробуйте снова.'],['invalid_benefit_expiry','Срок действия не может быть в прошлом и не должен превышать 10 лет.'],['benefit_product_not_found','Выбранный продукт недоступен. Обновите раздел.'],['benefit_client_not_in_organization','Клиент должен иметь хотя бы одну запись в этой организации.'],['benefit_client_mismatch','Продукт принадлежит другому клиенту.'],['benefit_not_available','Продукт заморожен, закончился или истёк к дате записи.'],['booking_already_has_benefit','К этой записи уже применён другой продукт.'],['complete_visit_before_redemption','Сначала отметьте визит завершённым.'],['insufficient_certificate_balance','Недостаточно средств на сертификате.'],['package_service_exhausted','Эта услуга в пакете закончилась.'],['visit_pass_not_applicable','Абонемент не действует на эту услугу.'],['benefit_reservation_not_found','Резерв для этой записи не найден.'],['owner_required_to_release_redeemed_benefit','Вернуть уже погашенный продукт может только владелец.']];
      return rows.find(([key])=>text.includes(key))?.[1]||'Изменение не сохранено. Записи и деньги не затронуты.';
    }
    async function mutate(rpc,parameters,button,success,errorHolder) {
      if(!requireWrites()||writing||availability!=='ready'||!scopeMatches(payload,organization?.id))return false;
      const userId=getCurrentUser()?.id,generation=getSessionGeneration(),organizationId=organization.id,current=++revision;
      writing=true;setBusy(true);if(errorHolder){$(errorHolder).hidden=true;$(errorHolder).textContent='';}const old=button?.textContent;if(button){button.disabled=true;button.textContent='Сохраняем…';}
      const {data,error}=await db.rpc(rpc,parameters);if(button)button.textContent=old;const stale=!sessionIsCurrent(userId,generation)||current!==revision||organization?.id!==organizationId;writing=false;
      if(stale){const next=pendingOrganization;pendingOrganization=undefined;if(next!==undefined)await setOrganization(next);return false;}
      if(error){const message=messageFor(error);if(errorHolder){$(errorHolder).textContent=message;$(errorHolder).hidden=false;}else notify(message);await load();return false;}
      if(!scopeMatches(data,organizationId)){notify('Ответ другой организации заблокирован.');await load();return false;}
      notify(success);await load();return true;
    }
    function selectedServices() {
      return [...$('#benefitProductServices').querySelectorAll('[data-benefit-service]:checked')].map(input=>({service_id:input.dataset.benefitService,units:Number($(`[data-benefit-units="${input.dataset.benefitService}"]`).value)}));
    }
    async function issueBenefit(event) {
      if(!requireWrites()||writing||availability!=='ready'||!scopeMatches(payload,organization?.id)
        || !['owner','admin'].includes(payload.current_role))return;
      if(issueStorageScope!==issueKey())restoreIssueIntent();
      if(issueStorageFailed){showFormError('#benefitIssueError','Не удалось прочитать сохранённую выдачу. Новая операция заблокирована.');return;}
      const userId=getCurrentUser()?.id,generation=getSessionGeneration(),organizationId=organization.id,current=++revision;
      const isCurrent=()=>sessionIsCurrent(userId,generation)&&current===revision&&organization?.id===organizationId;
      writing=true;setBusy(true);$('#benefitIssueError').hidden=true;
      try {
        let intent=issueIntent;
        if(intent){
          const checked=await checkIssueIntent(intent,isCurrent);if(!isCurrent())return;
          if(checked==='confirmed'){notify('Продукт уже выдан клиенту. Повторная выдача не создана.');return;}
          if(['22023','42501','P0002','55000','23505'].includes(intent.rejection_code)){
            issueRejected=true;showFormError('#benefitIssueError','Предыдущая выдача отклонена. Для исправления параметров нажмите «Новая выдача».');return;
          }
        }else{
          intent={actor_id:userId,organization_id:organizationId,product_id:$('#benefitIssueProduct').value,
            client_account_id:$('#benefitIssueClient').value,expires_on:$('#benefitIssueExpiry').value||null,request_id:uuid()};
          if(!intent.product_id||!intent.client_account_id){showFormError('#benefitIssueError','Выберите продукт и клиента.');return;}
          try{persistIssueIntent(intent);}catch{showFormError('#benefitIssueError','Не удалось сохранить защиту от повторной выдачи. Операция не отправлена.');return;}
        }
        renderIssueRecovery();
        const {data,error}=await db.rpc('issue_minuta_benefit',{p_organization:intent.organization_id,
          p_product:intent.product_id,p_client_account:intent.client_account_id,p_expires_on:intent.expires_on,p_request_id:intent.request_id});
        if(!isCurrent())return;
        if(error && ['22023','42501','P0002','55000','23505'].includes(error.code)) {
          persistIssueIntent({...intent,rejection_code:error.code});
          const checked=await checkIssueIntent(issueIntent,isCurrent);if(!isCurrent())return;
          if(checked==='confirmed'){notify('Продукт уже выдан клиенту. Повторная выдача не создана.');return;}
          issueRejected=true;showFormError('#benefitIssueError',`${messageFor(error)} Для исправления нажмите «Новая выдача».`);return;
        }
        if(error||!scopeMatches(data,organizationId)||!data?.id||!data?.public_code||!/^\d{4}-\d{2}-\d{2}$/.test(data?.expires_on||'')){
          showFormError('#benefitIssueError','Выдача пока не подтверждена. Сохранена прежняя операция; проверьте её статус перед повтором.');return;
        }
        issueConfirmed=true;notify('Продукт выдан клиенту');
      }catch{if(isCurrent())showFormError('#benefitIssueError','Не удалось сверить выдачу. Новая операция заблокирована; повторите проверку позже.');}
      finally{
        const stale=!isCurrent();writing=false;
        if(stale){const next=pendingOrganization;pendingOrganization=undefined;if(next!==undefined)await setOrganization(next);}
        else{setBusy(false);if(issueConfirmed)await load();else renderIssueRecovery();}
      }
    }
    async function submit(event) {
      if(!event.target.closest('#benefitsPanel'))return;
      if(event.target.id==='benefitProductForm'){
        event.preventDefault();const kind=$('#benefitProductKind').value,services=selectedServices();const visits=kind==='package'?services.reduce((sum,item)=>sum+item.units,0):Number($('#benefitProductVisits').value||0);
        if(kind==='package'&&!services.length){showFormError('#benefitProductError','Для пакета выберите хотя бы одну услугу и укажите количество посещений.');return;}
        const ok=await mutate('upsert_minuta_benefit_product',{p_organization:organization.id,p_product:null,p_name:$('#benefitProductName').value.trim(),p_kind:kind,p_sale_price_rub:Math.round(Number($('#benefitProductPrice').value)),p_face_value_rub:kind==='certificate'?Math.round(Number($('#benefitProductValue').value)):0,p_visits_count:kind==='certificate'?0:visits,p_validity_days:Math.round(Number($('#benefitProductValidity').value)),p_services:services},event.submitter,'Продукт сохранён','#benefitProductError');
        if(ok){event.target.reset();renderProductServices();$('#benefitProductCreator').open=false;}return;
      }
      if(event.target.id==='benefitIssueForm'){event.preventDefault();await issueBenefit(event);return;}
      if(event.target.id==='benefitApplyForm'){event.preventDefault();const ok=await mutate('apply_minuta_benefit',{p_organization:organization.id,p_instrument:$('#benefitApplyInstrument').value,p_booking:$('#benefitApplyBooking').value,p_action:'reserve',p_amount_rub:$('#benefitApplyAmount').value?Math.round(Number($('#benefitApplyAmount').value)):null},event.submitter,'Продукт применён к записи','#benefitApplyError');if(ok)$('#benefitApplyCreator').open=false;}
    }
    async function click(event) {
      if(event.target.closest('#benefitIssueNew')){newIssue();return;}
      if(event.target.closest('#reloadBenefits')){await load();return;}
      const status=event.target.closest('[data-benefit-status]');if(status)await mutate('set_minuta_benefit_status',{p_organization:organization.id,p_instrument:status.dataset.benefitInstrument,p_status:status.dataset.benefitStatus},status,'Статус обновлён');
      const action=event.target.closest('[data-benefit-action]');if(action){const redemption=payload.redemptions.find(item=>item.id===action.dataset.benefitRedemption);if(redemption)await mutate('apply_minuta_benefit',{p_organization:organization.id,p_instrument:redemption.instrument_id,p_booking:redemption.booking_id,p_action:action.dataset.benefitAction,p_amount_rub:null},action,action.dataset.benefitAction==='redeem'?'Посещение погашено':'Баланс восстановлен');}
    }
    async function change(event) {
      if(event.target.id==='benefitsEnabled'){const desired=event.target.checked;const ok=await mutate('set_minuta_benefits_enabled',{p_organization:organization.id,p_enabled:desired},event.target,desired?'Абонементы включены':'Абонементы выключены');if(!ok&&payload)event.target.checked=Boolean(payload.enabled);}
      if(event.target.id==='benefitProductKind')renderProductServices();
      if(event.target.id==='benefitApplyInstrument')renderBookingOptions();
      if(event.target.closest('#benefitIssueForm')&&issueIntent)renderIssueRecovery();
    }
    function invalid(event){
      if(!event.target.closest('#benefitsPanel'))return;
      const holders={benefitProductForm:'#benefitProductError',benefitIssueForm:'#benefitIssueError',benefitApplyForm:'#benefitApplyError'};
      const holder=holders[event.target.form?.id];if(!holder)return;
      const messages={benefitProductName:'Введите название продукта. Серый текст является только примером.',benefitProductPrice:'Укажите цену продажи.',benefitProductValidity:'Укажите срок действия от 1 дня.',benefitProductVisits:'Укажите количество посещений.',benefitProductValue:'Укажите номинал сертификата.',benefitIssueProduct:'Сначала создайте продукт.',benefitIssueClient:'Выберите клиента, у которого уже есть запись.',benefitIssueExpiry:'Выберите будущую дату или оставьте поле пустым.',benefitApplyInstrument:'Сначала выдайте продукт клиенту.',benefitApplyBooking:'У выбранного клиента нет подходящей записи.',benefitApplyAmount:'Укажите положительную сумму сертификата или оставьте поле пустым для автоматического расчёта.'};
      showFormError(holder,messages[event.target.id]||'Заполните обязательное поле и проверьте введённое значение.');
    }
    function input(event){if(event.target.id==='benefitInstrumentSearch')filterInstruments();const holder=event.target.form?.querySelector('.form-error');if(holder&&!holder.hidden){holder.hidden=true;holder.textContent='';}}
    function bind(){document.addEventListener('submit',submit);document.addEventListener('click',click);document.addEventListener('change',change);document.addEventListener('invalid',invalid,true);document.addEventListener('input',input);}
    return {bind,load,reset,setOrganization,get availability(){return availability;},get payload(){return payload;}};
  }
  window.MinutaBenefits={createController};
})();
