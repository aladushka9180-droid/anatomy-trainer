export function resourceUrl(file, base = import.meta.url) {
  const url = new URL(file, base), version = new URL(base).searchParams.get('v');
  if (version) url.searchParams.set('v', version);
  return url.href;
}
const { fallbackCatalogError, friendlyError, scaled, UNITS } = await import(resourceUrl('./commerce-catalog-data.js'));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const manager = role => ['owner', 'admin'].includes(role);
const scopeError = () => Object.assign(new Error('sales_catalog_scope_changed'), { code:'CATALOG_SCOPE_CHANGED' });
const safeMinor = value => Number.isSafeInteger(value) && value >= 0;
const validId = value => UUID.test(String(value || ''));

// SQL errors below have rolled the transaction back. A conflicting request may
// describe an earlier committed operation; it must remain unresolved.
export function definiteRollback(error) {
  return !String(error?.message || '').includes('catalog_request_conflict')
    && (error?.code === '23505' && error.message === 'catalog_sku_conflict'
      || ['22003','22023','23502','23503','23514','40001','42501','42883','55000','PGRST202'].includes(error?.code));
}

export function attestReceipt(intent, receipt, actorId) {
  if (!receipt || receipt.found !== true || !validId(receipt.id)
    || receipt.organization_id !== intent.p_organization || receipt.request_id !== intent.p_request_id
    || receipt.client_account_id !== (intent.p_client_account || null)
    || receipt.booking_id !== (intent.p_booking || null)
    || receipt.seller_id !== (intent.p_seller || actorId)
    || receipt.payment_method !== intent.p_payment_method || receipt.payment_account_id !== intent.p_payment_account
    || !safeMinor(receipt.total_minor) || receipt.total_minor <= 0 || !safeMinor(receipt.refunded_minor)
    || !Array.isArray(receipt.lines)) return false;
  const expected = (intent.p_lines || []).flatMap(line => line.bundle_id
    ? line.components.map((component, i) => ({ ...component, line_id:line.line_id + ':' + (i+1), warehouse_id:line.warehouse_id,
      bundle_id:line.bundle_id, bundle_version:line.bundle_version, discount_minor:0 }))
    : [{ ...line, bundle_id:null, bundle_version:null, discount_minor:line.discount_minor || 0 }]);
  if (expected.length !== receipt.lines.length) return false;
  const ids = new Set(); let total = 0;
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i], got = receipt.lines[i];
    if (!got || ids.has(got.sale_id) || !validId(got.sale_id) || got.line_id !== want.line_id
      || got.inventory_item_id !== want.inventory_item_id || got.warehouse_id !== want.warehouse_id
      || got.metadata_version !== want.metadata_version || got.unit_price_minor !== want.unit_price_minor
      || got.discount_minor !== want.discount_minor || (got.bundle_id || null) !== want.bundle_id
      || (got.bundle_version || null) !== want.bundle_version || !safeMinor(got.total_minor) || got.total_minor <= 0
      || scaled(got.sale_quantity) === null || scaled(got.sale_quantity) <= 0n
      || (!want.bundle_id && scaled(got.sale_quantity) !== scaled(want.quantity))) return false;
    ids.add(got.sale_id); total += got.total_minor;
  }
  return Number.isSafeInteger(total) && total === receipt.total_minor && receipt.refunded_minor <= total;
}

