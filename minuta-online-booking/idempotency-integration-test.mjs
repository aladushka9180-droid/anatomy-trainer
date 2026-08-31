import assert from 'node:assert/strict';

const supabaseUrl = process.env.MINUTA_TEST_SUPABASE_URL;
const anonKey = process.env.MINUTA_TEST_ANON_KEY;
const serviceRoleKey = process.env.MINUTA_TEST_SERVICE_ROLE_KEY;
const serviceId = process.env.MINUTA_TEST_SERVICE_ID;
const testProjectRef = process.env.MINUTA_TEST_PROJECT_REF;
const productionProject = 'cawexmmrqjvothcbgjxr.supabase.co';

assert.equal(process.env.MINUTA_TEST_CONFIRM, '1', 'Для теста с записью в БД задайте MINUTA_TEST_CONFIRM=1');
assert.ok(supabaseUrl && anonKey && serviceRoleKey && serviceId && testProjectRef, 'Не заданы параметры отдельного тестового проекта Supabase');
assert.match(testProjectRef, /^[a-z0-9]{20}$/i, 'MINUTA_TEST_PROJECT_REF должен быть идентификатором отдельного проекта Supabase');
const testOrigin = new URL(supabaseUrl);
const expectedTestHost = `${testProjectRef.toLowerCase()}.supabase.co`;
assert.equal(testOrigin.protocol, 'https:', 'Тестовый Supabase должен использовать HTTPS');
assert.equal(testOrigin.hostname.toLowerCase(), expectedTestHost, 'URL не соответствует явно указанному тестовому проекту Supabase');
assert.notEqual(expectedTestHost, productionProject, 'Интеграционный тест запрещено запускать на рабочем проекте');
assert.ok(serviceRoleKey !== anonKey, 'Для очистки требуется отдельный service-role ключ тестового проекта');
assert.match(serviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'MINUTA_TEST_SERVICE_ID должен быть UUID');

const anonHeaders = {
  apikey: anonKey,
  authorization: `Bearer ${anonKey}`,
  'content-type': 'application/json'
};
const adminHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
  prefer: 'return=representation'
};

function isoDate(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function rpc(name, body) {
  const response = await fetch(new URL(`/rest/v1/rpc/${name}`, supabaseUrl), {
    method: 'POST',
    headers: anonHeaders,
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

async function createBooking(requestId, slot, suffix) {
  return rpc('book_appointment', {
    p_request_id: requestId,
    p_service: serviceId,
    p_date: slot.booking_date,
    p_time: slot.booking_time,
    p_client_name: `Автотест ${suffix}`,
    p_client_phone: '+7 999 000-00-00'
  });
}

function summarizeRpcResults(results) {
  return results.map(result => ({
    ok: result.ok,
    status: result.status,
    code: result.data?.code,
    message: result.data?.message
  }));
}

function requestIdFilter(requestIds) {
  return `in.(${[...requestIds].join(',')})`;
}

async function readBookings(requestIds) {
  if (!requestIds.size) return [];
  const url = new URL('/rest/v1/bookings', supabaseUrl);
  url.searchParams.set('select', 'request_id,booking_code,manage_token,booking_date,booking_time');
  url.searchParams.set('request_id', requestIdFilter(requestIds));
  const response = await fetch(url, { headers: adminHeaders, signal: AbortSignal.timeout(20000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data)) {
    throw new Error(`Не удалось проверить тестовые записи: ${response.status} ${JSON.stringify(data)?.slice(0, 300)}`);
  }
  return data;
}

async function changeBookingName(requestId, clientName) {
  const url = new URL('/rest/v1/bookings', supabaseUrl);
  url.searchParams.set('select', 'request_id,client_name');
  url.searchParams.set('request_id', `eq.${requestId}`);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: adminHeaders,
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ client_name: clientName })
  });
  const changed = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(changed)) {
    throw new Error(`Не удалось изменить тестовую запись: ${response.status} ${JSON.stringify(changed)?.slice(0, 300)}`);
  }
  assert.equal(changed.length, 1, 'Изменение должно затронуть ровно одну тестовую запись');
  assert.equal(changed[0].request_id, requestId, 'Изменена запись вне текущего запуска');
  assert.equal(changed[0].client_name, clientName, 'Тестовая запись не получила новое имя');
}

