import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('function stopLiveUpdates()'), source.indexOf('async function refreshAfterWrite()'));
const eventsStart = source.indexOf('function resumeProviderConnection(');
const eventsSource = source.slice(eventsStart, source.indexOf("$('#retryOfflineBookings')", eventsStart));
function harness() {
  let nextTimer = 0;
  const timers = new Map();
  const channels = [];
  const states = [];
  const events = new Map();
  const context = {
    currentUser:{id:'first'}, sessionGeneration:1, bookingsChannel:null,
    syncTimer:null, visitorPresenceTimer:null, bookingReloadTimer:null,
    liveReconnectTimer:null, liveReconnectAttempt:0, lastLiveRecoveryAt:0,
    synchronizationPromise:null, synchronizationGeneration:-1, synchronizationQueued:false,
    pendingSynchronizationTables:new Set(), pendingFullSynchronization:false,
    portfolioSyncLoaded:false, portfolioSyncDirty:true, lastProviderVerificationAt:0,
    synchronizationRetryTimer:null, writesAllowed:true, offlineBookingInputsReady:false,
    visitorVisitsRemoteAvailable:false, SERVICE_SYNC_INTERVAL_MS:300000,
    navigator:{onLine:true}, document:{hidden:false,addEventListener:(name,callback)=>events.set(name,callback)}, Math,
    window:{addEventListener:(name,callback)=>events.set(name,callback)},
    performance:{now:()=>1}, Date:class extends Date { static now(){return context.now;} }, offlineBookingQueue:[],
    now:100000, providerHiddenAt:0, connectionWasOffline:false, bookingCreationReady:false,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id,{fn,delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return ++nextTimer; }, clearInterval() {},
    db:{
      channel(name) { const channel = {name,handlers:new Map(),on(event,filter,callback){this.handlers.set(filter.table,callback);return this;},subscribe(fn){this.notify=fn;return this;}}; channels.push(channel); return channel; },
      removeChannel(channel) { channel.notify?.('CLOSED'); return Promise.resolve('ok'); }
    },
    sessionIsCurrent:(id,generation)=>context.currentUser?.id===id && context.sessionGeneration===generation,
    setSyncState:(...state)=>states.push(state),
    setWritesAllowed:value=>{context.writesAllowed=value;}, setBookingCreationReady:value=>{context.bookingCreationReady=value;},
    renderVisitorVisits() {}, refreshBusinessDay() {}, handleVisitorVisit() {},
    freeSlotsController:{refresh(){}}, providerPerformance:{measure(){}},
    loadRemoteBookingColors:async()=>true, renderBookingData(){},
    applyAutomaticVisitOutcomes:async()=>{}, flushOfflineBookings:async()=>{},
    canQueueOfflineBooking:()=>false, reliability:{savedAtLabel:()=>''},
    organizationController:{load:async()=>({ok:true})}, teamCalendarController:{load:async()=>({ok:true})},
    loads:0, loadNames:[],
    renderTopbarDateTime(){},renderNotifications(){},queueDisplayPreferencesSync(){},
    renderOfflineBookingQueue(){},updateNewBookingConnectivity(){},notify(){},$:()=>null,
  };
  for (const name of ['loadBookings','loadOwnServices','loadSchedule','loadDaysOff','loadBookingSettings','loadClientNotes','loadClientLabels','loadClientAvatars','loadBookingSessionItems','loadBookingOutcomes','loadPortfolio','loadWaitlist','loadProviderReviews']) context[name] = async()=>{context.loads++;context.loadNames.push(name);return {ok:true};};
  vm.createContext(context);
  vm.runInContext(section + eventsSource,context);
  const fire = id => {const entry=timers.get(id);assert.ok(entry);timers.delete(id);entry.fn();};
  const drain = async()=>{await Promise.resolve();if(context.synchronizationPromise) await context.synchronizationPromise;await Promise.resolve();};
  return {c:context,channels,timers,states,events,fire,drain};
}