export function createCatalogRpcAdapter(options, getContext) {
  const { db, getCurrentUser, getSessionGeneration, sessionIsCurrent, requireWrites } = options;
  function scope() {
    return { orgId:getContext()?.organization?.id, actorId:getCurrentUser()?.id, sessionKey:String(getSessionGeneration()) };
  }
  function check(s, ownerOnly = false) {
    const current = scope(), ctx = getContext();
    if (!validId(s?.orgId) || !validId(s?.actorId) || s.orgId !== current.orgId || s.actorId !== current.actorId
      || s.sessionKey !== current.sessionKey || !sessionIsCurrent(s.actorId, getSessionGeneration())
      || ctx?.state?.organization_id !== s.orgId || !manager(ctx?.organization?.current_role)
      || ownerOnly && ctx.organization.current_role !== 'owner') throw scopeError();
    return ctx;
  }
  async function call(s, name, params, write = false, ownerOnly = false) {
    check(s, ownerOnly);
    if (write && !requireWrites()) return { error:{ code:'42501', message:'sales_catalog_write_unavailable' } };
    const result = await db.rpc(name, params);
    check(s, ownerOnly);
    return result;
  }
  async function mutation(s, requestId, name, params, attest) {
    if (!validId(requestId)) throw new Error('invalid_catalog_request');
    const result = await call(s, name, { ...params, p_request_id:requestId }, true, name === 'commit_minuta_sales_import_candidate');
    if (result.error) return definiteRollback(result.error)
      ? { rolledBack:true, requestId, organizationId:s.orgId, error:result.error }
      : { confirmed:false, error:result.error };
    return attest(result.data) ? { confirmed:true, requestId, organizationId:s.orgId, data:result.data }
      : { confirmed:false, error:{ message:'invalid_catalog_operation_response' } };
  }
  const itemResult = value => Array.isArray(value?.items) && value.items.length > 0
    && value.items.every(x => validId(x.inventory_item_id) && Number.isSafeInteger(x.metadata_version) && x.metadata_version > 0);
  async function sale({ scope:s, intent }) {
    if (intent.p_organization !== s.orgId || !validId(intent.p_request_id) || !Array.isArray(intent.p_lines)) throw scopeError();
    const result = await mutation(s, intent.p_request_id, 'sell_minuta_inventory_cart_candidate', intent,
      receipt => attestReceipt(intent, receipt, s.actorId));
    return result.confirmed ? { ...result, receipt:result.data } : result;
  }
  const api = {
    scope,
    async catalog(s = scope()) {
      const result = await call(s, 'get_minuta_sales_catalog_candidate', { p_organization:s.orgId });
      if (result.error) throw result.error;
      const value = result.data;
      if (value?.organization_id !== s.orgId || !value.capabilities || !Array.isArray(value.items)
        || !Array.isArray(value.warehouses) || !Array.isArray(value.balances) || !Array.isArray(value.bundles)) throw new Error('invalid_catalog_response');
      return value;
    },
    async history(s = scope(), cursor = null) {
      const result = await call(s, 'get_minuta_sales_history_candidate', {
        p_organization:s.orgId, p_client_account:null, p_filter_client:false, p_limit:50,
        p_before:cursor?.before || null, p_before_id:cursor?.before_id || null
      });
      if (result.error) throw result.error;
      const v = result.data;
      if (v?.organization_id !== s.orgId || v.grouped !== true || v.filter_client !== false
        || !safeMinor(v.grouped_count) || ![v.gross_minor,v.refunded_minor,v.net_minor].every(safeMinor)
        || v.net_minor !== v.gross_minor-v.refunded_minor || !Array.isArray(v.purchases)
        || v.purchases.some(x => x.organization_id !== s.orgId || !validId(x.id) || !Array.isArray(x.lines))) throw new Error('invalid_catalog_history_response');
      return v;
    },
    onSubmit:sale,
    async onRepeat({ scope:s, clientId }) {
      if (!validId(clientId)) throw new Error('commercial_client_mismatch');
      const result = await call(s, 'get_minuta_sales_repeat_candidate', { p_organization:s.orgId, p_client_account:clientId });
      if (result.error) throw result.error;
      if (result.data?.organization_id !== s.orgId || result.data?.client_account_id !== clientId) throw scopeError();
      return result.data;
    },
    async onFavoriteChange({ scope:s, itemId, favorite }) {
      if (!validId(itemId) || typeof favorite !== 'boolean') throw new Error('invalid_catalog_item');
      const result = await call(s, 'set_minuta_sales_favorite_candidate', { p_organization:s.orgId, p_item:itemId, p_favorite:favorite }, true);
      if (result.error) throw result.error;
      if (result.data?.inventory_item_id !== itemId || result.data?.favorite !== favorite) throw new Error('invalid_favorite_response');
      return result.data;
    },
    async onSaveCatalog({ scope:s, item, requestId }) {
      return mutation(s, requestId, 'save_minuta_sales_item_candidate', { p_organization:s.orgId, p_item:item }, itemResult);
    },
    async onPreviewImport({ scope:s, rows }) {
      const result = await call(s, 'preview_minuta_sales_import_candidate', { p_organization:s.orgId, p_rows:rows });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data?.errors) || !Array.isArray(result.data?.rows)
        || !/^[a-f0-9]{64}$/.test(result.data?.preview_hash || '')) throw new Error('invalid_catalog_preview_response');
      return result.data;
    },
    async onCommitImport({ scope:s, rows, previewHash, confirmed, requestId }) {
      check(s, true);
      return mutation(s, requestId, 'commit_minuta_sales_import_candidate', {
        p_organization:s.orgId, p_rows:rows, p_preview_hash:previewHash, p_confirmed:confirmed === true
      }, itemResult);
    },
    async onSaveBundle({ scope:s, bundleId, name, items, version, requestId }) {
      return mutation(s, requestId, 'save_minuta_sales_bundle_candidate', {
        p_organization:s.orgId, p_bundle:bundleId || null, p_name:name, p_items:items, p_version:version
      }, v => validId(v?.id) && Number.isSafeInteger(v.version) && v.version > 0);
    },
    async onResolvePending({ scope:s, kind, intent, requestId, mode }) {
      if (kind !== 'sale') {
        // Metadata has no receipt/status RPC. Only exact, idempotent retry is available.
        if (mode !== 'retry') return { confirmed:false };
        const args = { ...clone(intent), scope:s };
        const result = await (kind === 'item' ? api.onSaveCatalog(args) : kind === 'import' ? api.onCommitImport(args)
          : kind === 'bundle' ? api.onSaveBundle(args) : { confirmed:false });
        return result.rolledBack ? { confirmed:false, error:result.error } : result;
      }
      if (intent.p_request_id !== requestId || intent.p_organization !== s.orgId) throw scopeError();
      if (mode === 'retry') {
        const result = await sale({ scope:s, intent });
        // A retry rejected before replay lookup cannot disprove the earlier,
        // unknown outcome (for example after rights or write flags changed).
        return result.rolledBack ? { confirmed:false, error:result.error } : result;
      }
      const result = await call(s, 'get_minuta_sales_cart_candidate', {
        p_organization:s.orgId, p_request_id:requestId, p_client_account:intent.p_client_account || null
      });
      if (result.error) return { confirmed:false, error:result.error };
      return attestReceipt(intent, result.data, s.actorId) ? { confirmed:true, receipt:result.data }
        : { confirmed:false, error:result.data?.found === false ? null : { message:'invalid_catalog_receipt' } };
    }
  };
  return api;
}

