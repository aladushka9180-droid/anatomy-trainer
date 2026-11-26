// Pure Source contract. It neither writes bookings nor owns retries, IDs or storage.
import { restoreVisitTermsDraft, sameVisitTerms, visitTermsFingerprintCanonical } from './provider-visit-terms.mjs';

const ENVELOPE_KEYS = ['version','requestId','locationId','legacyParts','terms','session','intervalWeeks','occurrences'];
const ITEM_KEYS = ['kind','service_id','title','duration_minutes','price_rub','extends_duration'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function keys(value, expected) {
  if (!object(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== expected.length || expected.some(k => {
      const d=Object.getOwnPropertyDescriptor(value,k);
      return !d || !Object.hasOwn(d,'value') || !d.enumerable;
    })) {
    throw new TypeError('invalid_create_contract_shape');
  }
}
function dense(value,min,max) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max
    || Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('invalid_create_array');
  for (let i=0;i<value.length;i++) {
    const d=Object.getOwnPropertyDescriptor(value,String(i));
    if (!d || !Object.hasOwn(d,'value') || !d.enumerable) throw new TypeError('invalid_create_array');
  }
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new TypeError('invalid_create_request_identity');
  return value.toLowerCase();
}
function whole(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError('invalid_create_contract_number');
  return value;
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new TypeError('invalid_create_date');
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0,10) !== value) throw new TypeError('invalid_create_date');
  return stamp;
}
function session(items, terms) {
  dense(items,1,20);
  const captured = items.map((item, index) => {
    keys(item, ITEM_KEYS);
    if (item.kind !== (index === 0 ? 'primary' : 'addon')
      || (item.service_id !== null && (typeof item.service_id !== 'string' || !item.service_id || item.service_id !== item.service_id.trim()))
      || typeof item.title !== 'string' || item.title !== item.title.trim() || item.title.length < 2 || item.title.length > 120
      || typeof item.extends_duration !== 'boolean') throw new TypeError('invalid_create_item');
    whole(item.duration_minutes,index === 0 ? 1 : 0,480); whole(item.price_rub,0,1000000);
    if (index === 0 && (item.service_id !== terms.serviceId || item.duration_minutes !== terms.durationMinutes
      || item.price_rub !== terms.primaryAmountRub || !item.extends_duration)) throw new TypeError('inconsistent_create_primary');
    return Object.freeze(Object.fromEntries(ITEM_KEYS.map(k => [k,item[k]])));
  });
  const totalAmountRub = captured.reduce((sum,item) => sum + item.price_rub,0);
  const totalDurationMinutes = captured.reduce((sum,item) => sum + (item.extends_duration ? item.duration_minutes : 0),0);
  whole(totalAmountRub,0,10000000); whole(totalDurationMinutes,1,480);
  return Object.freeze({ items:Object.freeze(captured), totalAmountRub, totalDurationMinutes });
}

/** The caller supplies already-normalized legacy parts and IDs from its single attempt owner. */
export function captureVisitCreationEnvelope({ requestId, locationId, legacyParts, terms, items,
  occurrenceRequestIds = [requestId], intervalWeeks = null }) {
  const root = uuid(requestId); const location = uuid(locationId);
  keys(terms,Object.keys(terms ?? {}));
  const restored = restoreVisitTermsDraft({ visitTerms:terms }, terms ?? {});
  if (restored.status !== 'restored') throw new TypeError('invalid_create_terms');
  const chosen = restored.terms;
  dense(legacyParts,13,13);
  if (legacyParts.some((v,i) => typeof v !== ([6,11].includes(i) ? 'number' : 'string'))
    || !['new-booking','repeat-booking'].includes(legacyParts[0]) || legacyParts[1] !== chosen.serviceId
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(legacyParts[3])) throw new TypeError('invalid_create_legacy_parts');
  const start = date(legacyParts[2]);
  const capturedSession = session(items,chosen);
  if (legacyParts[6] !== capturedSession.totalDurationMinutes
    || (legacyParts[0] === 'repeat-booking' && legacyParts[11] !== capturedSession.totalAmountRub)
    || (legacyParts[0] === 'new-booking' && legacyParts[11] !== 0)) throw new TypeError('inconsistent_create_payload');
  if (legacyParts[0] === 'repeat-booking' && (!legacyParts[9] || !legacyParts[10])) throw new TypeError('missing_repeat_identity');
  if (legacyParts[0] === 'new-booking' && (legacyParts[9] || legacyParts[10])) throw new TypeError('unexpected_repeat_identity');
  dense(occurrenceRequestIds,1,24);
  const requestIds = occurrenceRequestIds.map(uuid);
  if (new Set(requestIds).size !== requestIds.length) throw new TypeError('duplicate_create_occurrence');
  if (requestIds.length === 1 ? intervalWeeks !== null || requestIds[0] !== root
    : !Number.isSafeInteger(intervalWeeks) || intervalWeeks < 1 || intervalWeeks > 12) throw new TypeError('invalid_create_interval');
  const occurrences = requestIds.map((id,index) => {
    const day = new Date(start + index * (intervalWeeks ?? 0) * 7 * 86400000).toISOString().slice(0,10);
    date(day);
    return Object.freeze({ requestId:id, date:day, time:legacyParts[3] });
  });
  return Object.freeze({ version:1, requestId:root, locationId:location,
    legacyParts:Object.freeze([...legacyParts]), terms:chosen, session:capturedSession,
    intervalWeeks, occurrences:Object.freeze(occurrences) });
}