{
  const h=harness();h.c.startLiveUpdates();h.channels[0].notify('SUBSCRIBED');
  assert.ok(h.c.bookingReloadTimer,'reconnect must fetch missed changes even when writes were already allowed');
  h.fire(h.c.bookingReloadTimer);await h.drain();assert.ok(h.c.loads>0);
}
{
  const h=harness();h.c.startLiveUpdates();h.c.stopLiveUpdates();
  assert.equal(h.c.bookingsChannel,null);
  assert.equal(h.timers.size,0,'intentional close must not schedule a reconnect');
  assert.equal(h.c.writesAllowed,true,'intentional close callback must not disable writes');
}
{
  const h=harness();h.c.startLiveUpdates();const first=h.channels[0];first.notify('CHANNEL_ERROR');
  assert.equal(h.c.writesAllowed,false);
  const timer=h.c.liveReconnectTimer;assert.ok(timer);
  assert.ok(h.timers.get(timer).delay>=1500 && h.timers.get(timer).delay<=1750);
  first.notify('TIMED_OUT');assert.equal(h.c.liveReconnectTimer,timer,'stale channel cannot create duplicate retries');
  h.fire(timer);assert.equal(h.channels.length,2);
  h.channels[1].notify('TIMED_OUT');const second=h.c.liveReconnectTimer;
  assert.ok(h.timers.get(second).delay>=3000);
  h.c.currentUser={id:'second'};h.c.sessionGeneration++;
  h.fire(second);assert.equal(h.channels.length,2,'old-account retry cannot create a channel for a new session');
}
{
  const h=harness();h.c.startLiveUpdates();h.channels[0].notify('CHANNEL_ERROR');
  h.c.document.hidden=true;h.fire(h.c.liveReconnectTimer);
  assert.equal(h.channels.length,1,'no reconnect churn in a hidden app');
  h.c.document.hidden=false;h.c.recoverLiveUpdates(true);
  assert.equal(h.channels.length,2,'foreground recovery must replace the lost channel');
  h.c.recoverLiveUpdates(true);assert.equal(h.channels.length,2,'duplicate resume signals must be coalesced');
}
{
  const h=harness();h.c.navigator.onLine=false;h.c.startLiveUpdates();
  assert.equal(h.channels.length,0,'offline should not create a channel');
}
{
  const h=harness();h.c.loadOwnServices=async()=>{throw new Error('temporary_failure');};
  assert.equal(await h.c.synchronizeProvider(),false,'rejected request must become a recoverable incomplete sync');
  await h.drain();assert.equal(h.c.synchronizationPromise,null);
  assert.ok(h.c.synchronizationRetryTimer,'failed sync must retry automatically');
}
{
  const h=harness();h.c.startLiveUpdates();
  h.c.document.hidden=true;h.events.get('visibilitychange')();
  h.c.now+=31000;h.c.document.hidden=false;h.events.get('visibilitychange')();
  await h.drain();assert.equal(h.channels.length,2,'long background sleep must refresh the live channel');
  h.c.document.hidden=true;h.events.get('visibilitychange')();
  h.c.now+=1000;h.c.document.hidden=false;h.events.get('visibilitychange')();
  await h.drain();assert.equal(h.channels.length,2,'short tab switch must not churn a live channel');
  h.c.now+=3000;h.events.get('pageshow')({persisted:true});
  await h.drain();assert.equal(h.channels.length,3,'restoration from browser back-forward cache must recover connection');
}
{
  const h=harness();h.c.startLiveUpdates();h.channels[0].notify('CHANNEL_ERROR');
  h.c.navigator.onLine=false;h.events.get('offline')();
  assert.equal(h.timers.size,0,'offline must clear pending reconnects and reloads');
  h.c.navigator.onLine=true;await h.events.get('online')();
  assert.equal(h.channels.length,2,'network restoration must open a live channel independently of reload results');
  assert.ok(h.c.loads>0);assert.equal(h.c.connectionWasOffline,false);
}
{
  const h=harness();h.c.freeSlotsController.refresh=()=>{throw new Error('unexpected_refresh_error');};
  const run=h.c.synchronizeProvider();
  assert.equal(h.c.synchronizeProvider(),run,'simultaneous callers must share the same sync');
  assert.equal(await run,false);await h.drain();
  assert.equal(h.c.writesAllowed,false);assert.equal(h.c.synchronizationPromise,null);
  const timer=h.c.synchronizationRetryTimer;assert.ok(timer);
  const loads=h.c.loads;h.c.currentUser={id:'new'};h.c.sessionGeneration++;
  h.fire(timer);assert.equal(h.c.loads,loads,'old sync retry cannot run for a new session');
}
{
  const h=harness();h.c.startLiveUpdates();
  for(let i=0;i<8;i++) {
    h.channels.at(-1).notify('CHANNEL_ERROR');
    assert.ok(h.timers.get(h.c.liveReconnectTimer).delay<=30000,'reconnect delay must be capped');
    h.fire(h.c.liveReconnectTimer);
  }
  h.channels.at(-1).notify('SUBSCRIBED');
  assert.equal(h.c.liveReconnectAttempt,0,'successful connection resets backoff');
}
{
  const h = harness();
  h.c.scheduleBookingsReload();
  const timer = h.c.bookingReloadTimer;
  h.c.currentUser = { id:'new' };
  h.c.sessionGeneration++;
  h.fire(timer);
  assert.equal(h.c.loads, 0, 'old account reload cannot run for a new session');
}
{
  const h = harness();
  let finishOutcomes;
  let outcomesStarted;
  const started = new Promise(resolve => { outcomesStarted = resolve; });
  h.c.applyAutomaticVisitOutcomes = () => {
    outcomesStarted();
    return new Promise(resolve => { finishOutcomes = resolve; });
  };
  const run = h.c.synchronizeProvider();
  await started;
  h.c.navigator.onLine = false;
  h.events.get('offline')();
  finishOutcomes();
  assert.equal(await run, false);
  await h.drain();
  assert.equal(h.states.at(-1)[0], 'offline', 'late completion cannot restore an online status while offline');
  assert.equal(h.c.writesAllowed, false);
}
{
  const h = harness();
  const run = h.c.synchronizeProvider();
  h.c.synchronizationQueued = true;
  await run;
  await h.drain();
  const timer = h.c.bookingReloadTimer;
  assert.ok(timer, 'events received during a sync need one follow-up reload');
  h.c.currentUser = { id:'new' };
  h.c.sessionGeneration++;
  const loads = h.c.loads;
  h.fire(timer);
  assert.equal(h.c.loads, loads, 'queued follow-up remains owned by its original session');
}
console.log('Connection recovery checks passed: catch-up, teardown, bounded retries, offline/online, background resume, bfcache, failures and session ownership');

