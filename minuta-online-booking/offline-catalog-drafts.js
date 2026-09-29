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
  const clearEpochs = new Map();
  const clearEpoch = userId => clearEpochs.get(userId) || 0;

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
    return ['service','inventory'].includes(kind) && ETAG.test(String(version || ''));
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
    if (!store?.get || !store?.put || !store?.remove || !store?.removePrefix)
      throw new Error('catalog_storage_unavailable');
  }
  async function listStored(prefix) {
    if (!('indexedDB' in window)) throw new Error('catalog_storage_unavailable');
    const database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('minuta-reliability-v1',1);
      request.onupgradeneeded=()=>{
        if (!request.result.objectStoreNames.contains('snapshots'))
          request.result.createObjectStore('snapshots');
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || new Error('catalog_storage_unavailable'));
    });
    try {
      return await new Promise((resolve,reject)=>{
        const transaction=database.transaction('snapshots','readonly');
        const request=transaction.objectStore('snapshots').getAll(
          IDBKeyRange.bound(prefix,prefix+'\uffff'));
        transaction.oncomplete=()=>resolve(request.result);
        transaction.onerror=()=>reject(transaction.error || new Error('catalog_storage_unavailable'));
        transaction.onabort=()=>reject(transaction.error || new Error('catalog_storage_unavailable'));
      });
    } finally { database.close(); }
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
    const rows=await listStored(prefix(scopedUser,scopedOrg));
    const drafts=[];
    let invalidCount=0;
    for (const row of rows) {
      if (validDraft(row?.data,scopedUser,scopedOrg)) drafts.push(row.data);
      else invalidCount++;
    }
    drafts.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    return { drafts,invalidCount };
  }
  async function persist(draft,startedEpoch=clearEpoch(draft.userId)) {
    if (clearEpoch(draft.userId)!==startedEpoch) throw new Error('catalog_session_changed');
    await store.put(key(draft.userId,draft.organizationId,draft.requestId),draft);
    if (clearEpoch(draft.userId)!==startedEpoch) {
      await store.remove(key(draft.userId,draft.organizationId,draft.requestId));
      throw new Error('catalog_session_changed');
    }
    const confirmed=await read(draft.userId,draft.organizationId,draft.requestId);
    if (!confirmed || confirmed.revision !== draft.revision) throw new Error('catalog_storage_unconfirmed');
    return confirmed;
  }
  async function rememberVersion({ userId,organizationId,kind,entityId,version,values=null },startedEpoch=null) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId), target=requireId(entityId);
    const expectedEpoch=startedEpoch ?? clearEpoch(scopedUser);
    if (!validVersion(kind,target,version)) throw new Error('catalog_version_invalid');
    const record={ schema:1,userId:scopedUser,organizationId:scopedOrg,kind,entityId:target,
      version,fields:values ? fields(kind,values) : null,savedAt:new Date().toISOString() };
    if (clearEpoch(scopedUser)!==expectedEpoch) throw new Error('catalog_session_changed');
    await store.put(versionKey(scopedUser,scopedOrg,kind,target),record);
    if (clearEpoch(scopedUser)!==expectedEpoch) {
      await store.remove(versionKey(scopedUser,scopedOrg,kind,target));
      throw new Error('catalog_session_changed');
    }
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
  async function readVersionSnapshot(userId,organizationId,kind,entityId) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId), target=requireId(entityId);
    const saved=await store.get(versionKey(scopedUser,scopedOrg,kind,target));
    const record=saved?.data;
    if (record?.schema!==1 || record.userId!==scopedUser || record.organizationId!==scopedOrg
      || record.kind!==kind || record.entityId!==target || !validVersion(kind,target,record.version)) return null;
    try { return { version:record.version,fields:fields(kind,record.fields) }; }
    catch { return null; }
  }
  async function listVersionSnapshots(userId,organizationId,kind) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    if (!['service','inventory'].includes(kind)) throw new Error('catalog_kind_invalid');
    const rows=await listStored(`${VERSION_ROOT}${scopedUser}:${scopedOrg}:${kind}:`);
    const snapshots=[];
    for (const row of rows) {
      const entityId=row?.data?.entityId;
      if (!UUID.test(String(entityId || ''))) continue;
      const snapshot=await readVersionSnapshot(scopedUser,scopedOrg,kind,entityId);
      if (snapshot) snapshots.push({entityId,...snapshot});
    }
    return snapshots;
  }
  async function captureInventoryVersions({ userId,organizationId,workspace,isCurrent }) {
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    const startedEpoch=clearEpoch(scopedUser);
    if (typeof isCurrent!=='function' || workspace?.organization_id!==scopedOrg
      || !Array.isArray(workspace.items)) throw new Error('catalog_sync_context_invalid');
    let count=0;
    for (const item of workspace.items) {
      if (!isCurrent(scopedUser,scopedOrg)) break;
      if (!UUID.test(String(item?.id || '')) || !validVersion('inventory',item.id,item.etag)) continue;
      let values;
      try { values=fields('inventory',{name:item.name,sku:item.sku,unit:item.unit,
        lowStock:item.low_stock_threshold,active:item.active}); } catch { continue; }
      await rememberVersion({userId:scopedUser,organizationId:scopedOrg,kind:'inventory',
        entityId:item.id,version:item.etag,values},startedEpoch);
      count++;
    }
    return count;
  }
  async function refreshServiceVersion({ userId,organizationId,entityId,rpc,isCurrent }) {
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId), target=requireId(entityId);
    const startedEpoch=clearEpoch(scopedUser);
    if (typeof rpc!=='function' || typeof isCurrent!=='function') throw new Error('catalog_sync_context_invalid');
    if (!navigator.onLine || !isCurrent(scopedUser,scopedOrg)) return null;
    let response;
    try { response=await rpc('get_minuta_service_catalog_draft_v187',{
      p_organization:scopedOrg,p_service:target }); } catch { return null; }
    if (!isCurrent(scopedUser,scopedOrg) || response?.error) return null;
    const data=response?.data;
    if (data?.organization_id!==scopedOrg || String(data?.id || '').toLowerCase()!==target
      || !validVersion('service',target,data.etag)) return null;
    let values;
    try { values=fields('service',{name:data.name,durationMinutes:data.duration_minutes,
      priceRub:data.price_rub,active:data.active}); } catch { return null; }
    await rememberVersion({userId:scopedUser,organizationId:scopedOrg,kind:'service',
      entityId:target,version:data.etag,values},startedEpoch);
    return data.etag;
  }
  async function queue({ userId,organizationId,kind,entityId=null,expectedVersion=null,values }) {
    requireStore();
    const scopedUser=requireId(userId), scopedOrg=requireId(organizationId);
    const startedEpoch=clearEpoch(scopedUser);
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
      status:'local',createdAt:now,updatedAt:now,revision:crypto.randomUUID() },startedEpoch);
  }
  async function withStatus(draft,status,result=null,startedEpoch=clearEpoch(draft.userId)) {
    return persist({ ...draft,status,result,updatedAt:new Date().toISOString(),revision:crypto.randomUUID() },startedEpoch);
  }
  function call(draft) {
    const common={ p_organization:draft.organizationId,p_request_id:draft.requestId };
    if (draft.kind === 'service') return ['save_minuta_service_catalog_draft_v187',{
      ...common,p_service:draft.entityId,p_expected_etag:draft.expectedVersion,
      p_name:draft.fields.name,p_duration_minutes:draft.fields.durationMinutes,
      p_price_rub:draft.fields.priceRub,p_active:draft.fields.active
    }];
    return ['save_minuta_inventory_item_draft_v186',{
      ...common,p_item:draft.entityId,p_expected_etag:draft.expectedVersion,
      p_name:draft.fields.name,p_sku:draft.fields.sku,p_unit:draft.fields.unit,
      p_low_stock:draft.fields.lowStock,p_active:draft.fields.active
    }];
  }
  async function flushOne({ userId,organizationId,requestId,rpc,isCurrent }) {
    if (typeof rpc !== 'function' || typeof isCurrent !== 'function') throw new Error('catalog_sync_context_invalid');
    const startedEpoch=clearEpoch(requireId(userId));
    let draft=await read(userId,organizationId,requestId);
    if (!draft) throw new Error('catalog_draft_missing');
    if (draft.status==='applied' || draft.status==='conflict') return draft;
    if (!isCurrent(draft.userId,draft.organizationId) || !navigator.onLine) return draft;
    if (draft.status==='local') draft=await withStatus(draft,'checking',null,startedEpoch);
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
      && ETAG.test(String(data.etag || ''));
    if (validSuccess) return withStatus(current,'applied',{
      id:String(data.id).toLowerCase(),version:data.etag
    },startedEpoch);
    const reason=String(data?.reason || response?.error?.message || '');
    if (/^(service_catalog_version_conflict|inventory_catalog_version_conflict|service_deleted|inventory_item_deleted|service_changed_after_save|inventory_item_changed_after_save)$/.test(reason))
      return withStatus(current,'conflict',{ reason },startedEpoch);
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
    clearEpochs.set(scopedUser,clearEpoch(scopedUser)+1);
    await store.removePrefix(`${ROOT}${scopedUser}:`);
    await store.removePrefix(`${VERSION_ROOT}${scopedUser}:`);
  }

  window.MinutaOfflineCatalogDrafts={ queue,read,list,rememberVersion,readVersion,readVersionSnapshot,
    listVersionSnapshots,
    captureInventoryVersions,refreshServiceVersion,flushOne,remove,clearUser };
})();
