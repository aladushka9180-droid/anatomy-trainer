(function () {
  'use strict';

  const unitLabels = { piece:'шт.', ml:'мл', g:'г', kg:'кг', l:'л', pack:'упак.' };
  const movementLabels = { receipt:'Приход', write_off:'Списание', inventory:'Инвентаризация', service_use:'Завершённый визит' };

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
    // Private, controller-lifetime recovery only; not durable across page reload.
    // Keep unresolved scopes separate, including across reset/org round trips.
    const movementIntents = new Map();
    let movementOperation = null;
    let movementErrorScope = null;
    let movementReadRecovery = null;

    function unsupported(error) { return /PGRST202|42883|get_minuta_inventory_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`); }
    function scopeMatches(data, id) { return Boolean(data && String(data.organization_id || '') === String(id)); }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }
    function quantity(value) { return new Intl.NumberFormat('ru-RU', { maximumFractionDigits:3 }).format(Number(value || 0)); }
    function item(id) { return payload?.items?.find(row => row.id === id); }
    function warehouse(id) { return payload?.warehouses?.find(row => row.id === id); }
    function location(id) { return payload?.locations?.find(row => row.id === id); }
    function service(id) { return payload?.services?.find(row => row.id === id); }
    function optionRows(rows, label) { return rows.map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(label(row))}</option>`).join(''); }
    function requestId() {
      if (crypto.randomUUID) return crypto.randomUUID();
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    }

    function setBusy(value) {
      $('#inventoryPanel')?.querySelectorAll('[data-inventory-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.inventoryBusy = 'true'; }
        else if (!value && control.dataset.inventoryBusy === 'true') { control.disabled = false; delete control.dataset.inventoryBusy; }
      });
    }

    function reset() {
      revision += 1; organization = null; payload = null; availability = null; writing = false; pendingOrganization = undefined; movementOperation = null;
      movementErrorScope = null; $('#inventoryMovementError').hidden = true; $('#inventoryMovementError').textContent = '';
      movementReadRecovery = null;
      $('#inventoryPanel').hidden = true; $('#inventoryLoading').hidden = true; $('#inventoryUnavailable').hidden = true; $('#inventoryWorkspace').hidden = true;
    }

    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (movementOperation && sessionIsCurrent(movementOperation.userId, movementOperation.generation)
        && normalized?.id === organization?.id && normalized?.current_role === organization?.current_role)
        return { ok:false, optional:true, pending:true };
      if (writing) { pendingOrganization = normalized; revision += 1; $('#inventoryPanel').hidden = !normalized; $('#inventoryWorkspace').hidden = true; return { ok:false, optional:true, pending:true }; }
      if (!normalized) { reset(); return { ok:false, optional:true }; }
      if (!['owner', 'admin'].includes(normalized.current_role)) { reset(); return { ok:false, optional:true, forbidden:true }; }
      organization = normalized; pendingOrganization = undefined; return load();
    }

    async function load({ movementRecovery = null } = {}) {
      if (writing) return { ok:false, optional:true, pending:true };
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization?.id, current = ++revision;
      if (!userId || !organizationId) { reset(); return { ok:false, optional:true }; }
      const scope = movementScope();
      if (movementReadRecovery?.scope !== scope) movementReadRecovery = null;
      if (movementRecovery) movementReadRecovery = { ...movementRecovery, scope };
      const recovery = movementReadRecovery || (movementIntents.has(scope) ? {
        preserve:true, message:'Результат движения ещё не подтверждён, и журнал не удалось обновить. Нажмите «Повторить» для чтения склада; новая операция не отправляется.'
      } : null);
      const readIsCurrent = () => sessionIsCurrent(userId, generation) && current === revision && organization?.id === organizationId;
      const readFailed = () => {
        availability = 'error'; $('#inventoryLoading').hidden = true; $('#inventoryUnavailable').hidden = false;
        $('#inventoryUnavailableText').textContent = recovery.message;
        if (recovery.notifyFailure) notify(recovery.message);
        return { ok:false, optional:true };
      };
      if (movementErrorScope && movementErrorScope !== movementScope()) {
        movementErrorScope = null; $('#inventoryMovementError').hidden = true; $('#inventoryMovementError').textContent = '';
      }
      availability = 'loading'; payload = null; $('#inventoryPanel').hidden = false; $('#inventoryLoading').hidden = false; $('#inventoryUnavailable').hidden = true; $('#inventoryWorkspace').hidden = true;
      let result;
      try { result = await db.rpc('get_minuta_inventory_workspace', { p_organization:organizationId }); }
      catch (error) {
        if (!readIsCurrent()) return { ok:false, optional:true, stale:true };
        if (recovery) return readFailed();
        throw error;
      }
      if (!readIsCurrent()) return { ok:false, optional:true, stale:true };
      const { data, error } = result || {};
      $('#inventoryLoading').hidden = true;
      if (recovery && (error || !scopeMatches(data, organizationId))) return readFailed();
      if (error) {
        availability = unsupported(error) ? 'unsupported' : 'error';
        if (availability === 'unsupported') { $('#inventoryPanel').hidden = true; return { ok:false, optional:true, unsupported:true }; }
        $('#inventoryUnavailable').hidden = false; $('#inventoryUnavailableText').textContent = 'Записи клиентов не затронуты. Не удалось загрузить только склад.';
        return { ok:false, optional:true };
      }
      if (!scopeMatches(data, organizationId)) { availability = 'error'; $('#inventoryUnavailable').hidden = false; $('#inventoryUnavailableText').textContent = 'Сервер вернул данные другой организации. Изменения заблокированы.'; return { ok:false, optional:true }; }
      payload = data;
      for (const key of ['locations', 'services', 'items', 'warehouses', 'balances', 'usage', 'movements', 'audit']) if (!Array.isArray(payload[key])) payload[key] = [];
      // Read reconciliation must not change the pending intent or overwrite
      // edits made while this read was in flight. Capture immediately at render.
      const fields = ['Warehouse', 'Item', 'Kind', 'Quantity', 'Reason'];
      const draft = recovery?.preserve ? fields.map(name => [name, $('#inventoryMovement' + name).value]) : null;
      const counted = draft ? $('#inventoryCountedQuantity').value : null;
      availability = 'ready'; render();
      if (draft) {
        for (const [name, value] of draft) $('#inventoryMovement' + name).value = value;
        $('#inventoryCountedQuantity').value = counted; updateMovementKind();
      }
      movementReadRecovery = null;
      return { ok:true, optional:true };
    }

    function balanceFor(warehouseId, itemId) { return Number(payload.balances.find(row => row.warehouse_id === warehouseId && row.inventory_item_id === itemId)?.quantity || 0); }
    function totalFor(itemId) { return payload.balances.filter(row => row.inventory_item_id === itemId).reduce((sum, row) => sum + Number(row.quantity || 0), 0); }

    function itemCard(row) {
      const total = totalFor(row.id), low = row.active && total <= Number(row.low_stock_threshold || 0);
      return `<article class="organization-row ${low ? 'inventory-low' : ''}"><div class="organization-row-main"><strong>${escapeHtml(row.name)} · ${escapeHtml(quantity(total))} ${escapeHtml(unitLabels[row.unit] || row.unit)}</strong><small>${row.sku ? `Артикул ${escapeHtml(row.sku)} · ` : ''}минимум ${escapeHtml(quantity(row.low_stock_threshold))} ${escapeHtml(unitLabels[row.unit] || row.unit)}</small></div><span class="organization-tags"><span class="organization-status ${row.active ? 'is-active' : ''}">${low ? 'Мало' : row.active ? 'Активен' : 'Скрыт'}</span><button class="secondary-button" type="button" data-inventory-edit-item="${escapeHtml(row.id)}" data-inventory-write>Изменить</button></span></article>`;
    }

    function warehouseCard(row) {
      const stocks = payload.balances.filter(balance => balance.warehouse_id === row.id && Number(balance.quantity) > 0).length;
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(location(row.location_id)?.name || 'Филиал')} · ${stocks} позиций с остатком</small></div><span class="organization-tags"><span class="organization-status ${row.active ? 'is-active' : ''}">${row.active ? 'Активен' : 'Закрыт'}</span><button class="secondary-button" type="button" data-inventory-edit-warehouse="${escapeHtml(row.id)}" data-inventory-write>Изменить</button></span></article>`;
    }

    function balanceCard(row) {
      const warehouseItems = payload.items.filter(entry => entry.active || balanceFor(row.id, entry.id) > 0);
      return `<article class="inventory-balance-card"><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(location(row.location_id)?.name || 'Филиал')}</small></div><ul>${warehouseItems.length ? warehouseItems.map(entry => { const value = balanceFor(row.id, entry.id); return `<li class="${value <= Number(entry.low_stock_threshold || 0) ? 'is-low' : ''}"><span>${escapeHtml(entry.name)}</span><b>${escapeHtml(quantity(value))} ${escapeHtml(unitLabels[entry.unit] || entry.unit)}</b></li>`; }).join('') : '<li><span>Остатков пока нет</span></li>'}</ul></article>`;
    }

    function usageCard(row) {
      const inventoryItem = item(row.inventory_item_id);
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(service(row.service_id)?.name || 'Услуга')}</strong><small>${escapeHtml(inventoryItem?.name || 'Материал')} · ${escapeHtml(quantity(row.quantity))} ${escapeHtml(unitLabels[inventoryItem?.unit] || '')} за визит</small></div><button class="secondary-button" type="button" data-inventory-delete-usage="${escapeHtml(row.service_id)}" data-inventory-item="${escapeHtml(row.inventory_item_id)}" data-inventory-write>Удалить</button></article>`;
    }

    function movementCard(row) {
      const inventoryItem = item(row.inventory_item_id), delta = Number(row.quantity_delta || 0);
      const date = new Date(row.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<article class="organization-audit-row"><span></span><div><strong>${escapeHtml(movementLabels[row.movement_type] || row.movement_type)} · ${escapeHtml(inventoryItem?.name || 'Материал')}</strong><small>${escapeHtml(warehouse(row.warehouse_id)?.name || 'Склад')} · ${delta > 0 ? '+' : ''}${escapeHtml(quantity(delta))} ${escapeHtml(unitLabels[inventoryItem?.unit] || '')} · остаток ${escapeHtml(quantity(row.quantity_after))}${row.reason ? ` · ${escapeHtml(row.reason)}` : ''}</small></div><time>${escapeHtml(date)}</time></article>`;
    }

    function render() {
      if (availability !== 'ready' || !payload) return;
      const enabled = Boolean(payload.enabled), isOwner = payload.current_role === 'owner';
      $('#inventoryWorkspace').hidden = false; $('#inventoryUnavailable').hidden = true;
      $('#inventoryEnabled').checked = enabled; $('#inventoryEnabled').disabled = !isOwner;
      $('#inventoryAutoDeduct').checked = Boolean(payload.auto_deduct_completed_visits); $('#inventoryAutoDeduct').disabled = !isOwner || !enabled;
      $('#inventoryEnabledHint').textContent = isOwner ? 'По умолчанию выключено. Включение не списывает старые визиты.' : 'Включить или выключить склад может только владелец.';
      $('#inventoryItemsCount').textContent = String(payload.items.length); $('#inventoryWarehousesCount').textContent = String(payload.warehouses.length); $('#inventoryMovementsCount').textContent = String(payload.movements.length);
      $('#inventoryItemsList').innerHTML = payload.items.length ? payload.items.map(itemCard).join('') : empty('Товаров и материалов пока нет', 'Добавьте первую складскую позицию.');
      $('#inventoryWarehousesList').innerHTML = payload.warehouses.length ? payload.warehouses.map(warehouseCard).join('') : empty('Склады не созданы', 'Создайте по одному складу для нужных филиалов.');
      $('#inventoryBalances').innerHTML = payload.warehouses.filter(row => row.active).length ? payload.warehouses.filter(row => row.active).map(balanceCard).join('') : empty('Нет активных складов', 'Создайте склад филиала, затем оформите приход.');
      $('#inventoryUsageList').innerHTML = payload.usage.length ? payload.usage.map(usageCard).join('') : empty('Нормы не настроены', 'Добавьте расход материала на одну завершённую услугу.');
      $('#inventoryMovementsList').innerHTML = payload.movements.length ? payload.movements.map(movementCard).join('') : empty('Движений пока нет', 'Приходы, списания и инвентаризации появятся здесь.');
      $('#inventoryControls').hidden = !enabled;
      const activeItems = payload.items.filter(row => row.active), activeWarehouses = payload.warehouses.filter(row => row.active), activeServices = payload.services.filter(row => row.active !== false);
      $('#inventoryMovementWarehouse').innerHTML = optionRows(activeWarehouses, row => `${row.name} · ${location(row.location_id)?.name || 'Филиал'}`);
      $('#inventoryMovementItem').innerHTML = optionRows(activeItems, row => `${row.name} · ${unitLabels[row.unit] || row.unit}`);
      $('#inventoryUsageService').innerHTML = optionRows(activeServices, row => row.name);
      $('#inventoryUsageItem').innerHTML = optionRows(activeItems, row => `${row.name} · ${unitLabels[row.unit] || row.unit}`);
      $('#inventoryWarehouseLocation').innerHTML = optionRows(payload.locations.filter(row => row.active), row => row.name);
      updateMovementKind(); setBusy(false); applyWriteAvailability();
    }

    function messageFor(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      const rows = [['inventory_disabled','Сначала включите складской учёт.'],['inventory_owner_required','Изменить режим склада может только владелец.'],['insufficient_inventory_stock','Недостаточно остатка для списания.'],['inventory_reason_required','Для списания или инвентаризации укажите причину.'],['inventory_target_inactive','Выберите активный склад и материал.'],['inventory_request_conflict','Операция была изменена после отправки. Обновите данные.'],['inventory_unit_locked_by_ledger','Нельзя менять единицу позиции после первого движения. Создайте новую позицию.'],['inventory_warehouse_location_locked_by_ledger','Нельзя переносить склад с историей в другой филиал. Создайте новый склад.'],['inventory_warehouse_missing_for_location','Для филиала записи не создан активный склад.'],['insufficient_inventory_stock_for_completed_visit','На складе недостаточно материалов для завершения визита.'],['duplicate key','Для филиала уже создан склад или артикул занят.']];
      return rows.find(([key]) => text.includes(key))?.[1] || 'Изменение не сохранено. Записи и остатки не изменены.';
    }

    async function mutate(rpc, parameters, button, success, errorHolder) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return false;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id, current = ++revision;
      writing = true; setBusy(true); if (errorHolder) { $(errorHolder).hidden = true; $(errorHolder).textContent = ''; }
      const old = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const { data, error } = await db.rpc(rpc, parameters);
      if (button) button.textContent = old;
      const stale = !sessionIsCurrent(userId, generation) || current !== revision || organization?.id !== organizationId; writing = false;
      if (stale) { const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return false; }
      if (error) { const message = messageFor(error); if (errorHolder) { $(errorHolder).textContent = message; $(errorHolder).hidden = false; } else notify(message); await load(); return false; }
      if (!scopeMatches(data, organizationId)) { notify('Ответ другой организации заблокирован.'); await load(); return false; }
      notify(success); await load(); return true;
    }

    function updateMovementKind() {
      const inventory = $('#inventoryMovementKind')?.value === 'inventory';
      if ($('#inventoryMovementQuantityField')) $('#inventoryMovementQuantityField').hidden = inventory;
      if ($('#inventoryCountedQuantityField')) $('#inventoryCountedQuantityField').hidden = !inventory;
      if ($('#inventoryMovementReason')) $('#inventoryMovementReason').required = inventory || $('#inventoryMovementKind').value === 'write_off';
    }

    function clearItemForm() { $('#inventoryItemId').value = ''; $('#inventoryItemForm').reset(); $('#inventoryItemActive').checked = true; $('#inventoryItemCreator').open = false; }
    function clearWarehouseForm() { $('#inventoryWarehouseId').value = ''; $('#inventoryWarehouseForm').reset(); $('#inventoryWarehouseActive').checked = true; $('#inventoryWarehouseCreator').open = false; }

    function movementScope() { return JSON.stringify([getCurrentUser()?.id || '', organization?.id || '']); }
    function movementParameters() {
      const kind = $('#inventoryMovementKind').value;
      return { p_organization:organization?.id, p_warehouse:$('#inventoryMovementWarehouse').value,
        p_item:$('#inventoryMovementItem').value, p_kind:kind,
        p_quantity:kind === 'inventory' ? null : Number($('#inventoryMovementQuantity').value),
        p_counted_quantity:kind === 'inventory' ? Number($('#inventoryCountedQuantity').value) : null,
        p_reason:$('#inventoryMovementReason').value.trim() };
    }
    function sameMovement(left, right) {
      return Object.keys(left).every(key => key === 'p_request_id' || left[key] === right[key]);
    }
    function movementError(message, intent = null) {
      const holder = $('#inventoryMovementError');
      movementErrorScope = movementScope();
      holder.hidden = false;
      if (!intent) { holder.textContent = message; return; }
      const original = intent.parameters;
      const summary = `${movementLabels[original.p_kind]} · ${intent.itemName} · ${intent.warehouseName} · ${quantity(original.p_kind === 'inventory' ? original.p_counted_quantity : original.p_quantity)} · ${original.p_reason}`;
      holder.innerHTML = `${escapeHtml(message)} ${escapeHtml(summary)} <button type="button" data-inventory-restore-movement>Вернуть исходные поля</button>`;
    }
    function validMovementAcknowledgement(data, organizationId) {
      return data && !Array.isArray(data) && typeof data === 'object' && data.organization_id === organizationId
        && Number.isSafeInteger(data.id) && data.id > 0
        && typeof data.quantity_after === 'number' && Number.isFinite(data.quantity_after)
        && data.quantity_after >= 0 && data.quantity_after <= 99999999999.999
        && /^\d+(?:\.\d{1,3})?$/.test(String(data.quantity_after));
    }
    function definiteMovementRefusal(error) {
      const codes = {
        '42501':['authentication_required', 'inventory_management_denied'],
        '55000':['inventory_disabled', 'inventory_target_inactive', 'insufficient_inventory_stock'],
        '22023':['inventory_request_id_required', 'invalid_inventory_movement', 'invalid_inventory_count', 'invalid_inventory_quantity', 'inventory_reason_required'],
        '23505':['inventory_request_conflict']
      };
      return Boolean(error && codes[error.code]?.includes(error.message));
    }
    async function submitMovement(event) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id;
      if (!userId) return;
      const scope = movementScope(), parameters = movementParameters();
      let intent = movementIntents.get(scope);
      if (intent && !sameMovement(intent.parameters, parameters)) {
        movementError('Результат исходной операции ещё не подтверждён. Изменённые данные не отправлены. Восстановите поля для проверки тем же запросом.', intent);
        return;
      }
      if (!intent) {
        intent = { parameters:Object.freeze({ ...parameters, p_request_id:requestId() }), ambiguous:false,
          itemName:item(parameters.p_item)?.name || parameters.p_item,
          warehouseName:warehouse(parameters.p_warehouse)?.name || parameters.p_warehouse };
        movementIntents.set(scope, intent);
      }
      const current = ++revision, token = { userId, generation };
      movementOperation = token; writing = true; setBusy(true);
      const button = event.submitter, oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      $('#inventoryMovementError').hidden = true; $('#inventoryMovementError').textContent = '';
      const isCurrent = () => movementOperation === token && sessionIsCurrent(userId, generation)
        && organization?.id === organizationId && revision === current && movementIntents.get(scope) === intent;
      let acknowledged = false;
      try {
        const result = await db.rpc('apply_minuta_stock_movement', { ...intent.parameters });
        if (!isCurrent()) { intent.ambiguous = true; return; }
        if (result?.error) {
          // A refusal of a replay cannot disprove an earlier unknown commit:
          // v82 enabled/target checks run BEFORE its request-key lookup.
          if (!intent.ambiguous && definiteMovementRefusal(result.error)) {
            movementIntents.delete(scope);
            movementError('Сервер отклонил эту операцию. ' + messageFor(result.error));
          } else {
            intent.ambiguous = true;
            movementError('Не удалось подтвердить движение. Остаток мог измениться. Проверьте журнал; повтор исходных данных использует тот же запрос.');
          }
          return;
        }
        if (!result || result.error !== null || !validMovementAcknowledgement(result.data, organizationId)) {
          intent.ambiguous = true;
          movementError('Сервер не вернул подтверждение движения. Остаток мог измениться. Повтор исходных данных использует тот же запрос.');
          return;
        }
        acknowledged = true;
        movementIntents.delete(scope);
        event.target.reset(); updateMovementKind();
        notify(movementLabels[intent.parameters.p_kind] + ' сохранён');
      } catch {
        if (!isCurrent()) { intent.ambiguous = true; return; }
        intent.ambiguous = true;
        movementError('Не удалось подтвердить движение. Остаток мог измениться. Повтор исходных данных использует тот же запрос.');
      } finally {
        // Only this operation may release its busy state; reset/new context can
        // already own a different write. Other inventory mutation paths unchanged.
        if (movementOperation === token) {
          movementOperation = null; writing = false;
          if (sessionIsCurrent(userId, generation) && organization?.id === organizationId && revision === current) {
            if (button) button.textContent = oldText;
            setBusy(false); applyWriteAvailability();
          }
          const next = pendingOrganization; pendingOrganization = undefined;
          if (next !== undefined) {
            // The queued organization owns its load/error UI, not the old form.
            const queuedRevision = revision;
            try { await setOrganization(next); }
            catch {
              if (sessionIsCurrent(userId, generation) && organization?.id === next?.id && revision === queuedRevision + 1 && movementOperation === null) {
                availability = 'error'; $('#inventoryLoading').hidden = true; $('#inventoryUnavailable').hidden = false;
                $('#inventoryUnavailableText').textContent = 'Не удалось загрузить склад выбранной организации. Обновите склад.';
              }
            }
          }
          else if (sessionIsCurrent(userId, generation) && organization?.id === organizationId && revision === current) {
            await load({ movementRecovery:{ preserve:!acknowledged, notifyFailure:acknowledged,
              message:acknowledged
                ? 'Движение сохранено, но обновление журнала не подтверждено. Нажмите «Повторить» для чтения склада.'
                : movementIntents.has(scope)
                  ? 'Результат движения ещё не подтверждён, и журнал не удалось обновить. Нажмите «Повторить» для чтения склада; новая операция не отправляется.'
                  : 'Сервер отклонил движение, но журнал не удалось обновить. Нажмите «Повторить» для чтения склада; новая операция не отправляется.' } });
          }
        }
      }
    }

    async function submit(event) {
      if (!event.target.closest('#inventoryPanel')) return;
      if (event.target.id === 'inventoryItemForm') {
        event.preventDefault(); const ok = await mutate('upsert_minuta_inventory_item', { p_organization:organization.id,p_item:$('#inventoryItemId').value || null,p_name:$('#inventoryItemName').value.trim(),p_sku:$('#inventoryItemSku').value.trim(),p_unit:$('#inventoryItemUnit').value,p_low_stock:Number($('#inventoryItemLow').value || 0),p_active:$('#inventoryItemActive').checked }, event.submitter, 'Складская позиция сохранена', '#inventoryItemError'); if (ok) clearItemForm(); return;
      }
      if (event.target.id === 'inventoryWarehouseForm') {
        event.preventDefault(); const ok = await mutate('upsert_minuta_inventory_warehouse', { p_organization:organization.id,p_warehouse:$('#inventoryWarehouseId').value || null,p_location:$('#inventoryWarehouseLocation').value,p_name:$('#inventoryWarehouseName').value.trim(),p_active:$('#inventoryWarehouseActive').checked }, event.submitter, 'Склад сохранён', '#inventoryWarehouseError'); if (ok) clearWarehouseForm(); return;
      }
      if (event.target.id === 'inventoryMovementForm') {
        event.preventDefault(); await submitMovement(event); return;
      }
      if (event.target.id === 'inventoryUsageForm') {
        event.preventDefault(); const ok = await mutate('set_minuta_inventory_service_usage', { p_organization:organization.id,p_service:$('#inventoryUsageService').value,p_item:$('#inventoryUsageItem').value,p_quantity:Number($('#inventoryUsageQuantity').value) }, event.submitter, 'Норма расхода сохранена', '#inventoryUsageError'); if (ok) event.target.reset();
      }
    }

    async function click(event) {
      if (event.target.closest('[data-inventory-restore-movement]')) {
        const intent = movementIntents.get(movementScope());
        if (!intent || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return;
        const original = intent.parameters;
        $('#inventoryMovementWarehouse').value = original.p_warehouse; $('#inventoryMovementItem').value = original.p_item;
        $('#inventoryMovementKind').value = original.p_kind; $('#inventoryMovementQuantity').value = original.p_quantity ?? '';
        $('#inventoryCountedQuantity').value = original.p_counted_quantity ?? '0'; $('#inventoryMovementReason').value = original.p_reason;
        updateMovementKind();
        movementError(sameMovement(original, movementParameters())
          ? 'Исходные поля восстановлены. Повтор использует тот же запрос, без новой операции.'
          : 'Исходный склад или материал недоступен. Проверьте журнал; изменённые данные не отправлены.');
        return;
      }
      if (event.target.closest('#reloadInventory')) { await load(); return; }
      const editItem = event.target.closest('[data-inventory-edit-item]');
      if (editItem) { const row = item(editItem.dataset.inventoryEditItem); if (!row) return; $('#inventoryItemId').value=row.id; $('#inventoryItemName').value=row.name; $('#inventoryItemSku').value=row.sku || ''; $('#inventoryItemUnit').value=row.unit; $('#inventoryItemLow').value=row.low_stock_threshold; $('#inventoryItemActive').checked=Boolean(row.active); $('#inventoryItemCreator').open=true; $('#inventoryItemName').focus(); return; }
      const editWarehouse = event.target.closest('[data-inventory-edit-warehouse]');
      if (editWarehouse) { const row=warehouse(editWarehouse.dataset.inventoryEditWarehouse); if (!row) return; $('#inventoryWarehouseId').value=row.id; $('#inventoryWarehouseLocation').value=row.location_id; $('#inventoryWarehouseName').value=row.name; $('#inventoryWarehouseActive').checked=Boolean(row.active); $('#inventoryWarehouseCreator').open=true; $('#inventoryWarehouseName').focus(); return; }
      if (event.target.closest('[data-inventory-cancel-item]')) { clearItemForm(); return; }
      if (event.target.closest('[data-inventory-cancel-warehouse]')) { clearWarehouseForm(); return; }
      const remove = event.target.closest('[data-inventory-delete-usage]');
      if (remove) await mutate('set_minuta_inventory_service_usage', { p_organization:organization.id,p_service:remove.dataset.inventoryDeleteUsage,p_item:remove.dataset.inventoryItem,p_quantity:0 }, remove, 'Норма расхода удалена');
    }

    async function change(event) {
      if (event.target.id === 'inventoryEnabled' || event.target.id === 'inventoryAutoDeduct') {
        const enabled = $('#inventoryEnabled').checked, automatic = $('#inventoryAutoDeduct').checked;
        const ok = await mutate('set_minuta_inventory_settings', { p_organization:organization.id,p_enabled:enabled,p_auto_deduct:automatic }, event.target, enabled ? 'Складской учёт включён' : 'Складской учёт выключен');
        if (!ok && payload) { $('#inventoryEnabled').checked=Boolean(payload.enabled); $('#inventoryAutoDeduct').checked=Boolean(payload.auto_deduct_completed_visits); }
      }
      if (event.target.id === 'inventoryMovementKind') updateMovementKind();
    }

    function bind() { document.addEventListener('submit', submit); document.addEventListener('click', click); document.addEventListener('change', change); }
    return { bind, load, reset, setOrganization, get availability() { return availability; }, get payload() { return payload; } };
  }

  window.MinutaInventory = { createController };
})();
