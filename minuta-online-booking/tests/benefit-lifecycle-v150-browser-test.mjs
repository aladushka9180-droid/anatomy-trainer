import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-benefit-lifecycle-v150');
mkdirSync(output, { recursive:true });
const source = readFileSync(resolve(root, 'benefit-lifecycle.js'), 'utf8');
const styles = readFileSync(resolve(root, 'styles.css'), 'utf8');
const lifecycleStyles = readFileSync(resolve(root, 'benefit-lifecycle.css'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.setContent(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${styles}</style><style>${lifecycleStyles}</style><style>
      *{box-sizing:border-box}body{margin:0;background:#f4f5f4;color:#183427;font-family:Inter,Arial,sans-serif}.fixture{width:min(920px,100%);margin:0 auto;padding:20px}.resource-subhead{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px}.resource-subhead small,.resource-subhead strong{display:block}.secondary-button{min-height:40px;border:1px solid #cad8cf;border-radius:11px;background:#fff;color:#214d38;font:inherit;font-weight:750}
    </style></head><body class="provider-body"><main class="fixture"><section class="client-benefit-lifecycle" id="clientBenefitLifecycle" hidden><div class="resource-subhead"><div><small>Срок, остаток и все действия</small><strong id="clientBenefitLifecycleTitle">Абонементы и сертификаты</strong></div></div><div id="clientBenefitLifecycleList"></div></section></main></body></html>`);
    await page.addScriptTag({ content:source });
    await page.evaluate(async () => {
      const organizationId = '11111111-1111-4111-8111-111111111150';
      const clientId = '22222222-2222-4222-8222-222222222150';
      const instrumentId = '33333333-3333-4333-8333-333333333150';
      window.lifecycleCalls = [];
      window.lifecycleNotices = [];
      window.lifecycleStorage = new Map();
      window.failFirstFreeze = true;
      window.lifecyclePayload = {
        organization_id:organizationId,client_account_id:clientId,current_role:'owner',instruments:[
          { id:instrumentId,name:'Пакет восстановления',kind:'package',public_code:'MIN-PACKAGE-150',status:'active',expires_on:'2026-12-31',remaining_visits:4,allowed_actions:['freeze'],freeze_count:1,total_frozen_days:2,current_freeze:null,history:[
            { id:3,event_type:'released',created_at:'2026-09-11T10:30:00+04:00',visits_delta:1,visits_balance:4,actor_name:'Анна',details:{} },
            { id:2,event_type:'activated',created_at:'2026-09-10T09:15:00+04:00',visits_balance:3,actor_name:'Анна',details:{extended_days:2} },
            { id:1,event_type:'issued',created_at:'2026-09-01T12:00:00+04:00',visits_balance:5,actor_name:'Анна',details:{} }
          ]},
          { id:'44444444-4444-4444-8444-444444444150',name:'Сертификат 5 000 ₽',kind:'certificate',public_code:'MIN-CERT-150',status:'frozen',expires_on:'2026-11-15',remaining_amount_rub:3200,allowed_actions:['unfreeze'],freeze_count:1,total_frozen_days:0,current_freeze:{frozen_at:'2026-09-12T08:00:00+04:00'},history:[
            { id:5,event_type:'frozen',created_at:'2026-09-12T08:00:00+04:00',amount_balance_rub:3200,actor_name:'Анна',details:{reason:'Отпуск'} },
            { id:4,event_type:'issued',created_at:'2026-09-05T12:00:00+04:00',amount_balance_rub:5000,actor_name:'Анна',details:{} }
          ]},
          { id:'55555555-5555-4555-8555-555555555150',name:'Абонемент 8 визитов',kind:'visit_pass',public_code:'MIN-PASS-150',status:'expired',expires_on:'2026-08-30',remaining_visits:2,allowed_actions:[],freeze_count:0,total_frozen_days:0,current_freeze:null,history:[
            { id:7,event_type:'expired',created_at:'2026-08-31T00:01:00+04:00',visits_balance:2,actor_name:null,details:{expires_on:'2026-08-30'} },
            { id:6,event_type:'issued',created_at:'2026-06-01T12:00:00+04:00',visits_balance:8,actor_name:'Анна',details:{} }
          ]}
        ]
      };
      const db = { rpc:async (name,args) => {
        lifecycleCalls.push({ name,args:structuredClone(args) });
        if (name === 'get_minuta_benefit_lifecycle_v150') return { data:structuredClone(lifecyclePayload), error:null };
        if (name === 'set_minuta_benefit_lifecycle_v150') {
          if (args.p_action === 'freeze' && failFirstFreeze) { failFirstFreeze=false; return { data:null,error:{ message:'network timeout' } }; }
          const item = lifecyclePayload.instruments.find(row => row.id === args.p_instrument);
          item.status = args.p_action === 'freeze' ? 'frozen' : 'active';
          item.allowed_actions = [args.p_action === 'freeze' ? 'unfreeze' : 'freeze'];
          item.current_freeze = args.p_action === 'freeze' ? { frozen_at:'2026-09-12T12:00:00+04:00' } : null;
          item.history.unshift({ id:99,event_type:args.p_action === 'freeze' ? 'frozen' : 'activated',created_at:'2026-09-12T12:00:00+04:00',visits_balance:item.remaining_visits,actor_name:'Анна',details:args.p_action === 'unfreeze' ? { extended_days:1 } : {} });
          return { data:{ id:item.id,organization_id:organizationId,status:item.status,extended_days:args.p_action === 'unfreeze' ? 1 : 0 },error:null };
        }
        return { data:null,error:{ message:`unexpected rpc ${name}` } };
      }};
      window.lifecycleController = MinutaBenefitLifecycle.createClientController({
        db,$:selector => document.querySelector(selector),escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]),
        notify:value => lifecycleNotices.push(value),requireWrites:() => true,getCurrentUser:() => ({ id:'owner-150' }),
        storage:{ getItem:key => lifecycleStorage.get(key) || null,setItem:(key,value) => lifecycleStorage.set(key,value),removeItem:key => lifecycleStorage.delete(key) },
        getSessionGeneration:() => 1,sessionIsCurrent:() => true,createRequestId:() => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      });
      lifecycleController.bind();
      await lifecycleController.setClient({ clientAccountId:clientId }, { id:organizationId,current_role:'owner' });
    });

    assert.equal(await page.locator('.client-benefit-card').count(), 3);
    assert.equal(await page.locator('.client-benefit-status.is-active').innerText(), 'Активен');
    assert.match(await page.locator('.client-benefit-status.is-frozen').innerText(), /Заморожен/);
    assert.equal(await page.locator('.client-benefit-status.is-expired').innerText(), 'Истёк');
    await page.locator('.client-benefit-card').first().locator('summary').click();
    assert.equal(await page.locator('.client-benefit-card').first().locator('.client-benefit-history li').count(), 3);
    const layout = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      cardWidths:[...document.querySelectorAll('.client-benefit-card')].map(item => item.getBoundingClientRect().width),
      buttonHeights:[...document.querySelectorAll('.client-benefit-actions button')].map(item => item.getBoundingClientRect().height)
    }));
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    assert.ok(layout.cardWidths.every(value => value > 0 && value <= width), `${width}: cards fit viewport`);
    if (width <= 760) assert.ok(layout.buttonHeights.every(value => value >= 40), `${width}: lifecycle buttons remain touchable`);

    if (width === 390) {
      await page.locator('[data-client-benefit-action="freeze"]').first().click();
      await page.waitForFunction(() => lifecycleCalls.filter(call => call.name === 'set_minuta_benefit_lifecycle_v150').length === 1, null, { timeout:3000 });
      await page.waitForFunction(() => lifecycleCalls.filter(call => call.name === 'get_minuta_benefit_lifecycle_v150').length >= 2, null, { timeout:3000 });
      await page.locator('[data-client-benefit-action="freeze"]').first().click();
      await page.waitForFunction(() => lifecyclePayload.instruments[0].status === 'frozen', null, { timeout:3000 });
      await page.waitForFunction(() => document.querySelectorAll('.client-benefit-status.is-frozen').length === 2, null, { timeout:3000 });
      const requests = await page.evaluate(() => lifecycleCalls.filter(call => call.name === 'set_minuta_benefit_lifecycle_v150' && call.args.p_instrument.endsWith('3150')).map(call => call.args.p_request_id));
      assert.equal(requests.length, 2);
      assert.equal(requests[0], requests[1], 'uncertain retry must reuse lifecycle request id');
    }

    await page.screenshot({ path:resolve(output, `${width}.png`), fullPage:true });
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
console.log('PASS: benefit lifecycle client card at 390, 760 and 1440');
