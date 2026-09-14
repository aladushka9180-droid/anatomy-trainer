import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is missing`);
  const body = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = body; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} declaration is incomplete`);
}

const eventHelpers = [
  'reportEventIsImport', 'reportEventAction', 'reportEventContext', 'reportEventActor',
  'reportEventSignedMoney', 'reportEventEffect', 'importantNotificationEventIsRelevant'
].map(declaration).join('\n');
const constants = [
  source.slice(source.indexOf('const REPORT_EVENT_ACTIONS'), source.indexOf('function reportEventIsImport')),
  source.slice(source.indexOf('const IMPORTANT_NOTIFICATION_EVENT_TYPES'), source.indexOf('function importantNotificationStorageName'))
].join('\n');
const context = vm.createContext({ Intl, Set });
vm.runInContext(`${constants}\n${eventHelpers}`, context);

test('important feed keeps only meaningful external events', () => {
  const base = { id:'event', event_type:'booking_rescheduled' };
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'client' }), true);
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'specialist' }), true);
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'owner' }), false);
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'system' }), false);
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'client', details:{ source:'imported_history' } }), false);
  assert.equal(context.importantNotificationEventIsRelevant({ ...base, actor_role:'client', event_type:'internal_sync' }), false);
});

test('event copy separates action, context, factual author and business effect', () => {
  const event = {
    id:'created', event_type:'booking_created_online', actor_role:'client', actor_name:'Ирина',
    client_name:'Ирина', service_name:'Массаж', delta_planned_rub:2500, delta_duration_minutes:40
  };
  assert.equal(context.reportEventAction(event), 'Новая запись от клиента');
  assert.equal(context.reportEventContext(event), 'Ирина · Массаж');
  assert.equal(context.reportEventActor(event), 'Клиент · Ирина');
  assert.equal(context.reportEventEffect(event), 'Ожидаемая выручка +2 500 ₽ · Занятость +40 мин');
  assert.doesNotMatch(context.reportEventEffect(event), /к плану|синхронизировано/i);
  assert.equal(context.reportEventActor({ ...event, actor_role:'system', actor_name:'Система' }), 'Система');
  assert.equal(context.reportEventActor({ ...event, details:{ source:'import' } }), 'Импорт');
});

test('notification, history and template layout contracts are present', () => {
  assert.match(html, /id="importantNotificationList"/);
  assert.match(html, /id="markImportantEventsRead"/);
  assert.match(html, /id="reportLastChangeContext"/);
  assert.match(html, /class="notification-template-fields"/);
  assert.match(html, /class="notification-template-actions"/);
  const notificationView = html.slice(html.indexOf('data-provider-panel="notifications"'), html.indexOf('data-provider-panel="subscription"'));
  assert.doesNotMatch(notificationView, /<h3>Сообщения клиентам<\/h3>/);
  assert.match(css, /\.important-notification-card\.is-unread/);
  assert.match(css, /\.notification-template-fields[^}]*overflow:auto/s);
  assert.match(css, /notification-template-actions[^}]*env\(safe-area-inset-bottom\)/s);
  assert.match(css, /\.report-event-list[^}]*max-height:[^;]+[^}]*overflow:auto/s);
});

test('important event opens the exact linked booking and marks it read', async () => {
  const opened = [];
  const state = {
    importantNotificationState:{ rows:[{ id:'event-7', booking_id:'booking-42' }] },
    allBookings:[{ id:'booking-42' }],
    markImportantNotificationRead:id => opened.push(['read', id]),
    renderNotifications:() => opened.push(['render']),
    setProviderView:view => opened.push(['view', view]),
    openBookingSheet:id => opened.push(['booking', id]),
    Promise
  };
  const linkedContext = vm.createContext(state);
  vm.runInContext(declaration('openImportantNotificationEvent'), linkedContext);
  await linkedContext.openImportantNotificationEvent('event-7');
  assert.deepEqual(opened, [['read','event-7'],['render'],['view','bookings'],['booking','booking-42']]);
});