/** Revalidates stored JSON; no new ID, catalog lookup, storage write or UNKNOWN reset. */
export function restoreVisitCreationEnvelope(value) {
  keys(value,ENVELOPE_KEYS);
  if (value.version !== 1) throw new TypeError('invalid_create_envelope');
  dense(value.occurrences,1,24);
  keys(value.session,['items','totalAmountRub','totalDurationMinutes']);
  for (const occurrence of value.occurrences) keys(occurrence,['requestId','date','time']);
  const captured = captureVisitCreationEnvelope({ ...value, items:value.session.items,
    occurrenceRequestIds:value.occurrences.map(o => o.requestId) });
  if (JSON.stringify(captured.session) !== JSON.stringify({ items:value.session.items.map(i => Object.fromEntries(ITEM_KEYS.map(k => [k,i[k]]))),
    totalAmountRub:value.session.totalAmountRub,totalDurationMinutes:value.session.totalDurationMinutes })
    || captured.occurrences.some((o,i) => o.requestId !== value.occurrences[i].requestId || o.date !== value.occurrences[i].date || o.time !== value.occurrences[i].time)
    || captured.requestId !== value.requestId || captured.locationId !== value.locationId) throw new TypeError('inconsistent_create_envelope');
  return captured;
}

/** Separate Source namespace; the existing legacy canonical function and old attempts stay intact. */
export function visitCreationFingerprintCanonical(value) {
  const e = restoreVisitCreationEnvelope(value);
  return JSON.stringify(['visit_create_terms_v1',e.requestId,e.locationId,
    visitTermsFingerprintCanonical(e.legacyParts,e.terms),e.session,e.intervalWeeks,e.occurrences]);
}

/** Exact DTO qualification only. This does not establish atomic SQL, authorization or delivery. */
export function visitCreationReceiptMatches(expected, observed) {
  try {
    const e = restoreVisitCreationEnvelope(expected);
    keys(observed,['version','requestId','actorId','organizationId','locationId','requestCanonical','occurrences']);
    dense(observed.occurrences,1,24);
    if (observed.version !== 1 || observed.requestId !== e.requestId
      || observed.actorId !== e.terms.actorId || observed.organizationId !== e.terms.organizationId
      || observed.locationId !== e.locationId || observed.requestCanonical !== visitCreationFingerprintCanonical(e)
      || !Array.isArray(observed.occurrences)
      || observed.occurrences.length !== e.occurrences.length) return false;
    const bookingIds = new Set(),revisionIds = new Set();
    return e.occurrences.every((occurrence,index) => {
      const row = observed.occurrences[index];
      keys(row,['requestId','date','time','bookingId','terms','session','revision']);
      keys(row.terms,Object.keys(e.terms));
      keys(row.session,['items','totalAmountRub','totalDurationMinutes']);
      keys(row.revision,['id','bookingId','actorId','items','totalAmountRub','totalDurationMinutes']);
      if (row.requestId !== occurrence.requestId || row.date !== occurrence.date || row.time !== occurrence.time
        || !sameVisitTerms(e.terms,row.terms)) return false;
      const bookingId = uuid(row.bookingId),revisionId = uuid(row.revision.id);
      if (bookingIds.has(bookingId) || revisionIds.has(revisionId)) return false;
      bookingIds.add(bookingId);revisionIds.add(revisionId);
      return JSON.stringify(session(row.session.items,e.terms)) === JSON.stringify(e.session)
        && row.session.totalAmountRub === e.session.totalAmountRub && row.session.totalDurationMinutes === e.session.totalDurationMinutes
        && row.revision.bookingId === row.bookingId && row.revision.actorId === e.terms.actorId
        && row.revision.totalAmountRub === e.session.totalAmountRub && row.revision.totalDurationMinutes === e.session.totalDurationMinutes
        && JSON.stringify(session(row.revision.items,e.terms)) === JSON.stringify(e.session);
    });
  } catch { return false; }
}
