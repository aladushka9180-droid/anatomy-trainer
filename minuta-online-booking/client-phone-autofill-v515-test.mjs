import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const providerSource = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const start = providerSource.indexOf('let newBookingClientSuggestionMap = new Map();');
const end = providerSource.indexOf('function setNewBookingMode(mode)', start);
assert.ok(start >= 0 && end > start, 'Client lookup implementation must remain discoverable');

function createHarness(clients) {
  const nodes = {
    '#newBookingName':{ value:'', dataset:{} },
    '#newBookingPhone':{ value:'', dataset:{} },
    '#newBookingNote':{ value:'', dataset:{} },
    '#newBookingSheetTitle':{ textContent:'Новая запись', dataset:{} },
    '#newBookingSectionSubtitle':{ textContent:'Только необходимое для записи', dataset:{} },
    '#newBookingClientFields':{ dataset:{} },
    '#newBookingClientSuggestions':{ hidden:true, innerHTML:'', dataset:{} },
    '#newBookingRecentCalls':{ hidden:true, dataset:{} },
    '#newBookingForm':{ dataset:{} }
  };
  const context = {
    Map,
    Set,
    clearTimeout,
    setTimeout,
    clientNotes:new Map(),
    newBookingMode:'client',
    saveCount:0,
    buildClients:() => clients,
    normalizePhone(value) {
      let digits = String(value || '').replace(/\D/g, '');
      if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
      if (digits.length === 10) digits = `7${digits}`;
      return digits.length >= 11 && digits.length <= 15 && !digits.startsWith('0') ? digits : '';
    },
    escapeHtml:value => String(value),
    $:selector => nodes[selector] || null,
    saveNewBookingDraft() { context.saveCount += 1; }
  };
  vm.createContext(context);
  vm.runInContext(`${providerSource.slice(start, end)}\nglobalThis.lookupApi = { newBookingClientCandidates, handleNewBookingPhoneInput, selectNewBookingClient, refreshNewBookingRecentCalls, chooseNewBookingRecentCall, receiveNewBookingRecentCall };`, context);
  return { context, nodes, api:context.lookupApi };
}

const anna = {
  phone:'79990509525',
  displayPhone:'+7 (999) 050-95-25',
  name:'Анна',
  bookings:[{ client_name:'Анна' }]
};

const boris = {
  phone:'79525117777',
  displayPhone:'+7 (952) 511-77-77',
  name:'Борис',
  bookings:[{ client_name:'Борис' }]
};

const vera = {
  phone:'79009525111',
  displayPhone:'+7 (900) 952-51-11',
  name:'Вера',
  bookings:[{ client_name:'Вера' }]
};

{
  const { nodes, api, context } = createHarness([anna]);
  let openCount = 0;
  context.PrimeTimeAndroidCalls = { isAvailable:() => true, openRecentCalls:() => { openCount += 1; } };
  api.refreshNewBookingRecentCalls();
  assert.equal(nodes['#newBookingRecentCalls'].hidden, false, 'Android companion must expose the recent-calls action');
  api.chooseNewBookingRecentCall();
  assert.equal(openCount, 1, 'The web action must delegate the private call-log picker to Android');
  assert.equal(api.receiveNewBookingRecentCall('+7 (999) 050-95-25'), true);
  assert.equal(nodes['#newBookingName'].value, 'Анна', 'Selected recent caller must use the existing CRM autofill');
  assert.equal(nodes['#newBookingPhone'].value, '+7 (999) 050-95-25');
}

{
  const { nodes, api } = createHarness([]);
  assert.equal(api.receiveNewBookingRecentCall('8 999 111-22-33'), true);
  assert.equal(nodes['#newBookingPhone'].value, '+7 (999) 111-22-33');
  assert.equal(nodes['#newBookingClientFields'].dataset.clientLookupState, 'recent-call');
  assert.equal(nodes['#newBookingSectionSubtitle'].textContent, 'Номер из недавнего звонка — укажите имя');
  assert.equal(api.receiveNewBookingRecentCall('скрытый номер'), false, 'Private or invalid caller IDs must not enter the form');
}

{
  const { nodes, api, context } = createHarness([anna]);
  nodes['#newBookingPhone'].value = '8 (999) 050-95-25';
  api.handleNewBookingPhoneInput();
  assert.equal(nodes['#newBookingName'].value, 'Анна', 'Exact pasted phone must autofill the client name');
  assert.equal(nodes['#newBookingPhone'].value, '+7 (999) 050-95-25', 'Matched phone must be normalized for display');
  assert.equal(nodes['#newBookingSectionSubtitle'].textContent, 'Клиент найден в базе');
  assert.equal(context.saveCount, 1, 'Autofill must update the saved form draft');

  nodes['#newBookingPhone'].value = '+7 (999) 050-95-26';
  api.handleNewBookingPhoneInput();
  assert.equal(nodes['#newBookingName'].value, '', 'Changing an autofilled phone must remove the stale autofilled name');
}

{
  const { nodes, api } = createHarness([anna]);
  nodes['#newBookingName'].value = 'Введено вручную';
  nodes['#newBookingPhone'].value = '+7 (999) 050-95-25';
  api.handleNewBookingPhoneInput();
  assert.equal(nodes['#newBookingName'].value, 'Введено вручную', 'Phone lookup must not overwrite a manually entered name');
  assert.equal(nodes['#newBookingSectionSubtitle'].textContent, 'Клиент найден — введённое имя сохранено');
}

{
  const clientWithAliases = {
    ...anna,
    name:'Анна Новая',
    bookings:[{ client_name:'Анна' }, { client_name:'Анна Новая' }]
  };
  const { nodes, api } = createHarness([clientWithAliases]);
  nodes['#newBookingPhone'].value = '+7 (999) 050-95-25';
  api.handleNewBookingPhoneInput();
  assert.equal(nodes['#newBookingName'].value, '', 'Conflicting names for one phone must require a choice');
  assert.equal(nodes['#newBookingClientSuggestions'].hidden, false);
  assert.equal(nodes['#newBookingSectionSubtitle'].textContent, 'Найдено несколько имён — выберите клиента');
  api.selectNewBookingClient('0');
  assert.equal(nodes['#newBookingName'].value, 'Анна Новая', 'The latest client name must be the first choice');
}

{
  const { api } = createHarness([vera, boris, anna]);
  assert.deepEqual(
    Array.from(api.newBookingClientCandidates('95-25'), client => client.name),
    ['Анна', 'Борис', 'Вера'],
    'A formatted four-digit query must rank a matching suffix ahead of prefix and middle matches'
  );
  assert.equal(api.newBookingClientCandidates('050 95 25')[0].name, 'Анна', 'Seven remembered digits must find the client');
  assert.equal(api.newBookingClientCandidates('999-050')[0].name, 'Анна', 'A national prefix must find the client without +7');
  assert.equal(api.newBookingClientCandidates('8 (999) 050')[0].name, 'Анна', 'A partial Russian trunk prefix must match +7 storage');
  assert.equal(api.newBookingClientCandidates('525').length, 0, 'Three digits are too short for a safe phone match');
}

console.log('PASS: smart phone lookup ranks exact, suffix, prefix and formatted Russian matches');
