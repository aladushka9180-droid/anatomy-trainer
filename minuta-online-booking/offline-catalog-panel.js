(function () {
  'use strict';

  const kinds={ service:'Услуга', inventory:'Материал или товар' };
  const units={ piece:'шт.', ml:'мл', g:'г', kg:'кг', l:'л', pack:'уп.' };
  const statuses={ local:'На этом устройстве', checking:'Проверяется на сервере',
    conflict:'Конфликт — проверьте актуальные данные', applied:'Подтверждено сервером' };

  function element(tag,text,attributes={}) {
    const node=document.createElement(tag);
    if (text!=null) node.textContent=text;
    for (const [name,value] of Object.entries(attributes)) node.setAttribute(name,value);
    return node;
  }
  function field(form,label,name,type='text',attributes={}) {
    const wrapper=element('label',label);
    const input=element('input',null,{ name,type,...attributes });
    wrapper.append(input);
    form.append(wrapper);
    return input;
  }
  function select(form,label,name,options) {
    const wrapper=element('label',label);
    const input=element('select',null,{ name });
    for (const [value,text] of options) input.append(element('option',text,{ value }));
    wrapper.append(input);
    form.append(wrapper);
    return input;
  }
  function mount({ root,userId,organizationId,catalog=[],drafts,rpc,isCurrent,
    canSend=()=>true,onSelectExisting=null,loadInventory=null }) {
    if (!root || !drafts || typeof isCurrent!=='function') throw new Error('catalog_panel_context_invalid');
    const own=()=>isCurrent(userId,organizationId);
    let rows=catalog.filter(item=>item?.organizationId===organizationId
      && kinds[item.kind] && item.id && item.name);
    const panel=element('section',null,{ class:'offline-catalog-panel',
      'aria-label':'Локальные черновики каталога' });
    panel.append(element('h3','Черновики каталога'));
    panel.append(element('p','Сохраняются только на этом устройстве. Другие сотрудники увидят изменения после подтверждения сервером. Фото, расписание и остатки здесь не меняются.'));
    const loadMaterials=element('button','Обновить материалы для черновика',
      { type:'button',class:'secondary-button compact-button' });
    loadMaterials.disabled=!navigator.onLine || typeof loadInventory!=='function' || !canSend();
    panel.append(loadMaterials);
    const form=element('form',null,{ class:'offline-catalog-panel-form' });
    const kind=select(form,'Что добавить или изменить','kind',Object.entries(kinds));
    const target=select(form,'Действие','target',[]);
    const name=field(form,'Название','name','text',{ required:'',minlength:'2',maxlength:'120' });
    const duration=field(form,'Длительность, минут','duration','number',{ min:'1',max:'480',step:'1' });
    const price=field(form,'Цена, ₽','price','number',{ min:'0',max:'1000000',step:'1' });
    const sku=field(form,'Артикул','sku','text',{ maxlength:'80' });
    const unit=select(form,'Единица','unit',Object.entries(units));
    const lowStock=field(form,'Порог низкого остатка','lowStock','number',
      { min:'0',max:'99999999999',step:'0.001' });
    const active=element('input',null,{ type:'checkbox',name:'active' });
    active.checked=true;
    const activeLabel=element('label','Активно'); activeLabel.prepend(active); form.append(activeLabel);
    const save=element('button','Сохранить на этом устройстве',
      { type:'submit',class:'primary' }); form.append(save);
    const message=element('p',null,{ role:'status','aria-live':'polite' });
    const list=element('div',null,{ class:'offline-catalog-panel-list' });
    panel.append(form,message,list);
    root.append(panel);
    let selectedSnapshot=null;
    async function restoreInventory() {
      const snapshots=await drafts.listVersionSnapshots(userId,organizationId,'inventory');
      if (!own()) return;
      rows=rows.filter(item=>item.kind!=='inventory').concat(snapshots.map(item=>({
        kind:'inventory',id:item.entityId,organizationId,name:item.fields.name,fields:item.fields
      })));
      if (kind.value==='inventory') refreshTarget();
    }
    function refreshTarget() {
      target.replaceChildren(element('option','Новый элемент',{ value:'' }));
      for (const item of rows.filter(item=>item.kind===kind.value))
        target.append(element('option',item.name,{ value:item.id }));
      refreshFields();
    }
    function refreshFields() {
      selectedSnapshot=null;
      const item=rows.find(row=>row.kind===kind.value && row.id===target.value);
      applyValues({name:item?.name || '',...(item?.fields || {})});
      for (const input of [duration,price]) input.parentElement.hidden=kind.value!=='service';
      for (const input of [sku,unit,lowStock]) input.parentElement.hidden=kind.value!=='inventory';
    }
    function applyValues(values) {
      name.value=values.name || '';
      duration.value=values.durationMinutes ?? 60;
      price.value=values.priceRub ?? 0;
      sku.value=values.sku ?? '';
      unit.value=values.unit ?? 'piece';
      lowStock.value=values.lowStock ?? 0;
      active.checked=values.active ?? true;
    }
    async function render() {
      if (!own()) { panel.remove(); return; }
      loadMaterials.disabled=!navigator.onLine || typeof loadInventory!=='function' || !canSend();
      const { drafts:items,invalidCount }=await drafts.list(userId,organizationId);
      list.replaceChildren();
      if (invalidCount) list.append(element('p','Есть повреждённые локальные данные. Сохранение новых черновиков остановлено.'));
      if (!items.length) list.append(element('p','Черновиков на этом устройстве нет.'));
      for (const item of items) {
        const card=element('div',null,{ class:'offline-catalog-panel-item' });
        card.append(element('strong',`${kinds[item.kind]}: ${item.fields.name}`));
        card.append(element('p',statuses[item.status] || 'Требуется проверка'));
        if (item.status==='conflict') card.append(element('p',
          'Сервер отклонил изменение или данные изменились. Этот черновик не применён.'));
        if (item.status==='local' || item.status==='checking') {
          const send=element('button','Проверить и отправить',
            { type:'button',class:'secondary-button compact-button' });
          send.disabled=!navigator.onLine || typeof rpc!=='function' || !canSend();
          send.addEventListener('click',async()=>{
            if (!own() || !canSend()) return;
            send.disabled=true; message.textContent='Проверяем черновик на сервере…';
            try {
              const outcome=await drafts.flushOne({ userId,organizationId,requestId:item.requestId,rpc,isCurrent });
              if (own()) message.textContent=outcome?.status==='applied'
                ? 'Изменение подтверждено сервером.' : 'Подтверждения нет. Черновик сохранён на устройстве.';
            } catch { if (own()) message.textContent='Не удалось проверить. Черновик остаётся на устройстве.'; }
            await render();
          });
          card.append(send);
        }
        list.append(card);
      }
    }
    kind.addEventListener('change',refreshTarget);
    loadMaterials.addEventListener('click',async()=>{
      if (!own() || !canSend() || typeof loadInventory!=='function') return;
      loadMaterials.disabled=true;
      message.textContent='Загружаем позиции каталога…';
      try {
        const loaded=await loadInventory();
        if (!own()) return;
        if (!loaded) throw new Error('catalog_inventory_unavailable');
        await restoreInventory();
        message.textContent='Поля и версии материалов сохранены на этом устройстве. Остатки не менялись.';
      } catch {
        if (own()) message.textContent='Не удалось обновить материалы. Сохранённые черновики не изменены.';
      } finally { loadMaterials.disabled=!navigator.onLine || !canSend(); }
    });
    target.addEventListener('change',async()=>{
      refreshFields();
      if (!target.value || !own()) return;
      const selectedKind=kind.value, selectedId=target.value;
      save.disabled=true;
      message.textContent='Проверяем актуальную версию…';
      try {
        let snapshot=null;
        if (navigator.onLine && typeof onSelectExisting==='function')
          snapshot=await onSelectExisting(selectedKind,selectedId);
        if (!snapshot) snapshot=await drafts.readVersionSnapshot(userId,organizationId,selectedKind,selectedId);
        if (!own() || kind.value!==selectedKind || target.value!==selectedId) return;
        selectedSnapshot=snapshot;
        if (snapshot) applyValues(snapshot.fields);
        message.textContent=snapshot ? 'Сохранённые поля загружены. При отправке сервер проверит изменения.'
          : 'Версия и поля недоступны. Изменение существующего элемента пока нельзя сохранить.';
      } catch {
        if (own()) message.textContent='Версия и поля недоступны. Изменение существующего элемента пока нельзя сохранить.';
      } finally { save.disabled=false; }
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!own()) return;
      save.disabled=true; message.textContent='Сохраняем на этом устройстве…';
      try {
        const entityId=target.value || null;
        const currentSnapshot=entityId
          ? await drafts.readVersionSnapshot(userId,organizationId,kind.value,entityId) : null;
        const expectedVersion=entityId && selectedSnapshot && currentSnapshot
          && selectedSnapshot.version===currentSnapshot.version
          ? currentSnapshot.version : null;
        if (entityId && !expectedVersion) throw new Error('catalog_version_missing');
        const values=kind.value==='service'
          ? { name:name.value,durationMinutes:Number(duration.value),priceRub:Number(price.value),active:active.checked }
          : { name:name.value,sku:sku.value,unit:unit.value,lowStock:Number(lowStock.value),active:active.checked };
        await drafts.queue({userId,organizationId,kind:kind.value,entityId,expectedVersion,values});
        if (own()) message.textContent='Черновик сохранён только на этом устройстве.';
        await render();
      } catch(error) {
        if (own()) message.textContent=error?.message==='catalog_version_missing'
          ? 'Для изменения нужно сначала загрузить актуальную версию с сервера.'
          : 'Не удалось сохранить черновик. Изменения не подтверждены.';
      } finally { save.disabled=false; }
    });
    refreshTarget();
    restoreInventory().catch(()=>{ message.textContent='Сохранённые материалы недоступны.'; });
    render().catch(()=>{ message.textContent='Локальное хранилище недоступно.'; });
    return { refresh:render,dispose:()=>panel.remove() };
  }
  window.MinutaOfflineCatalogPanel={ mount };
})();
