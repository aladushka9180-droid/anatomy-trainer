import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./supabase-migration-v98.sql', import.meta.url), 'utf8');

assert.match(provider, /historical:dateIso < today \|\| \(dateIso === today && bookingMoveTimeIsPast\(dateIso, time\)\)/, 'Нажатие на прошедшее время автоматически открывает состоявшийся визит');
assert.match(provider, /#newBookingButton'\)\.addEventListener\('click', \(\) => openNewBookingSheet\('', \{ date:selectedDate, historical:selectedDate < businessTodayIso\(\) \}\)\)/, 'Основная кнопка не открывает выбранный прошедший день');
assert.match(provider, /#mobileNewBookingButton'\)\.addEventListener\('click', \(\) => openNewBookingSheet\('', \{ date:selectedDate, historical:selectedDate < businessTodayIso\(\) \}\)\)/, 'Мобильная кнопка не открывает выбранный прошедший день');
assert.doesNotMatch(provider, /newBookingHistoricalToggle|Визит уже состоялся/, 'Отдельный переключатель делает длинную форму ещё тяжелее');
assert.match(provider, /id="newBookingHistoricalTime" type="time" step="300"/, 'Нет прямого ввода фактического времени визита');
assert.match(provider, /Время вне рабочего графика[\s\S]*Если визит действительно состоялся, его можно сохранить/, 'Нет спокойного предупреждения о фактическом времени вне графика');
assert.match(provider, /bookingPlacementIssue[\s\S]*allowPast:true, ignoreSchedule:true/, 'Фактическое время не проверяется отдельно от рабочего графика');
assert.match(provider, /const historicalCaption = 'Сохранить';/, 'Нет короткого финального действия');
assert.match(provider, /db\.rpc\('create_minuta_historical_booking'/, 'Прошедший визит не отправляется в защищённую серверную функцию');
assert.doesNotMatch(provider, /id="newBookingDate" type="date" min=/, 'Выбор прошлой даты заблокирован атрибутом min');
assert.doesNotMatch(styles, /\.new-booking-history-option/, 'Стили удалённого переключателя остались в интерфейсе');
assert.match(migration, /p_date\+p_time\+make_interval\(mins=>v_effective_duration\)>timezone\(v_timezone,now\(\)\)/, 'Сервер не подтверждает, что визит действительно завершился');
assert.match(migration, /message='slot_unavailable'/, 'Сервер не защищает прошедшие записи от пересечений');

console.log('Historical booking v400 checks passed.');
