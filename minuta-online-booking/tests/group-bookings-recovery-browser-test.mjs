import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const playwrightPath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : 'playwright');
const controllerSource = readFileSync(new URL('../group-bookings.js', import.meta.url), 'utf8');
const sourceHtml = {
  provider:readFileSync(new URL('../provider.html', import.meta.url), 'utf8'),
  public:readFileSync(new URL('../index.html', import.meta.url), 'utf8')
};
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const pageErrors = [];

async function fixture(kind) {
  const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => pageErrors.push(error.message));
  // A secure local fixture origin gives the real browser crypto API; all traffic is intercepted.
  await page.route('**/*', route => route.fulfill({ contentType:'text/html',
    body:'<!doctype html><html lang="ru"><meta charset="utf-8"><title>Group recovery test</title><body></body></html>' }));
  await page.goto('https://group-recovery.test/');
  await page.evaluate(({ html, kind }) => {
    const source = new DOMParser().parseFromString(html, 'text/html');
    const ids = kind === 'provider' ? ['groupBookingSettingsCard', 'groupEventsPanel', 'groupEventDialog']
      : ['publicGroupEvents', 'publicGroupBookingDialog'];
    for (const id of ids) {
      const element = source.getElementById(id);
      if (!element) throw new Error(`Missing real HTML fixture #${id}`);
      document.body.append(document.importNode(element, true));
    }
  }, { html:sourceHtml[kind], kind });
  // Layout only: preserve native dialog/form/input behavior without booting the entire application.
  await page.addStyleTag({ content:'svg{width:20px;height:20px}dialog{max-height:85vh;overflow:auto;width:600px}label{display:block;margin:10px 0}input,textarea,select,button{font:16px sans-serif}button{min-height:36px}' });
  await page.addScriptTag({ content:controllerSource });
  await page.evaluate(async kind => {
    const $ = selector => document.querySelector(selector);
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
      char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const event = { id:'event-a', title:'Существующее занятие', description:'Описание',
      event_date:'2099-05-10', start_time:'12:00:00', duration_minutes:60,
      capacity:6, seats_left:5, status:'published', participants:[],
      performer_id:'performer', performer_name:'Мастер', location_id:'location', location_name:'Кабинет' };
    window.testState = { mode:'success', calls:[], notices:[], settled:0 };
    const db = { rpc:async (name, args) => {
      const state = window.testState;
      state.calls.push({ name, args:structuredClone(args) });
      if (name === 'get_minuta_group_booking_admin') return { data:{ enabled:true, events:[event],
        performers:[{ id:'performer', name:'Мастер' }], locations:[{ id:'location', name:'Кабинет' }] }, error:null };
      if (name === 'get_public_minuta_group_events') return { data:{ enabled:true, events:[event] }, error:null };
      try {
        if (state.mode === 'hold') await new Promise(resolve => { state.release = resolve; });
        if (state.mode === 'throw') throw new Error('reply lost after commit');
        if (state.mode === 'reject') return { data:null, error:{ code:'22023', message:'invalid_group_participant' } };
        return { data:name === 'upsert_minuta_group_event' ? 'event-a'
          : { participant_id:'participant-a', booking_code:'GRP-TEST', status:'confirmed' }, error:null };
      } finally { state.settled += 1; }
    } };
    const options = { db, $, escapeHtml, notify:message => window.testState.notices.push(message) };
    if (kind === 'provider') {
      window.controller = window.MinutaGroupBookings.createProviderController({ ...options,
        requireWrites:() => true, getCurrentUser:() => ({ id:'owner' }), getSessionGeneration:() => 1,
        sessionIsCurrent:() => true, applyWriteAvailability() {} });
      window.controller.bind();
      await window.controller.setOrganization({ id:'organization', current_role:'owner' });
    } else {
      window.controller = window.MinutaGroupBookings.createPublicController({ ...options, getSlug:() => 'studio' });
      window.controller.bind();
      await window.controller.load();
    }
  }, kind);
  return page;
}

async function publicForm(page) {
  await page.locator('[data-book-group-event="event-a"]').click();
  await page.locator('#publicGroupClientName').fill('Ирина');
  await page.locator('#publicGroupClientPhone').fill('+79990000000');
  await page.locator('#publicGroupClientComment').fill('Первоначальный комментарий');
  await page.locator('#publicGroupConsent').check();
}
const publicSubmit = page => page.locator('#publicGroupBookingForm button[type="submit"]');
const providerSubmit = page => page.locator('#groupEventForm button[type="submit"]');
async function runCase(title, kind, run) {
  const page = await fixture(kind);
  try { await run(page); console.log(`PASS: ${title}`); }
  finally { await page.close(); }
}

