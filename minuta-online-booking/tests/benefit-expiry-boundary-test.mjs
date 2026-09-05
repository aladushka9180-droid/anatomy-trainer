import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../benefit-management.js', import.meta.url), 'utf8');

// Exercise the real controller renderer with a fixed clock. The SQL RPC still
// uses current_date; these tests verify the existing client business timezone,
// not the timezone of a deployed database connection.
async function renderInstrument(instant, status = 'active') {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new Date(instant).getTime(); }
  }
  const elements = new Map();
  const select = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      value: '', innerHTML: '', textContent: '', hidden: false, disabled: false,
      checked: false, dataset: {}, querySelectorAll: () => [], closest: () => null,
    });
    return elements.get(selector);
  };
  const context = { Date: FixedDate, Intl, window: {}, document: { addEventListener() {} } };
  runInNewContext(source, context, { filename: 'benefit-management.js' });
  const payload = {
    organization_id: 'org', current_role: 'owner', enabled: true,
    services: [], clients: [], bookings: [], products: [], redemptions: [], audit: [],
    instruments: [{
      id: 'boundary-certificate', status, expires_on: '2026-09-05',
      client_account_id: 'client', product_snapshot: { kind: 'certificate', name: 'Сертификат' },
      remaining_amount_rub: 1000, public_code: 'MIN-BOUNDARY',
    }],
  };
  const controller = context.window.MinutaBenefits.createController({
    $: select, db: { rpc: async () => ({ data: payload, error: null }) },
    escapeHtml: value => String(value ?? ''), notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id: 'owner' }), getSessionGeneration: () => 1,
    sessionIsCurrent: () => true, applyWriteAvailability() {},
  });
  assert.equal((await controller.setOrganization({ id: 'org', current_role: 'owner' })).ok, true);
  return {
    card: select('#benefitInstrumentsList').innerHTML,
    options: select('#benefitApplyInstrument').innerHTML,
    minimumExpiry: select('#benefitIssueExpiry').min,
  };
}

const boundaries = [
  ['before the final day', '2026-09-04T19:59:59.999Z', '2026-09-04', false],
  ['start of the final day', '2026-09-04T20:00:00.000Z', '2026-09-05', false],
  ['last millisecond of the final day', '2026-09-05T19:59:59.999Z', '2026-09-05', false],
  ['Samara midnight before UTC midnight', '2026-09-05T20:00:00.000Z', '2026-09-06', true],
  ['after UTC midnight', '2026-09-06T00:00:00.000Z', '2026-09-06', true],
];

for (const [label, instant, businessDay, expired] of boundaries) {
  test(`active certificate: ${label}`, async () => {
    const rendered = await renderInstrument(instant);
    assert.equal(rendered.minimumExpiry, businessDay);
    assert.match(rendered.card, expired ? />Истёк</ : />Активен</);
    assert.equal(rendered.card.includes('data-benefit-status="frozen"'), !expired);
    assert.equal(rendered.options.includes('value="boundary-certificate"'), !expired);
  });
}

for (const instant of ['2026-09-05T19:59:59.999Z', '2026-09-05T20:00:00.000Z']) {
  test(`frozen certificate retains its explicit status at ${instant}`, async () => {
    const rendered = await renderInstrument(instant, 'frozen');
    assert.match(rendered.card, />Заморожен</);
    assert.match(rendered.card, /data-benefit-status="active"/);
    assert.doesNotMatch(rendered.options, /value="boundary-certificate"/);
  });
}
