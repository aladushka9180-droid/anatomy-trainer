import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8');
const source = readFileSync(resolve(root, 'shift-management.js'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase-migration-v190.sql'), 'utf8');
assert.match(migration, /'is_schedule_block',\(coalesce\(booking\.booking_policy_snapshot @> '\{"schedule_block":true\}'::jsonb,false\) or exists\(select 1 from public\.integration_calendar_events_v142 mapping where mapping\.local_booking_id=booking\.id and mapping\.organization_id=p_organization\)\)/);
assert.match(migration, /booking\.status<>'cancelled' and not \(coalesce\(booking\.booking_policy_snapshot @> '\{"schedule_block":true\}'::jsonb,false\) or exists\(select 1 from public\.integration_calendar_events_v142 mapping where mapping\.local_booking_id=booking\.id and mapping\.organization_id=p_organization\)\)/);
assert.match(migration, /message='schedule_block_substitution_denied'/);

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    const errors = [], unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://a04-synthetic.test/')
        return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' });
      if (route.request().url() === 'https://a04-synthetic.test/ui-icons.svg')
        return route.fulfill({ contentType:'image/svg+xml', body:readFileSync(resolve(root, 'ui-icons.svg')) });
      unexpected.push(route.request().url());
      return route.abort();
    });
    await page.goto('https://a04-synthetic.test/');
    await page.evaluate(markup => {
      const panel = new DOMParser().parseFromString(markup, 'text/html').getElementById('shiftsPanel');
      document.body.append(document.importNode(panel, true));
    }, html);
    await page.addScriptTag({ content:source });
    await page.evaluate(() => {
      const booking = (id, name, is_schedule_block) => ({ id, booking_code:`SYN-${id}`,
        performer_id:'specialist-a', booking_date:'2026-10-01', booking_time:'10:00:00',
        duration_minutes:60, primary_duration_minutes:60, has_addons:false,
        service_name:name, status:'new', ...(is_schedule_block === undefined ? {} : { is_schedule_block }) });
      window.bookingsFixture = [
        booking('client', 'Синтетическая услуга', false),
        booking('v123', 'Синтетическая услуга', true),
        booking('v141', '__MINUTA_SCHEDULE_BLOCK__', true),
        booking('v142', '__PRIMETIME_EXTERNAL_CALENDAR__', true)
      ];
      window.calls = [];
      window.controller = MinutaShifts.createController({
        db:{ rpc:async name => {
          calls.push(name);
          if (name !== 'get_minuta_shift_workspace') throw new Error(`Unexpected RPC ${name}`);
          return { data:{ organization_id:'synthetic-org', current_role:'owner', can_manage_team:true,
            enabled:false, locations:[{ id:'location', name:'Тестовый филиал', active:true }],
            performers:[{ id:'specialist-a', display_name:'А' }, { id:'specialist-b', display_name:'Б' }],
            services:[{ id:'alternative', performer_id:'specialist-b', name:'Услуга Б', duration_minutes:60 }],
            shifts:[], absences:[], bookings:bookingsFixture, utilization:[], audit:[] }, error:null };
        } },
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:message => { throw new Error(`Unexpected notification ${message}`); },
        requireWrites:() => false, applyWriteAvailability:() => {},
        getCurrentUser:() => ({ id:'synthetic-user' }), getSessionGeneration:() => 1,
        sessionIsCurrent:() => true
      });
    });
    assert.equal((await page.evaluate(() => controller.setOrganization({ id:'synthetic-org' }))).ok, true);
    assert.deepEqual(await page.locator('#substitutionBooking option').evaluateAll(options => options.map(option => option.value)), ['client']);
    assert.equal(await page.locator('#shiftSubstitutionPanel button[type="submit"]').isEnabled(), true);
    await page.evaluate(async () => {
      bookingsFixture = [{ id:'legacy', booking_date:'2026-10-01', booking_time:'10:00:00', service_name:'Старая запись', status:'new', has_addons:false }];
      await controller.load();
    });
    assert.deepEqual(await page.locator('#substitutionBooking option').evaluateAll(options => options.map(option => option.value)), ['']);
    assert.match(await page.locator('#substitutionHint').textContent(), /сервер пока не различает записи и блоки времени/);
    assert.equal(await page.locator('#shiftSubstitutionPanel button[type="submit"]').isDisabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    assert.deepEqual(await page.evaluate(() => calls), ['get_minuta_shift_workspace', 'get_minuta_shift_workspace']);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
    await page.close();
  }
} finally { await browser.close(); }
console.log('A04 substitution contract browser checks passed at 390, 760 and 1440');
