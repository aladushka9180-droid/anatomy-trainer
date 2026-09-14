import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const placementStart = source.indexOf('function bookingPlacementIssue(');
const placementEnd = source.indexOf('function clearTimelineBookingUndo(', placementStart);
const slotsStart = source.indexOf('async function loadNewBookingSlots()');
const slotsEnd = source.indexOf('function renderNewBookingTimePicker(', slotsStart);
const messageStart = source.indexOf('function newBookingPreferredUnavailableMarkup()');
const messageEnd = source.indexOf('function renderNewBookingTimePicker(', messageStart);
assert.ok(placementStart >= 0 && placementEnd > placementStart);
assert.ok(slotsStart >= 0 && slotsEnd > slotsStart);
assert.ok(messageStart >= 0 && messageEnd > messageStart);
assert.match(source, /new-booking-validation'[\s\S]{0,260}respectAutomaticBreakReleases:true/);
assert.match(source, /serverConfirmedCurrentSlot = !historical && !block && newBookingSlots\.includes\(newBookingTime\)/);
assert.doesNotMatch(source, /voice-assistant-candidate/);

const minutesFromTime = value => {
  const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};

async function slotFixture(serverSlots, remainingBreaks = []) {
  const fields = {
    '#newBookingService': { value:'service' },
    '#newBookingDate': { value:'2027-01-04' },
    '#newBookingTimes': { innerHTML:'' },
    '#newBookingLocation': { value:'' }
  };
  const sandbox = {
    console,
    Date,
    navigator:{ onLine:true },
    $:selector => fields[selector],
    newBookingMode:'client',
    newBookingHistoricalMode:false,
    newBookingPreferredTime:'15:45',
    newBookingSlots:[],
    newBookingTime:'',
    newBookingHour:'',
    newBookingSlotsRequestId:0,
    bookingPolicy:{ booking_buffer_enabled:true, booking_buffer_minutes:60 },
    automaticBookingBreaksRemoteAvailable:true,
    automaticBookingBreakSegments:new Map(),
    allBookings:[{
      id:'existing-booking', booking_date:'2027-01-04', booking_time:'15:00:00',
      duration_minutes:40, status:'confirmed', client_phone:'79990000000',
      services:{ duration_minutes:40 }
    }],
    scheduleRows:[{ weekday:1, enabled:true, start_time:'10:00', end_time:'20:00' }],
    daysOff:[],
    minutesFromTime,
    timeFromMinutes:value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
    businessTodayIso:() => '2026-09-15',
    bookingMoveTimeIsPast:() => false,
    parseLocalIsoDate:value => new Date(`${value}T12:00:00`),
    isScheduleBlock:item => String(item?.client_phone || '').replace(/\D/g, '') === '0000000000',
    renderNewBookingOutsideSchedulePrompt:() => { fields['#newBookingTimes'].innerHTML = 'outside-schedule'; },
    renderNewBookingTimePicker(){},
    updateNewBookingDurationControl(){},
    updateNewBookingSubmitCaption(){},
    updateNewBookingConnectivity(){},
    clearFormError(){},
    synchronizeProvider(){},
    selectedNewBookingService:() => ({ duration_minutes:15 }),
    newBookingDurationMinutes:() => 15,
    bookingCreationReady:true,
    writesAllowed:true,
    currentUser:{ id:'provider' },
    sessionGeneration:1,
    loadAutomaticBookingBreaks:async date => {
      sandbox.automaticBookingBreakSegments.set(date, remainingBreaks);
      return { ok:true };
    },
    getProviderAvailableSlots:async() => ({
      data:serverSlots.map(booking_time => ({ booking_time })), error:null
    }),
    db:{ rpc:async() => ({ data:[], error:null }) }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(placementStart, placementEnd), sandbox);
  vm.runInContext(source.slice(slotsStart, slotsEnd), sandbox);
  await sandbox.loadNewBookingSlots();
  return sandbox;
}

test('server-authorized slot inside a released automatic buffer remains selectable', async () => {
  const sandbox = await slotFixture(['15:45:00']);
  assert.deepEqual([...sandbox.newBookingSlots], ['15:45']);
  assert.equal(sandbox.newBookingTime, '15:45');
});

test('a stale server slot that overlaps the real booking remains rejected locally', async () => {
  const sandbox = await slotFixture(['15:20:00']);
  assert.deepEqual([...sandbox.newBookingSlots], []);
});

test('the normal local placement guard still rejects an unreleased buffer', async () => {
  const sandbox = await slotFixture([]);
  const issue = sandbox.bookingPlacementIssue(
    { id:'candidate', duration_minutes:15 }, '2027-01-04', minutesFromTime('15:45')
  );
  assert.match(issue, /действует перерыв 60 мин/);
});

test('an unreleased automatic buffer explains why the preferred time is unavailable', async () => {
  const sandbox = await slotFixture([], [{ start_time:'15:40:00', end_time:'16:40:00' }]);
  sandbox.newBookingSlots = ['10:00'];
  sandbox.escapeHtml = value => String(value);
  vm.runInContext(source.slice(messageStart, messageEnd), sandbox);
  const markup = sandbox.newBookingPreferredUnavailableMarkup();
  assert.match(markup, /15:45 закрыто неосвобождённым автоматическим перерывом/);
  assert.match(markup, /15:40–16:40 действует перерыв: автоматический буфер/);
});

test('a service that reaches a real booking reports its duration and collision', async () => {
  const sandbox = await slotFixture([]);
  sandbox.newBookingSlots = ['10:00'];
  sandbox.newBookingPreferredTime = '15:45';
  sandbox.newBookingDurationMinutes = () => 30;
  sandbox.allBookings = [{
    id:'next-booking', booking_date:'2027-01-04', booking_time:'16:00:00',
    duration_minutes:40, status:'confirmed', client_phone:'79990000001',
    services:{ duration_minutes:40 }
  }];
  sandbox.escapeHtml = value => String(value);
  vm.runInContext(source.slice(messageStart, messageEnd), sandbox);
  const markup = sandbox.newBookingPreferredUnavailableMarkup();
  assert.match(markup, /Услуга на 30 мин не помещается в 15:45/);
  assert.match(markup, /В 16:00 уже есть запись/);
});