{
  const h = harness();
  let finishDetails;
  let detailsStarted;
  const started = new Promise(resolve => { detailsStarted = resolve; });
  h.c.loadBookingSettings = () => {
    detailsStarted();
    return new Promise(resolve => { finishDetails = resolve; });
  };
  h.c.writesAllowed = false;
  let settled = false;
  const run = h.c.synchronizeProvider().then(value => { settled = true; return value; });
  await started;
  assert.equal(h.c.bookingCreationReady, true, 'core readiness must not wait for notification/settings details');
  assert.equal(h.c.writesAllowed, false, 'early readiness must not enable unrelated writes');
  assert.equal(settled, false, 'full-sync callers still await all required sections');
  finishDetails({ ok:true, optional:true });
  assert.equal(await run, true);
}
assert.match(source, /loadBookings\(\{ silent:true, deferPresentation:true \}\)/);
assert.match(source, /if \(!options\.deferPresentation\) await loadRemoteBookingColors/);
{
  const h = harness();
  let detailsLoaded = false;
  h.c.loadBookings = async () => ({ ok:false, cached:true, savedAt:'2026-09-05T10:00:00Z' });
  h.c.loadBookingSettings = async () => { detailsLoaded = true; return { ok:true }; };
  assert.equal(await h.c.synchronizeProvider(), false);
  assert.equal(detailsLoaded, false, 'failed core reads must not fan out into secondary requests');
  assert.equal(h.c.bookingCreationReady, false);
  assert.equal(h.c.writesAllowed, false);
  assert.ok(h.c.synchronizationRetryTimer);
}
console.log('Priority sync checks passed: journal readiness before details, write gates and deferred presentation');

