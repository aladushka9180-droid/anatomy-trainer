// Local visit terms only. These values do not establish a server write contract.
const VERSION = 1;
const SNAPSHOT_KEYS = ['version', 'pricingMode', 'actorId', 'organizationId', 'serviceId', 'minuteRateRub', 'durationMinutes', 'primaryAmountRub'];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function integer(value, name, min, max) {
  const numeric = typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new RangeError(`invalid_${name}`);
  }
  return numeric;
}

function identity(value, name) {
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new TypeError(`invalid_${name}`);
  return value;
}

/** A primary per-minute item. Add-on prices and actual/received amounts stay separate. */
export function calculateVisitTerms(minuteRateRub, durationMinutes) {
  const rate = integer(minuteRateRub, 'minute_rate', 0, 1000000);
  const minutes = integer(durationMinutes, 'duration', 1, 480);
  const primaryAmountRub = rate * minutes;
  // The existing primary session item has a stricter limit than a whole booking.
  if (primaryAmountRub > 1000000) throw new RangeError('primary_amount_out_of_range');
  return Object.freeze({ minuteRateRub:rate, durationMinutes:minutes, primaryAmountRub });
}

/** Capture before an async boundary; never retain the mutable catalog object. */
export function captureVisitTerms({ actorId, organizationId, service, minuteRateRub, durationMinutes }) {
  if (!service || (service.duration_minutes !== 1 && service.duration_minutes !== '1')) throw new TypeError('per_minute_service_required');
  const rate = minuteRateRub === undefined ? service.price_rub : minuteRateRub;
  return Object.freeze({
    version:VERSION,
    pricingMode:'per_minute',
    actorId:identity(actorId, 'actor'),
    organizationId:identity(organizationId, 'organization'),
    serviceId:identity(service.id, 'service'),
    ...calculateVisitTerms(rate, durationMinutes)
  });
}

function readSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SNAPSHOT_KEYS.length || SNAPSHOT_KEYS.some(key => !hasOwn(value, key))
    || value.version !== VERSION || value.pricingMode !== 'per_minute') throw new TypeError('invalid_visit_terms');
  const amounts = calculateVisitTerms(value.minuteRateRub, value.durationMinutes);
  if (value.minuteRateRub !== amounts.minuteRateRub || value.durationMinutes !== amounts.durationMinutes
    || value.primaryAmountRub !== amounts.primaryAmountRub) throw new TypeError('inconsistent_visit_terms');
  return Object.freeze({
    version:VERSION,
    pricingMode:'per_minute',
    actorId:identity(value.actorId, 'actor'),
    organizationId:identity(value.organizationId, 'organization'),
    serviceId:identity(value.serviceId, 'service'),
    ...amounts
  });
}

/** Keep the existing form draft; only the owned visit-terms field is added. */
export function withVisitTermsDraft(draft, terms) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new TypeError('invalid_draft');
  return { ...draft, visitTerms:readSnapshot(terms) };
}

/** A caller must handle legacy/mismatched/invalid explicitly, never pick a different service. */
export function restoreVisitTermsDraft(draft, { actorId, organizationId, serviceId }) {
  const scope = {
    actorId:identity(actorId, 'actor'),
    organizationId:identity(organizationId, 'organization'),
    serviceId:identity(serviceId, 'service')
  };
  if (!draft || !hasOwn(draft, 'visitTerms')) return { status:'legacy', terms:null };
  let terms;
  try { terms = readSnapshot(draft.visitTerms); }
  catch { return { status:'invalid', terms:null }; }
  if (terms.actorId !== scope.actorId || terms.organizationId !== scope.organizationId || terms.serviceId !== scope.serviceId) {
    return { status:'scope_mismatch', terms:null };
  }
  return { status:'restored', terms };
}

function tuple(value) {
  const terms = readSnapshot(value);
  return SNAPSHOT_KEYS.map(key => terms[key]);
}

/** Absence keeps the old canonical bytes; explicit malformed/null terms are never dropped. */
export function visitTermsFingerprintCanonical(legacyParts, terms) {
  if (!Array.isArray(legacyParts)) throw new TypeError('invalid_fingerprint_parts');
  return JSON.stringify(terms === undefined ? legacyParts : [...legacyParts, ['visit_terms', ...tuple(terms)]]);
}

/** Exact local tuple comparison only; this cannot prove atomicity, rights or server persistence. */
export function sameVisitTerms(expected, observed) {
  try { return JSON.stringify(tuple(expected)) === JSON.stringify(tuple(observed)); }
  catch { return false; }
}