try {
  await runCase('native public readonly and exact retry after ambiguous response', 'public', async page => {
    await publicForm(page);
    await page.evaluate(() => { testState.mode = 'throw'; });
    await publicSubmit(page).click();
    await page.locator('#publicGroupBookingError').waitFor({ state:'visible' });
    for (const id of ['publicGroupClientName', 'publicGroupClientPhone', 'publicGroupClientComment']) {
      assert.equal(await page.locator(`#${id}`).evaluate(input => input.readOnly), true);
    }
    const name = page.locator('#publicGroupClientName');
    await name.focus();
    await name.press('ControlOrMeta+A');
    await page.keyboard.insertText('Нельзя изменить');
    assert.equal(await name.inputValue(), 'Ирина', 'native readonly must reject keyboard edits');
    assert.equal(await publicSubmit(page).isDisabled(), false);
    await page.evaluate(() => {
      document.querySelector('#publicGroupClientName').value = 'Программная подмена';
      document.querySelector('#publicGroupClientPhone').value = '+79991111111';
      document.querySelector('#publicGroupClientComment').value = 'Другая заметка';
      testState.mode = 'success';
    });
    await publicSubmit(page).click();
    await page.locator('#publicGroupBookingSuccess').waitFor({ state:'visible' });
    const attempts = await page.evaluate(() => testState.calls.filter(call => call.name === 'book_minuta_group_event'));
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1].args, attempts[0].args);
    assert.equal(await name.inputValue(), 'Ирина', 'the UI must match the retried snapshot');
  });

  await runCase('definite public rejection releases native inputs for correction', 'public', async page => {
    await publicForm(page);
    await page.evaluate(() => { testState.mode = 'reject'; });
    await publicSubmit(page).click();
    await page.locator('#publicGroupBookingError').waitFor({ state:'visible' });
    assert.equal(await page.locator('#publicGroupClientName').isEditable(), true);
    assert.equal(await page.locator('#publicGroupClientPhone').isEditable(), true);
    assert.equal(await page.locator('#publicGroupClientComment').isEditable(), true);
    await page.locator('#publicGroupClientName').fill('Анна');
    await page.locator('#publicGroupClientPhone').fill('+79992222222');
    await page.locator('#publicGroupClientComment').fill('Исправлено');
    await page.evaluate(() => { testState.mode = 'success'; });
    await publicSubmit(page).click();
    await page.locator('#publicGroupBookingSuccess').waitFor({ state:'visible' });
    const attempt = await page.evaluate(() => testState.calls.filter(call => call.name === 'book_minuta_group_event').at(-1));
    assert.equal(attempt.args.p_client_name, 'Анна');
    assert.equal(attempt.args.p_client_phone, '+79992222222');
    assert.equal(attempt.args.p_comment, 'Исправлено');
  });

  await runCase('ambiguous provider creation blocks duplicates and existing editing recovers', 'provider', async page => {
    await page.locator('#newGroupEvent').click();
    await page.locator('#groupEventTitle').fill('Новое занятие');
    await page.evaluate(() => { testState.mode = 'throw'; });
    await providerSubmit(page).click();
    await page.locator('#groupEventError').waitFor({ state:'visible' });
    assert.equal(await providerSubmit(page).isDisabled(), true);
    assert.equal(await page.locator('#groupEventTitle').inputValue(), 'Новое занятие');
    await page.evaluate(() => document.querySelector('#groupEventForm').requestSubmit());
    assert.equal(await page.evaluate(() => testState.calls.filter(call => call.name === 'upsert_minuta_group_event').length), 1);
    await page.locator('#closeGroupEventDialog').click();
    await page.locator('[data-edit-group-event="event-a"]').click();
    assert.equal(await providerSubmit(page).isDisabled(), false, 'native form.reset alone cannot restore a disabled submit');
    assert.equal(await page.locator('#groupEventId').inputValue(), 'event-a');
    await page.locator('#groupEventTitle').fill('Изменённое занятие');
    await page.evaluate(() => { testState.mode = 'success'; });
    await providerSubmit(page).click();
    await page.locator('#groupEventDialog').waitFor({ state:'hidden' });
    const writes = await page.evaluate(() => testState.calls.filter(call => call.name === 'upsert_minuta_group_event'));
    assert.equal(writes.length, 2);
    assert.equal(writes[1].args.p_event, 'event-a');
  });

  await runCase('late provider success cannot close a new native dialog after Escape', 'provider', async page => {
    await page.locator('[data-edit-group-event="event-a"]').click();
    await page.evaluate(() => { testState.mode = 'hold'; });
    await providerSubmit(page).click();
    await page.waitForFunction(() => typeof testState.release === 'function');
    await page.keyboard.press('Escape');
    await page.locator('#groupEventDialog').waitFor({ state:'hidden' });
    await page.locator('#newGroupEvent').click();
    await page.locator('#groupEventTitle').fill('Другая форма');
    assert.equal(await providerSubmit(page).isDisabled(), false);
    await page.evaluate(async () => {
      testState.mode = 'success';
      testState.release();
      // Drain async RPC/controller continuations, then give dialog events a browser task boundary.
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    assert.equal(await page.locator('#groupEventDialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#groupEventTitle').inputValue(), 'Другая форма');
    assert.equal(await page.locator('#groupEventError').evaluate(element => element.hidden), true);
    assert.equal(await page.evaluate(() => testState.notices.length), 0);
  });
  assert.deepEqual(pageErrors, [], 'native browser must not emit uncaught controller errors');
  console.log('Group booking native browser recovery: 4/4 passed');
} finally {
  await browser.close();
}