{
  const h = harness();
  h.c.bookingCreationReady = true;
  h.c.lastProviderVerificationAt = 12345;
  h.c.startLiveUpdates();
  h.channels[0].handlers.get('client_labels')({ table:'client_labels' });
  h.fire(h.c.bookingReloadTimer);
  await h.drain();
  assert.deepEqual(h.c.loadNames, ['loadClientLabels'], 'one label event must not reload the journal or other sections');
  assert.equal(h.c.lastProviderVerificationAt, 12345, 'partial reads must not renew the journal verification timestamp');
}
{
  const h = harness();
  h.c.bookingCreationReady = true;
  for (const table of ['client_notes', 'client_labels', 'client_notes', 'booking_session_items']) h.c.scheduleBookingsReload({ table });
  h.fire(h.c.bookingReloadTimer);
  await h.drain();
  assert.deepEqual(h.c.loadNames.sort(), ['loadBookingSessionItems', 'loadClientLabels', 'loadClientNotes'], 'burst events are merged by table');
}
{
  const h = harness();
  h.c.bookingCreationReady = true;
  h.c.startLiveUpdates();
  let finish;
  h.c.loadClientLabels = () => new Promise(resolve => { finish = resolve; });
  const run = h.c.synchronizeProvider({ tables:['client_labels'], background:true });
  await Promise.resolve();
  h.c.scheduleBookingsReload('client_notes');
  h.c.scheduleBookingsReload('client_avatars');
  h.fire(h.c.bookingReloadTimer);
  finish({ ok:true });
  await run; await h.drain();
  h.fire(h.c.bookingReloadTimer);
  await h.drain();
  assert.deepEqual(h.c.loadNames.sort(), ['loadClientAvatars', 'loadClientNotes'], 'events arriving during a sync retain their domains');
}
{
  const h = harness();
  h.c.bookingCreationReady = true;
  h.c.scheduleBookingsReload('client_labels');
  h.c.scheduleBookingsReload();
  h.fire(h.c.bookingReloadTimer);
  await h.drain();
  assert.ok(h.c.loadNames.includes('loadBookings'), 'a reconnect/full-check request wins over narrow updates');
  assert.equal(h.c.lastProviderVerificationAt, h.c.now);
  const checked = h.c.lastProviderVerificationAt;
  h.c.navigator.onLine = false; h.events.get('offline')();
  assert.equal(h.c.lastProviderVerificationAt, checked, 'offline retains the last server verification');
}
for (const table of ['bookings', 'services', 'provider_schedule', 'provider_days_off', 'unknown_table']) {
  const h = harness(); h.c.bookingCreationReady = true;
  await h.c.synchronizeProvider({ tables:[table], background:true });
  assert.ok(h.c.loadNames.includes('loadBookings'), table + ' must reconcile journal dependencies');
  assert.ok(h.c.loadNames.includes('loadSchedule'));
}
{
  const h = harness(); h.c.bookingCreationReady = true; h.c.writesAllowed = false;
  await h.c.synchronizeProvider({ tables:['client_labels'], background:true });
  assert.ok(h.c.loadNames.includes('loadBookings'), 'a narrow update cannot bypass a failed full-sync write gate');
}
{
  const h = harness(); h.c.bookingCreationReady = true;
  h.c.loadClientNotes = async () => { throw new Error('offline'); };
  assert.equal(await h.c.synchronizeProvider({ tables:['client_notes'] }), false);
  assert.equal(h.c.writesAllowed, false);
  assert.ok(h.c.synchronizationRetryTimer, 'failed required targeted reads schedule a full recovery');
}
{
  const h = harness(); h.c.bookingCreationReady = true; h.c.startLiveUpdates();
  let finish;
  h.c.loadClientLabels = () => new Promise(resolve => { finish = resolve; });
  const run = h.c.synchronizeProvider({ tables:['client_labels'] });
  await Promise.resolve();
  h.channels[0].notify('CHANNEL_ERROR');
  finish({ ok:true }); await run; await h.drain();
  assert.equal(h.c.writesAllowed, false);
  assert.notEqual(h.states.at(-1)[0], 'online', 'late targeted reads cannot mask a lost connection');
  assert.ok(h.c.bookingReloadTimer);
}
{
  const h = harness(); h.c.bookingCreationReady = true;
  let finish;
  h.c.loadClientLabels = () => new Promise(resolve => { finish = resolve; });
  const run = h.c.synchronizeProvider({ tables:['client_labels'] });
  await Promise.resolve();
  const count = h.states.length;
  h.c.currentUser = { id:'new' }; h.c.sessionGeneration++;
  finish({ ok:true }); assert.equal(await run, false);
  assert.equal(h.states.length, count, 'old-account partial results cannot update connection state');
}
{
  const h = harness();
  await h.c.synchronizeProvider({ background:true }); await h.drain();
  assert.ok(h.c.loadNames.includes('loadPortfolio'), 'initial load retains sidebar counts');
  h.c.loadNames.length = 0;
  await h.c.synchronizeProvider({ background:true }); await h.drain();
  assert.ok(!h.c.loadNames.includes('loadPortfolio') && !h.c.loadNames.includes('loadProviderReviews'), 'hidden portfolio media/reviews skip repeat background downloads');
  assert.equal(h.c.portfolioSyncDirty, true);
  h.c.loadNames.length = 0;
  await h.c.synchronizeProvider({ tables:['portfolio_photos'], background:true }); await h.drain();
  assert.equal(h.c.loads > 0, true);
  assert.deepEqual(h.c.loadNames, [], 'hidden photo-only changes can wait');
  h.c.$ = selector => selector === '#dashboard' ? { dataset:{ activeView:'portfolio' } } : null;
  await h.c.synchronizeProvider({ tables:['portfolio_photos'], background:true }); await h.drain();
  assert.deepEqual(h.c.loadNames.sort(), ['loadPortfolio', 'loadProviderReviews']);
  assert.equal(h.c.portfolioSyncDirty, false);
  h.c.loadNames.length = 0; h.c.$ = () => null;
  await h.c.synchronizeProvider({ tables:['portfolio_items'], background:true }); await h.drain();
  assert.ok(h.c.loadNames.includes('loadPortfolio'), 'item changes keep the navigation count current');
  h.c.loadNames.length = 0;
  await h.c.synchronizeProvider(); await h.drain();
  assert.ok(h.c.loadNames.includes('loadPortfolio'), 'explicit refresh still checks every section');
}
for (const result of [{ ok:false, cached:true }, { ok:true, skipped:true }]) {
  const h = harness(); h.c.lastProviderVerificationAt = 12345;
  h.c.loadSchedule = async () => result;
  await h.c.synchronizeProvider();
  assert.equal(h.c.lastProviderVerificationAt, 12345, 'cached/unsaved schedules do not get a new server verification time');
}
{
  const h = harness(); const badge = {}, log = {};
  h.c.$ = selector => selector === '#syncVerifiedAt' ? badge : selector === '#connectionLogVerifiedAt' ? log : null;
  h.c.renderProviderVerification();
  assert.equal(badge.textContent, 'Сверка ещё не выполнена');
  h.c.lastProviderVerificationAt = Date.parse('2026-09-05T10:45:00Z');
  h.c.renderProviderVerification();
  assert.match(badge.textContent, /Сверка 05\.09, /);
  assert.match(log.textContent, /Записи и расписание проверены на сервере/);
}
assert.match(source, /view === 'portfolio' && currentUser && navigator.onLine && portfolioSyncDirty/);
assert.match(source, /lastProviderVerificationAt = 0;[\s\S]*portfolioSyncLoaded = false;[\s\S]*portfolioSyncDirty = true;/);
console.log('Targeted sync checks passed: domain coalescing, catch-up priority, lazy portfolio, verification time and write/session safety.');