async function cleanup(requestIds) {
  if (!requestIds.size) return;
  const url = new URL('/rest/v1/bookings', supabaseUrl);
  url.searchParams.set('select', 'request_id');
  url.searchParams.set('request_id', requestIdFilter(requestIds));
  const response = await fetch(url, { method: 'DELETE', headers: adminHeaders, signal: AbortSignal.timeout(20000) });
  const deleted = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(deleted)) {
    throw new Error(`Не удалось очистить тестовые записи: ${response.status} ${JSON.stringify(deleted)?.slice(0, 300)}`);
  }
  assert.ok(deleted.every(row => requestIds.has(row.request_id)), 'Очистка затронула запись вне текущего запуска');
  assert.deepEqual(await readBookings(requestIds), [], 'После очистки остались записи текущего запуска');
}

const requestIds = new Set();
let testError;
try {
  const slotsResult = await rpc('get_available_slots', {
    p_service: serviceId,
    p_start: isoDate(2),
    p_end: isoDate(45)
  });
  assert.ok(slotsResult.ok, `Не удалось получить тестовые окна: ${JSON.stringify(slotsResult.data)}`);
  assert.ok(Array.isArray(slotsResult.data) && slotsResult.data.length >= 2, 'Тестовой услуге нужны как минимум два свободных окна на ближайшие 45 дней');
  const [idempotentSlot, raceSlot] = slotsResult.data;
  assert.notDeepEqual(
    [idempotentSlot.booking_date, idempotentSlot.booking_time],
    [raceSlot.booking_date, raceSlot.booking_time],
    'Для двух сценариев нужны разные свободные окна'
  );

  const repeatedId = crypto.randomUUID();
  requestIds.add(repeatedId);
  const retries = await Promise.all(Array.from({ length: 8 }, () => createBooking(repeatedId, idempotentSlot, 'идемпотентность')));
  assert.ok(retries.every(result => result.ok), `Одинаковый запрос не был безопасно повторён: ${JSON.stringify(summarizeRpcResults(retries))}`);
  const retryResults = retries.map(result => result.data?.[0]);
  assert.ok(retryResults.every(result => result?.booking_code && result?.manage_token), 'Повторный запрос не вернул данные созданной записи');
  assert.equal(new Set(retryResults.map(result => `${result.booking_code}:${result.manage_token}`)).size, 1, 'Повторы создали разные записи');
  const repeatedRows = await readBookings(new Set([repeatedId]));
  assert.equal(repeatedRows.length, 1, 'Одинаковый request_id должен создать ровно одну строку в bookings');
  assert.equal(repeatedRows[0].booking_code, retryResults[0].booking_code, 'RPC вернул код не той записи');
  assert.equal(repeatedRows[0].manage_token, retryResults[0].manage_token, 'RPC вернул токен не той записи');

  await changeBookingName(repeatedId, 'Изменено после записи');
  const retryAfterChange = await createBooking(repeatedId, idempotentSlot, 'идемпотентность');
  assert.ok(retryAfterChange.ok, `Повтор после изменения записи завершился ошибкой: ${JSON.stringify(summarizeRpcResults([retryAfterChange]))}`);
  assert.equal(retryAfterChange.data?.[0]?.booking_code, retryResults[0].booking_code, 'После изменения записи RPC вернул другой код');
  assert.equal(retryAfterChange.data?.[0]?.manage_token, retryResults[0].manage_token, 'После изменения записи RPC вернул другой токен');

  const raceIds = Array.from({ length: 8 }, () => crypto.randomUUID());
  raceIds.forEach(id => requestIds.add(id));
  const race = await Promise.all(raceIds.map(id => createBooking(id, raceSlot, 'конкуренция')));
  const winners = race.filter(result => result.ok);
  const losers = race.filter(result => !result.ok);
  assert.equal(winners.length, 1, `Одно окно должно получить ровно одного победителя, получено ${winners.length}`);
  assert.ok(losers.every(result => JSON.stringify(result.data).includes('slot_unavailable') || ['23P01', '23505'].includes(result.data?.code)), `Конкурирующие запросы завершились неожиданно: ${JSON.stringify(summarizeRpcResults(losers))}`);
  const raceRows = await readBookings(new Set(raceIds));
  assert.equal(raceRows.length, 1, 'Гонка за одно окно должна оставить ровно одну строку в bookings');
  assert.equal(raceRows[0].booking_date, raceSlot.booking_date, 'Победитель записан на другую дату');
  assert.equal(raceRows[0].booking_time.slice(0, 5), raceSlot.booking_time.slice(0, 5), 'Победитель записан на другое время');

  console.log('Minuta idempotency integration test: OK');
} catch (error) {
  testError = error;
} finally {
  try {
    await cleanup(requestIds);
  } catch (cleanupError) {
    if (!testError) throw cleanupError;
    testError = new AggregateError([testError, cleanupError], 'Тест завершился ошибкой, затем не удалось безопасно очистить его записи');
  }
}

if (testError) throw testError;