function stylesheet() {
  const url = resourceUrl('./commerce-catalog.css');
  let link = document.querySelector('link[data-commerce-catalog]');
  if (link?.href === url && link.sheet) return Promise.resolve();
  if (link?._catalogPromise) return link._catalogPromise;
  if (link) link.remove();
  link = document.createElement('link'); link.rel = 'stylesheet'; link.href = url; link.dataset.commerceCatalog = 'true';
  link._catalogPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(), 15000);
    function fail() { clearTimeout(timer); link.remove(); reject(new Error('Не удалось загрузить оформление каталога. Повторите загрузку продаж.')); }
    link.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once:true });
    link.addEventListener('error', fail, { once:true }); document.head.append(link);
  });
  return link._catalogPromise;
}

export function createCatalogAdapter(options) {
  const { $, getContext, reload, onLegacyMode, getCurrentUser, getSessionGeneration } = options;
  const [issueSaleClaim, clearSaleClaim] = options.claim || [];
  const rpc = createCatalogRpcAdapter(options, getContext);
  let view = null, mount = null, scope = null, revision = 0, job = 0, grouped = null, legacy = false, uiState = null, claimRevision = 0;
  const form = $('#commerceSaleForm'), creator = $('#commerceSaleCreator'), type = $('#commerceItemKind');
  const status = document.createElement('p'); status.className = 'report-empty-inline'; status.setAttribute('role','status');
  const accountPane = document.createElement('details'); accountPane.className = 'commerce-sale-options cc-account-options';
  const accountTitle = document.createElement('summary'); accountTitle.textContent = 'Добавить кассу или счёт'; accountPane.append(accountTitle);
  const accounts = [$('#commerceAccountCreateOpen')?.closest('.commerce-account-trigger-row'), $('#commerceAccountSetup')]
    .filter(Boolean).map(element => { const anchor = document.createComment('catalog-account-location'); element.before(anchor); return {element,anchor}; });
  creator.append(status,accountPane);
  const hiddenBefore = new Map();
  function hide(element, hidden) { if (!element) return; if (!hiddenBefore.has(element)) hiddenBefore.set(element, element.hidden); element.hidden = hidden; }
  function restore() {
    accounts.forEach(({element,anchor}) => anchor.after(element)); accountPane.hidden = true; creator.append(accountPane);
    hiddenBefore.forEach((hidden, element) => { element.hidden = hidden; }); hiddenBefore.clear();
  }
  function setMode(value) {
    legacy = value; onLegacyMode?.(value); restore();
    const goods = type.value === 'inventory_item' && !value;
    status.hidden = !goods || Boolean(view);
    if (mount) mount.hidden = !goods;
    if (goods) {
      hide($('#commerceClient')?.closest('.form-row'), true);
      hide($('#commerceItem')?.closest('label'), true);
      hide(form.querySelector('.cs-product-choice'), true);
      hide($('#commerceQuantity')?.closest('.form-row'), true);
      hide($('#commerceSaleOptions'), true); hide(form.querySelector('.commerce-sale-commit'), true);
      if (view) { accounts.forEach(({element}) => accountPane.append(element)); mount.querySelector('.cc-settings').append(accountPane); accountPane.hidden = false; }
    }
  }
  type?.addEventListener('change', () => setMode(legacy));
  // Keep the older benefit/claim path; modern goods never fall through to v151.
  form?.addEventListener('submit', event => {
    if (event.target === form && type.value === 'inventory_item' && !legacy) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  function destroy() {
    job++; claimRevision++; view?.destroy(); view = null; uiState = null; scope = null; grouped = null; mount?.remove(); mount = null;
    restore(); status.hidden = true; legacy = false; onLegacyMode?.(false);
  }
  function current(s, ticket) {
    const now = rpc.scope(); return ticket === job && now.orgId === s.orgId && now.actorId === s.actorId && now.sessionKey === s.sessionKey;
  }
  function claimScopeCurrent(s) {
    const now = rpc.scope(), ctx = getContext();
    return Boolean(view && s && now.orgId === s.orgId && now.actorId === s.actorId && now.sessionKey === s.sessionKey
      && options.sessionIsCurrent(s.actorId, getSessionGeneration()) && ctx?.state?.organization_id === s.orgId
      && manager(ctx?.organization?.current_role));
  }
  function resetClaim() { claimRevision++; clearSaleClaim?.(); }
  async function confirmed({scope:s, kind, outcome}) {
    const ticket = ++claimRevision;
    try {
      try { await reload(); }
      catch { if (claimScopeCurrent(s)) options.notify('Операция подтверждена, но список пока не обновился.'); }
      const receipt = outcome?.receipt;
      if (ticket !== claimRevision || !claimScopeCurrent(s) || kind !== 'sale' || !issueSaleClaim
        || !receipt || receipt.organization_id !== s.orgId || !validId(receipt.client_account_id)
        || !validId(receipt.lines?.[0]?.sale_id) || !['cash','manual'].includes(receipt.payment_method)) return;
      // Reuse the existing v155 code issuance/retry path. The attested first
      // sale links the selected client to this purchase; no second sale occurs.
      await issueSaleClaim({ organizationId:s.orgId, saleId:receipt.lines[0].sale_id, clientId:receipt.client_account_id,
        clientName:getContext().state.clients?.find(client => client.id === receipt.client_account_id)?.name || '' });
    } catch { if (ticket === claimRevision && claimScopeCurrent(s)) options.notify('Продажа подтверждена. Код доступа пока не выдан; повторять продажу не нужно.'); }
  }
  function renderHistory(data, append = false) {
    grouped = append && grouped ? { ...data, purchases:[...grouped.purchases, ...data.purchases] } : data;
    $('#commerceSalesCount').textContent = String(data.grouped_count);
    const money = n => new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB' }).format(n/100);
    $('#commerceGross').textContent = money(data.gross_minor); $('#commerceRefunded').textContent = money(data.refunded_minor); $('#commerceNet').textContent = money(data.net_minor);
    const list = $('#commerceSalesList'); list.replaceChildren();
    for (const purchase of grouped.purchases) {
      const row = document.createElement('article'); row.className = 'commerce-sale-row';
      const copy = document.createElement('div'), time = document.createElement('small');
      time.textContent = new Date(purchase.occurred_at).toLocaleString('ru-RU'); copy.append(time);
      const title = document.createElement('strong'); title.textContent = purchase.lines.length === 1 ? purchase.lines[0].item_name : `Покупка · ${purchase.lines.length} позиций`; copy.append(title);
      const details = document.createElement(purchase.lines.length > 1 ? 'details' : 'div');
      if (purchase.lines.length > 1) { const label=document.createElement('summary'); label.textContent='Состав и возврат'; details.append(label); }
      for (const line of purchase.lines) {
        const item = document.createElement('p'); item.textContent = `${line.item_name} · ${line.sale_quantity ?? line.quantity} ${UNITS[line.sale_unit] || ''} · ${money(line.total_minor)}`;
        details.append(item);
        const saleId = line.sale_id;
        if (validId(saleId) && line.total_minor > (line.refunded_minor || 0) && Number(line.sale_quantity ?? line.quantity) > Number(line.refunded_quantity || 0)) {
          const refund = document.createElement('button'); refund.type = 'button'; refund.className = 'secondary-button compact-button';
          refund.dataset.commerceRefund = saleId; refund.textContent = 'Возврат'; details.append(refund);
        }
      }
      copy.append(details); const total = document.createElement('strong'); total.textContent = money(purchase.total_minor-purchase.refunded_minor); row.append(copy,total); list.append(row);
    }
    if (!grouped.purchases.length) { const empty = document.createElement('p'); empty.className = 'report-empty-inline'; empty.textContent = 'Продаж пока нет.'; list.append(empty); }
    if (data.next_cursor) {
      const more = document.createElement('button'); more.type = 'button'; more.className = 'secondary-button compact-button'; more.textContent = 'Показать ещё';
      more.addEventListener('click', async () => { const s = rpc.scope(), ticket = job; more.disabled = true;
        try { const next = await rpc.history(s,data.next_cursor); if (current(s,ticket)) renderHistory(next,true); }
        catch (e) { if (current(s,ticket)) { more.textContent = 'Повторить загрузку'; options.notify(friendlyError(e)); more.disabled = false; } }
      }); list.append(more);
    }
  }
  function historyUnavailable(message) {
    for (const id of ['#commerceSalesCount','#commerceGross','#commerceRefunded','#commerceNet']) $(id).textContent='—';
    const list=$('#commerceSalesList'); list.replaceChildren(); const text=document.createElement('p'); text.className='report-empty-inline'; text.textContent=message; list.append(text);
    const retry=document.createElement('button'); retry.type='button'; retry.className='secondary-button compact-button'; retry.textContent='Обновить историю';
    retry.addEventListener('click',()=>void sync()); list.append(retry);
  }
  function catalogUnavailable(message) {
    status.textContent=message;
    if (view && uiState) view.update({...uiState,context:view.getDraft()?.context,revision:++revision,canWrite:false,error:message});
    else { const retry=document.createElement('button'); retry.type='button'; retry.className='secondary-button compact-button'; retry.textContent='Обновить каталог'; retry.addEventListener('click',()=>void sync()); status.append(document.createElement('br'),retry); }
    setMode(false); options.notify(message);
  }
  async function sync(action = {}) {
    const ctx = getContext();
    if (!ctx?.organization?.id || !ctx.state) { destroy(); return; }
    const s = rpc.scope(), ticket = ++job;
    if (scope && (scope.orgId !== s.orgId || scope.actorId !== s.actorId || scope.sessionKey !== s.sessionKey)) { view?.destroy(); view = null; mount?.remove(); mount = null; restore(); }
    scope = s; status.textContent='Загружаем каталог товаров…'; setMode(false);
    if (view && uiState) view.update({...uiState,context:view.getDraft()?.context,revision:++revision,canWrite:false});
    let catalog;
    try { catalog = await rpc.catalog(s); }
    catch (e) {
      if (!current(s,ticket)) return;
      if (fallbackCatalogError(e)) { view?.destroy(); view = null; setMode(true); return; }
      catalogUnavailable(friendlyError(e)); return;
    }
    if (!current(s,ticket)) return;
    if (catalog.capabilities.atomic_cart !== true) { catalogUnavailable('Атомарная корзина пока недоступна.'); return; }
    historyUnavailable('Обновляем историю покупок…');
    let attachCommerceCatalog;
    try { await stylesheet(); ({attachCommerceCatalog}=await import(resourceUrl('./commerce-catalog.js'))); }
    catch(e) { if (current(s,ticket)) catalogUnavailable(friendlyError(e)); return; }
    if (!current(s,ticket)) return;
    if (!mount) { mount = document.createElement('div'); mount.id = 'commerceCatalogMount'; creator.append(mount); }
    const draft = view?.getDraft()?.context;
    const context = { ...(draft || { clientId:null, bookingId:null, sellerId:s.actorId, warehouseId:catalog.warehouses.find(x=>x.active)?.id || null,
      paymentMethod:'cash', paymentAccountId:ctx.state.accounts?.find(x=>x.account_type==='cash' && x.active !== false && !x.system_key)?.id || null }), ...action };
    const next = { ...catalog, ...s, revision:++revision, role:ctx.organization.current_role, canManage:manager(ctx.organization.current_role),
      canWrite:ctx.state.finance_enabled === true && ctx.state.inventory_enabled === true, context,
      options:{ clients:ctx.state.clients || [], bookings:(ctx.state.bookings || []).map(x=>({...x,name:`${x.booking_date} · ${x.client_name} · ${x.service_name}`})), sellers:ctx.state.sellers || [], paymentAccounts:(ctx.state.accounts || []).filter(x=>x.active !== false && !x.system_key && ['cash','bank'].includes(x.account_type)) } };
    uiState=next;
    if (!view) view = attachCommerceCatalog(mount, { state:next, ...rpc,
      onSubmit:args => { if (!claimScopeCurrent(args.scope)) throw scopeError(); resetClaim(); return rpc.onSubmit(args); },
      onContextChange:args => { if (claimScopeCurrent(args.scope)) resetClaim(); },
      onConfirmed:confirmed, onError:() => {} });
    else view.update(next);
    setMode(false);
    try { const history = await rpc.history(s); if (current(s,ticket)) renderHistory(history); }
    catch (e) { if (current(s,ticket)) { historyUnavailable('История покупок не загружена. Состав и итог продаж пока не подтверждены.'); options.notify('История покупок не обновилась. Повторите загрузку продаж.'); } }
  }
  return { sync, destroy, getView:() => view };
}
