import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(root,'supabase-migration-v102.sql'),'utf8');
const rollback = readFileSync(join(root,'recovery','rollback-team-calendar-dispatcher-v102.sql'),'utf8');
const controller = readFileSync(join(root,'team-calendar.js'),'utf8');
const styles = readFileSync(join(root,'styles.css'),'utf8');

assert.match(migration,/get_minuta_team_calendar_v3[\s\S]*security definer[\s\S]*set search_path to ''/i,'Календарь диспетчера должен читаться через защищённый RPC');
assert.match(migration,/create_minuta_team_booking_v102[\s\S]*get_minuta_schedule_role[\s\S]*owner','admin'/i,'Создание командной записи должно требовать роль управляющего');
assert.match(migration,/move_minuta_team_booking_v102[\s\S]*for update[\s\S]*minuta_booking_fits_active_shift[\s\S]*team_booking_slot_unavailable/i,'Перенос должен блокировать запись и повторно проверять смену и конфликт на сервере');
assert.match(migration,/notification_outbox[\s\S]*booking_moved_by_dispatcher[\s\S]*enqueue_minuta_booking_notification\(p_booking,'booking_rescheduled'\)/i,'Перенос должен отменять устаревшие доставки и ставить актуальное уведомление');
assert.match(migration,/team_series_move_requires_scope/i,'Перетаскивание серии без выбранной области должно быть запрещено');
assert.match(migration,/revoke all on function public\.get_minuta_team_calendar_v3[\s\S]*grant execute[\s\S]*to authenticated/i,'ACL новых RPC должны быть явными');
assert.match(rollback,/drop function if exists public\.move_minuta_team_booking_v102[\s\S]*drop function if exists public\.get_minuta_team_calendar_v3/i,'Rollback должен удалять все функции диспетчера');
assert.match(controller,/get_minuta_team_calendar_v3[\s\S]*get_minuta_team_calendar_v2[\s\S]*get_minuta_team_calendar/i,'Новый интерфейс должен безопасно откатываться к прежнему календарю');
assert.match(controller,/team-dispatcher-stage[\s\S]*data-team-booking-id[\s\S]*move_minuta_team_booking_v102/i,'Командный день должен быть интерактивной временной сеткой');
assert.match(styles,/\.team-dispatcher[\s\S]*\.team-dispatcher-booking[\s\S]*@media \(max-width:760px\)/i,'Сетка должна иметь отдельную мобильную компоновку');
assert.doesNotMatch(controller,/localStorage|sessionStorage|indexedDB|\.put\(/i,'Командный календарь не должен сохранять персональные данные на устройстве');

console.log('team calendar dispatcher v102 static tests passed');
