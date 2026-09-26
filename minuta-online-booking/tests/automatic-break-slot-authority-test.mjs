import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `actual ${name} declaration`);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `actual ${name} end`);
  return source.slice(start, end + 2);
}

const controller = [
  source.match(/^const NEW_BOOKING_GRID_MINUTES = [^\n]+/m)?.[0] || '',
  declaration('isNewBookingGridTime'),
  declaration('isNewBookingFiveMinuteTime'),
  declaration('newBookingGridSlots'),
  declaration('bookingPlacementIssue'),
  declaration('loadNewBookingSlots'),
  declaration('newBookingPreferredUnavailableMarkup')
].join('\n');

const minutesFromTime = value => {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number);
  return (hours * 60) + minutes;
};

async function fixture({
  serverSlots,
  segments = [],
  bookings = [],
  preferred = '15:45',
  duration = 40,
  workEnd = '20:00'
}) {
  const date = '2027-01-04';
  const fields = {
    '#newBookingService': { value:'service' },
    '#newBookingDate': { value:date },
    '#newBookingTimes': { innerHTML:'' },
    '#newBookingLocation': { value:'' }
  };
  let pickerRendered = 0;
  let automaticBreakRefreshes = 0;
  const sandbox = {
    console,
    Date,
    Promise,
    navigator:{ onLine:true },
    currentUser:{ id:'provider' },
    sessionGeneration:7,
    bookingCreationReady:true,
    writesAllowed:true,
    newBookingMode:'client',
    newBookingHistoricalMode:false,
    newBookingPreferredTime:preferred,
    newBookingSlots:[],
    newBookingTime:'',
    newBookingHour:'',
    newBookingSlotsRequestId:0,
    bookingPolicy:{ booking_buffer_enabled:true, booking_buffer_minutes:60 },
    automaticBookingBreakSegments:new Map(),
    automaticBookingBreaksRemoteAvailable:false,
    scheduleRows:[{ weekday:1, enabled:true, start_time:'10:00', end_time:workEnd }],
    daysOff:[],
    allBookings:bookings,
    $:selector => fields[selector] || null,
    newBookingDurationMinutes:() => duration,
    businessTodayIso:() => '2026-09-15',
    bookingMoveTimeIsPast:() => false,
    minutesFromTime,
    timeFromMinutes:value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
    parseLocalIsoDate:value => new Date(`${value}T12:00:00`),
    isScheduleBlock:item => String(item?.client_phone || '').replace(/\D/g, '') === '0000000000',
    escapeHtml:value => String(value),
    renderNewBookingOutsideSchedulePrompt:() => { fields['#newBookingTimes'].innerHTML = 'outside'; },
    renderNewBookingTimePicker:() => { pickerRendered += 1; },
    updateNewBookingDurationControl:() => {},
    updateNewBookingSubmitCaption:() => {},
    updateNewBookingConnectivity:() => {},
    clearFormError:() => {},
    synchronizeProvider:() => {},
    activeProviderBlockContext:() => ({ organizationId:'', locationId:'' }),
    db:{ rpc:async() => ({ data:[], error:null }) },
    getProviderAvailableSlots:async() => ({
      data:serverSlots.map(booking_time => ({ booking_date:date, booking_time })),
      error:null
    }),
    loadAutomaticBookingBreaks:async requestedDate => {
      automaticBreakRefreshes += 1;
      sandbox.automaticBookingBreakSegments.set(requestedDate, segments);
      sandbox.automaticBookingBreaksRemoteAvailable = true;
      return { ok:true };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(controller, sandbox);
  await sandbox.loadNewBookingSlots();
  return {
    sandbox,
    pickerRendered,
    automaticBreakRefreshes,
    warning:() => sandbox.newBookingPreferredUnavailableMarkup()
  };
}

const bookingAt1500 = [{
  id:'booking-15', booking_date:'2027-01-04', booking_time:'15:00:00',
  duration_minutes:40, status:'confirmed', client_phone:'79990000000'
}];

test('released automatic break keeps server-confirmed half-hour slots after refresh', async () => {
  const result = await fixture({ serverSlots:['16:00:00', '16:30:00'], segments:[], bookings:bookingAt1500, preferred:'16:00' });
  assert.deepEqual([...result.sandbox.newBookingSlots], ['16:00', '16:30']);
  assert.equal(result.sandbox.newBookingTime, '16:00');
  assert.equal(result.warning(), '');
  assert.equal(result.automaticBreakRefreshes, 1);
  assert.equal(result.pickerRendered, 1);
});

test('an unreleased server break remains forbidden with the exact interval', async () => {
  const result = await fixture({
    serverSlots:['17:00:00'],
    segments:[{ start_time:'15:40:00', end_time:'16:40:00' }],
    bookings:bookingAt1500,
    preferred:'16:00'
  });
  assert.deepEqual([...result.sandbox.newBookingSlots], ['17:00']);
  assert.match(result.warning(), /15:40–16:40 действует перерыв: автоматический буфер/);
});

test('a real booking overlap remains forbidden with the conflicting start time', async () => {
  const result = await fixture({ serverSlots:['17:00:00'], segments:[], bookings:bookingAt1500, preferred:'15:30' });
  assert.match(result.warning(), /В 15:00 уже есть запись/);
});

test('a service that extends beyond the workday remains forbidden with the duration reason', async () => {
  const result = await fixture({ serverSlots:['15:00:00'], segments:[], preferred:'15:30', duration:60, workEnd:'16:00' });
  assert.match(result.warning(), /Запись должна оставаться в пределах рабочего дня/);
});

test('provider and assistant consume the protected server slot list without reconstructing a released buffer', () => {
  const loader = declaration('loadNewBookingSlots');
  assert.match(loader, /new-booking-candidate'[\s\S]{0,260}respectAutomaticBreakReleases:true/);
  assert.match(source, /serverConfirmedCurrentSlot = !historical && !block && newBookingSlots\.includes\(newBookingTime\)/);
  assert.doesNotMatch(source, /voice-assistant-candidate/);
});
