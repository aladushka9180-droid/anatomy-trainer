import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./supabase-migration-v98.sql', import.meta.url), 'utf8');

assert.match(provider, /openNewBookingSheet\(time, \{ date:selectedDate, historical:selectedStart < new Date\(\) \}\)/, 'Нажатие на прошлое время не передаёт выбранную дату в форму');
assert.match(provider, /#newBookingButton'\)\.addEventListener\('click', \(\) => openNewBookingSheet\('', \{ date:selectedDate, historical:selectedDate < businessTodayIso\(\) \}\)\)/, 'Основная кнопка не открывает выбранный прошедший день');
assert.match(provider, /#mobileNewBookingButton'\)\.addEventListener\('click', \(\) => openNewBookingSheet\('', \{ date:selectedDate, historical:selectedDate < businessTodayIso\(\) \}\)\)/, 'Мобильная кнопка не открывает выбранный прошедший день');
assert.match(provider, /id="newBookingHistoricalToggle"[^>]*aria-pressed=/, 'Нет явного режима прошедшего визита');
assert.match(provider, /date === businessTodayIso\(\) \? now\.getHours\(\) \* 60 \+ now\.getMinutes\(\) : 1440/, 'Режим не ограничивает сегодняшний день уже прошедшим временем');
assert.match(provider, /minute \+ duration > latestMinute/, 'В прошедшем визите предлагаются будущие интервалы');
assert.match(provider, /newBookingHistoricalMode \? 'Добавить прошедший визит'/, 'Кнопка сохранения не объясняет действие');
assert.match(provider, /db\.rpc\('create_minuta_historical_booking'/, 'Прошедший визит не отправляется в защищённую серверную функцию');
assert.doesNotMatch(provider, /id="newBookingDate" type="date" min=/, 'Выбор прошлой даты заблокирован атрибутом min');
assert.match(styles, /\.new-booking-history-option \{[^}]*min-height:52px;/, 'Переключатель прошедшего визита слишком мал для мобильного нажатия');
assert.match(migration, /p_date\+p_time\+make_interval\(mins=>v_effective_duration\)>timezone\(v_timezone,now\(\)\)/, 'Сервер не подтверждает, что визит действительно завершился');
assert.match(migration, /message='slot_unavailable'/, 'Сервер не защищает прошедшие записи от пересечений');

console.log('Historical booking v382 checks passed.');
