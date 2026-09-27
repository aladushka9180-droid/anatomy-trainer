(function () {
  'use strict';

  const store = window.MinutaReliability;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ETAG = /^[0-9a-f]{32}$/;
  const UNITS = new Set(['piece','ml','g','kg','l','pack']);
  const LIMIT = 50;
  const ROOT = 'minuta-offline-catalog-v1:';
  const VERSION_ROOT = 'minuta-offline-catalog-version-v1:';
  const states = new Set(['local','checking','conflict','applied']);

  function requireId(value) {
    if (!UUID.test(String(value || ''))) throw new Error('catalog_scope_invalid');
    return String(value).toLowerCase();
  }
  function prefix(userId, organizationId) {
    return `${ROOT}${requireId(userId)}:${requireId(organizationId)}:`;
  }
  function key(userId, organizationId, requestId) {
    return prefix(userId, organizationId) + requireId(requestId);
  }
  function versionKey(userId, organizationId, kind, entityId) {
    if (!['service','inventory'].includes(kind)) throw new Error('catalog_kind_invalid');
    return `${VERSION_ROOT}${requireId(userId)}:${requireId(organizationId)}:${kind}:${requireId(entityId)}`;
  }
  function fields(kind, source) {
    if (!source || typeof source !== 'object') throw new Error('catalog_fields_invalid');
    const name = String(source.name || '').trim();
    if (name.length < 2 || name.length > 120) throw new Error('catalog_fields_invalid');
    if (typeof source.active !== 'boolean') throw new Error('catalog_fields_invalid');
    if (kind === 'service') {
      const duration = Number(source.durationMinutes), price = Number(source.priceRub);
      if (!Number.isInteger(duration) || duration < 1 || duration > 480
        || !Number.isInteger(price) || price < 0 || price > 1000000) throw new Error('catalog_fields_invalid');
      return { name,durationMinutes:duration,priceRub:price,active:source.active };
    }
    if (kind === 'inventory') {
      const sku = String(source.sku || '').trim();
      const lowStock = Number(source.lowStock);
      if (sku.length > 80 || !UNITS.has(source.unit) || !Number.isFinite(lowStock)
        || lowStock < 0 || lowStock > 99999999999 || Math.round(lowStock * 1000) !== lowStock * 1000)
        throw new Error('catalog_fields_invalid');
      return { name,sku,unit:source.unit,lowStock,active:source.active };
    }
    throw new Error('catalog_kind_invalid');
  }
  function validVersion(kind, entityId, version) {
    if (!entityId) return version == null;
    if (kind === 'service') return ETAG.test(String(version || ''));
    return typeof version === 'string' && Number.isFinite(Date.parse(version));
  }
  function validDraft(value, userId, organizationId) {
    try {
      return value?.schema === 1 && value.userId === userId && value.organizationId === organizationId
        && UUID.test(value.requestId) && (!value.entityId || UUID.test(value.entityId))
        && states.has(value.status) && validVersion(value.kind,value.entityId,value.expectedVersion)
        && Boolean(fields(value.kind,value.fields));
    } catch { return false; }
  }
  function requireStore() {
    if (!store?.get || !store?.put || !store?.list || !store?.remove || !store?.removePrefix)
      throw new Error('catalog_storage_unavailable');
  }
  async function read(userId, organizationId, requestId) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    const saved=await store.get(key(scopedUser,scopedOrg,requestId));
    return validDraft(saved?.data,scopedUser,scopedOrg) ? saved.data : null;
  }
  async function list(userId, organizationId) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    const rows=await store.list(prefix(scopedUser,scopedOrg));
    const drafts=[];
    let invalidCount=0;
    for (const row of rows) {
      if (validDraft(row?.data,scopedUser,scopedOrg)) drafts.push(row.data);
      else invalidCount++;
    }
    drafts.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    return { drafts,invalidCount };
  }
  async function persist(draft) {
    await store.put(key(draft.userId,draft.organizationId,draft.requestId),draft);
    const confirmed=await read(draft.userId,draft.organizationId,draft.requestId);
    if (!confirmed || confirmed.revision !== draft.revision) throw new Error('catalog_storage_unconfirmed');
    return confirmed;
  }
  async function rememberVersion({ userId,organizationId,kind,entityId,version }) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId), target=requireId(entityId);
    if (!validVersion(kind,target,version)) throw new Error('catalog_version_invalid');
    const record={ schema:1,userId:scopedUser,organizationId:scopedOrg,kind,entityId:target,
      version,savedAt:new Date().toISOString() };
    await store.put(versionKey(scopedUser,scopedOrg,kind,target),record);
    const confirmed=await readVersion(scopedUser,scopedOrg,kind,target);
    if (confirmed!==version) throw new Error('catalog_storage_unconfirmed');
    return record;
  }
  async function readVersion(userId,organizationId,kind,entityId) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId), target=requireId(entityId);
    const saved=await store.get(versionKey(scopedUser,scopedOrg,kind,target));
    const record=saved?.data;
    return record?.schema===1 && record.userId===scopedUser && record.organizationId===scopedOrg
      && record.kind===kind && record.entityId===target && validVersion(kind,target,record.version)
      ? record.version : null;
  }
  async function queue({ userId,organizationId,kind,entityId=null,expectedVersion=null,values }) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    const target=entityId ? requireId(entityId) : null;
    if (!validVersion(kind,target,expectedVersion)) throw new Error('catalog_version_invalid');
    const normalized=fields(kind,values);
    const existing=await list(scopedUser,scopedOrg);
    if (existing.invalidCount) throw new Error('catalog_storage_needs_review');
    if (existing.drafts.filter(item=>item.status!=='applied').length >= LIMIT) throw new Error('catalog_draft_limit');
    if (target && existing.drafts.some(item=>item.status!=='applied' && item.kind===kind && item.entityId===target))
      throw new Error('catalog_draft_exists');
    const requestId=crypto.randomUUID().toLowerCase();
    const now=new Date().toISOString();
    return persist({ schema:1,userId:scopedUser,organizationId:scopedOrg,requestId,
      kind,entityId:target,expectedVersion:expectedVersion ?? null,fields:normalized,
      status:'local',createdAt:now,updatedAt:now,revision:crypto.randomUUID() });
  }
  async function withStatus(draft,status,result=null) {
    return persist({ ...draft,status,result,updatedAt:new Date().toISOString(),revision:crypto.randomUUID() });
  }
  function call(draft) {
    const common={ p_organization:draft.organizationId,p_request_id:draft.requestId };
    if (draft.kind === 'service') return ['save_minuta_service_catalog_draft_v182',{
      ...common,p_service:draft.entityId,p_expected_etag:draft.expectedVersion,
      p_name:draft.fields.name,p_duration_minutes:draft.fields.durationMinutes,
      p_price_rub:draft.fields.priceRub,p_active:draft.fields.active
    }];
    return ['save_minuta_inventory_item_draft_v181',{
      ...common,p_item:draft.entityId,p_expected_updated_at:draft.expectedVersion,
      p_name:draft.fields.name,p_sku:draft.fields.sku,p_unit:draft.fields.unit,
      p_low_stock:draft.fields.lowStock,p_active:draft.fields.active
    }];
  }
  async function flushOne({ userId,organizationId,requestId,rpc,isCurrent }) {
    if (typeof rpc !== 'function' || typeof isCurrent !== 'function') throw new Error('catalog_sync_context_invalid');
    let draft=await read(userId,organizationId,requestId);
    if (!draft) throw new Error('catalog_draft_missing');
    if (draft.status==='applied' || draft.status==='conflict') return draft;
    if (!isCurrent(draft.userId,draft.organizationId) || !navigator.onLine) return draft;
    if (draft.status==='local') draft=await withStatus(draft,'checking');
    if (!isCurrent(draft.userId,draft.organizationId)) return draft;
    const [name,parameters]=call(draft);
    let response;
    try { response=await rpc(name,parameters); } catch { return draft; }
    if (!isCurrent(draft.userId,draft.organizationId)) return draft;
    const current=await read(draft.userId,draft.organizationId,draft.requestId);
    if (!current || current.status==='applied' || current.status==='conflict') return current;
    const data=response?.data;
    const validSuccess=!response?.error && data?.saved===true && UUID.test(String(data.id || ''))
      && data.organization_id===draft.organizationId
      && (!draft.entityId || String(data.id).toLowerCase()===draft.entityId)
      && (draft.kind==='service' ? ETAG.test(String(data.etag || ''))
        : typeof data.updated_at==='string' && Number.isFinite(Date.parse(data.updated_at)));
    if (validSuccess) return withStatus(current,'applied',{
      id:String(data.id).toLowerCase(),version:draft.kind==='service' ? data.etag : data.updated_at
    });
    const reason=String(data?.reason || response?.error?.message || '');
    if (/^(service_catalog_version_conflict|inventory_catalog_version_conflict|service_deleted|inventory_item_deleted|service_changed_after_save|inventory_item_changed_after_save)$/.test(reason))
      return withStatus(current,'conflict',{ reason });
    return current;
  }
  async function remove(userId,organizationId,requestId) {
    requireStore();
    await store.remove(key(userId,organizationId,requestId));
    if (await read(userId,organizationId,requestId)) throw new Error('catalog_remove_unconfirmed');
  }
  async function clearUser(userId) {
    requireStore();
    const scopedUser=requireId(userId);
    await store.removePrefix(`${ROOT}${scopedUser}:`);
    await store.removePrefix(`${VERSION_ROOT}${scopedUser}:`);
  }

  window.MinutaOfflineCatalogDrafts={ queue,read,list,rememberVersion,readVersion,flushOne,remove,clearUser };
})();
