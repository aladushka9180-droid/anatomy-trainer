import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../payment-management.js', import.meta.url), 'utf8');

// Actual controller, mocked DOM/transport only. No database or payment calls.
async function harness({ captured = 1000, refunded = 0, pendingRefunds = [], reconciliations = [],
  attemptStatus = 'succeeded', confirmed = true, storage = new Map(), checkRow = null, checkError = null, possibleAlias = null,
  response = null } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const notifications = [];
  const invocations = [];
  const rpcCalls = [];
  let uuidCount = 0;
  let resets = 0;
  const select = (selector) => {
    if (!elements.has(selector)) {
      let markup = '';
      const element = {
        id: selector.slice(1), value: '', checked: false, disabled: false,
        hidden: false, textContent: '', max: '', dataset: {},
        querySelectorAll: () => [...elements.values()], addEventListener() {},
        reset() { resets += 1; select('#paymentRefundAmount').value = ''; },
        get innerHTML() { return markup; },
        set innerHTML(value) {
          markup = value;
          if (selector === '#paymentRefundAttempt') {
            this.value = /<option value="([^"]+)"/.exec(value)?.[1] || '';
          }
        },
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  const payload = {
    organization_id:'org-1', current_role: 'owner', settings: { enabled: true, environment: 'test' },
    recent_attempts: [{ id: 'attempt-1', status: attemptStatus, amount_minor: captured,
      captured_amount_minor: captured, refunded_amount_minor: refunded, created_at: '2026-09-05T00:00:00Z' }],
    recent_refunds:pendingRefunds,
    recent_reconciliations:reconciliations,
  };
  const context = {
    TextEncoder,
    window: { crypto: { randomUUID: () => `request-${++uuidCount}`, subtle:webcrypto.subtle }, confirm:() => confirmed,
      localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)} },
    document: { addEventListener: (name, callback) => listeners.set(name, callback) },
  };
  runInNewContext(source, context, { filename: 'payment-management.js' });
  const controller = context.window.MinutaPayments.createController({
    $: select, escapeHtml: (value) => String(value ?? ''), notify: (message) => notifications.push(message),
    requireWrites: () => true,
    db: {
      from: name => { assert.equal(name,'payment_provider_refunds'); const filters=[]; let alias=false; const query={select:()=>query,eq:(key,value)=>{filters.push([key,value]);return query;},in:()=>{alias=true;return query;},limit:()=>query,maybeSingle:async()=>{rpcCalls.push(['exact-refund',filters]);return {data:alias?possibleAlias:typeof checkRow==='function'?checkRow():checkRow,error:checkError};}};return query; },
      rpc: async (...args) => { rpcCalls.push(args); return { data: payload }; },
      functions: { invoke: async (...args) => {
        assert.equal(JSON.parse(storage.get('minuta_refund_intent_v1:org-1')).request_id,args[1].body.request_id,'Identity must be durable before dispatch');
        invocations.push(args); return response?.data?.ok
        ? { ...response, data:{refund_id:'refund-ack',amount_minor:args[1].body.amount_minor,...response.data} }
        : response || {data:{ok:true,status:'succeeded',refund_id:'refund-ack',amount_minor:args[1].body.amount_minor}}; } },
    },
  });
  controller.bind();
  await controller.setOrganization({ id: 'org-1', current_role: 'owner' });
  const initialRpcCount = rpcCalls.length;
  return {
    select, controller, payload, notifications, invocations, rpcCalls, storage,
    newRefund:()=>listeners.get('click')({target:{closest:()=>true}}),
    get uuidCount() { return uuidCount; }, get resets() { return resets; },
    get extraRpcCount() { return rpcCalls.length - initialRpcCount; },
    async submit(value, reason = 'Возврат части оплаты') {
      select('#paymentRefundAmount').value = value;
      select('#paymentRefundReason').value = reason;
      let prevented = false;
      await listeners.get('submit')({ target: select('#paymentRefundForm'), preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
    },
    changeAttempt() { listeners.get('change')({ target: select('#paymentRefundAttempt') }); },
  };
}

async function refused(value, expectedMessage, options, reason) {
  const ui = await harness(options);
  await ui.submit(value, reason);
  assert.equal(ui.invocations.length, 0, 'must not call payment Edge function');
  assert.equal(ui.extraRpcCount, 0, 'must not issue another RPC on invalid input');
  assert.equal(ui.uuidCount, 0, 'must not allocate a request key');
  assert.equal(ui.resets, 0);
  assert.equal(ui.select('#paymentRefundAmount').value, value, 'must not replace the amount');
  assert.equal(ui.select('#paymentRefundAmount').disabled, false);
  assert.match(ui.notifications.at(-1), expectedMessage);
  return ui;
}

test('lost successful partial refund reconciles exact durable request and cannot issue another refund', async () => {
  let row=null;
  const ui=await harness({captured:10000,response:{error:{message:'response lost'}},checkRow:()=>row});
  await ui.submit('10.00');
  const original=ui.invocations[0][1].body;
  assert.equal(JSON.parse([...ui.storage.values()][0]).request_id,original.request_id);
  assert.ok(![...ui.storage.values()][0].includes('Возврат части оплаты'), 'reason is never stored in plain text');
  row={...original,id:'refund-1',status:'succeeded'};
  ui.payload.recent_attempts[0].refunded_amount_minor=1000;
  await ui.controller.load();
  await ui.submit('10.00');
  assert.equal(ui.invocations.length,1);
  assert.match(ui.notifications.at(-1),/Возврат выполнен/);
  const exact=ui.rpcCalls.find(call=>call[0]==='exact-refund');
  assert.deepEqual(exact[1],[['organization_id','org-1'],['request_id',original.request_id]]);
  await ui.submit('25.00','Другая причина возврата');
  assert.equal(ui.invocations.length,1,'editing fields is not authorization for another refund');
  ui.newRefund();
  await ui.submit('10.00');
  assert.equal(ui.invocations.length,2);
  assert.notEqual(ui.invocations[1][1].body.request_id,original.request_id);
});

test('reload restores unknown refund and retries same ID only after exact empty journal lookup', async () => {
  const storage=new Map();
  const first=await harness({storage,response:{error:{message:'unknown'}}});
  await first.submit('1.00');
  const original=first.invocations[0][1].body;
  const reopened=await harness({storage,response:{error:{message:'still unknown'}}});
  assert.equal(reopened.select('#paymentRefundAmount').value,'1.00');
  await reopened.submit('1.00','Different reason must not dispatch');
  assert.equal(reopened.invocations.length,0);
  assert.match(reopened.notifications.at(-1),/прежнюю причину/);
  await reopened.submit('1.00');
  assert.equal(reopened.invocations.length,1);
  assert.equal(reopened.invocations[0][1].body.request_id,original.request_id);
  assert.equal(reopened.uuidCount,0);
  reopened.newRefund();
  assert.equal(storage.size,1,'unknown intent cannot be discarded as a new operation');
});

test('reload reconciles original success even if it is absent from recent workspace', async () => {
  const storage=new Map();
  const first=await harness({storage,response:{error:{message:'unknown'}}});
  await first.submit('1.00');
  const original=first.invocations[0][1].body;
  const reopened=await harness({storage,checkRow:{...original,id:'refund-1',status:'succeeded'}});
  await reopened.submit('1.00');
  assert.equal(reopened.invocations.length,0);
  assert.match(reopened.notifications.at(-1),/выполнен/);
});

test('failed journal lookup and mismatched exact row cannot dispatch a refund', async () => {
  const first=await harness({response:{error:{message:'unknown'}}});await first.submit('1.00');
  for(const options of [{checkError:{message:'offline'}},{checkRow:{...first.invocations[0][1].body,id:'wrong',organization_id:'foreign',status:'succeeded'}}]){
    const reopened=await harness({storage:first.storage,...options});await reopened.submit('1.00');
    assert.equal(reopened.invocations.length,0);assert.match(reopened.notifications.at(-1),/Не удалось сверить/);
  }
});

test('storage quota failure prevents the first financial request', async () => {
  const storage=new Map();storage.set=()=>{throw Error('QuotaExceededError');};
  const ui=await harness({storage});await ui.submit('1.00');
  assert.equal(ui.invocations.length,0);assert.match(ui.notifications.at(-1),/Операция не отправлена/);
});

test('lost canonical-alias reply cannot create another partial refund when our request ID is absent', async () => {
 const first=await harness({response:{error:{message:'unknown'}}});await first.submit('1.00');
 const reopened=await harness({storage:first.storage,possibleAlias:{id:'other-canonical-refund'}});
 await reopened.submit('1.00');
 assert.equal(reopened.invocations.length,0);assert.match(reopened.notifications.at(-1),/Не удалось сверить/);
});

test('acknowledged refund needs explicit new action before a second ordinary refund', async () => {
  const ui=await harness();await ui.submit('1.00');
  ui.newRefund();await ui.submit('2.00');
  assert.equal(ui.invocations.length,2);
  assert.notEqual(ui.invocations[0][1].body.request_id,ui.invocations[1][1].body.request_id);
});

test('malformed acknowledgement remains unresolved and cannot authorize New refund', async () => {
 const ui=await harness({response:{data:{ok:true,status:'succeeded',refund_id:''}}});
 await ui.submit('1.00');ui.newRefund();
 assert.equal(ui.storage.size,1);assert.match(ui.notifications.at(-1),/не подтверждён/);
});

test('canceled provider result is not announced as processing or completed', async () => {
 const ui=await harness({response:{data:{ok:true,status:'canceled'}}});await ui.submit('1.00');
 assert.equal(ui.notifications.at(-1),'Возврат отменён');
});

for (const value of ['', ' ', '.', '1.', '1.001', '1,001', '1e2', '0x64', '-1', '+1', 'NaN', 'Infinity', '1 000.00', '1.2.3', '90071992547409.92', '9'.repeat(400)]) {
  test(`rejects non-exact/unsafe RUB input ${JSON.stringify(value.slice(0, 30))}`, async () => {
    await refused(value, /точную сумму.*двух знаков.*без округления/);
  });
}

for (const value of ['0', '0.01', '0.99']) {
  test(`rejects provider refund below 1 RUB: ${value}`, async () => {
    await refused(value, /Минимальная сумма.*1 ₽/);
  });
}

for (const value of ['9.01', '9.50', '9.99']) {
  test(`explains forbidden remainder without changing ${value} out of 10 RUB`, async () => {
    await refused(value, /остаться 0 ₽.*1 ₽.*не больше 9,00 ₽.*10,00 ₽.*не изменена/);
  });
}

test('after refunds of 3 and 5.50 RUB, only the full remaining 1.50 is offered', async () => {
  const ui = await refused('1.00', /Можно вернуть весь остаток — 1,50 ₽/, { refunded: 850 });
  assert.doesNotMatch(ui.notifications.at(-1), /не больше 0,50/);
});

test('pending refunds reserve balance and recent refunds/reconciliations are visible', async () => {
  const ui = await harness({ pendingRefunds:[{ attempt_id:'attempt-1', amount_minor:400, status:'pending', reason:'Ожидает провайдера', created_at:'2026-09-06T00:00:00Z' }],
    reconciliations:[{ outcome:'matched', object_kind:'refund', amount_minor:400, checked_at:'2026-09-06T00:01:00Z' }] });
  assert.match(ui.select('#paymentRefundAttempt').innerHTML, /data-remaining="600"/);
  assert.match(ui.select('#paymentAttemptsList').innerHTML, /Возврат.*сумма зарезервирована/s);
  assert.match(ui.select('#paymentAttemptsList').innerHTML, /Сверка.*сверено/s);
  await ui.submit('6.01');
  assert.equal(ui.invocations.length, 0);
  assert.match(ui.notifications.at(-1), /превышает доступные 6,00 ₽/);
});

test('refund requires a separate explicit confirmation', async () => {
  const ui = await harness({ confirmed:false });
  await ui.submit('1.00');
  assert.equal(ui.invocations.length, 0);
  assert.equal(ui.uuidCount, 0);
  assert.equal(ui.notifications.at(-1), 'Возврат не отправлен');
});

test('only succeeded attempts are offered for a refund', async () => {
  const ui = await harness({ attemptStatus:'pending' });
  assert.equal(ui.select('#paymentRefundAttempt').innerHTML, '');
  await ui.submit('1.00');
  assert.equal(ui.invocations.length, 0);
  assert.match(ui.notifications.at(-1), /Выберите платёж/);
});

test('amount above the locally known cap is refused', async () => {
  await refused('10.01', /превышает доступные 10,00 ₽/);
});

test('short reason is refused without a request', async () => {
  await refused('1.00', /причину.*8 символов/, undefined, 'коротко');
});

for (const [value, expected, options] of [
  ['1', 100], ['1.1', 110], ['1,10', 110], ['0001.01', 101], [' 1.01 ', 101],
  ['1.15', 115], ['9.00', 900], ['10.00', 1000],
  ['1.50', 150, { refunded: 850 }], ['1.00', 100, { captured: 100 }],
  ['90071992547409.91', Number.MAX_SAFE_INTEGER, { captured: String(Number.MAX_SAFE_INTEGER) }],
]) {
  test(`sends exact integer cents for ${value}`, async () => {
    const ui = await harness(options);
    await ui.submit(value);
    assert.equal(ui.invocations.length, 1);
    assert.equal(ui.invocations[0][0], 'yookassa-refund');
    const body = ui.invocations[0][1].body;
    assert.equal(body.amount_minor, expected);
    assert.equal(Number.isSafeInteger(body.amount_minor), true);
    assert.equal(body.attempt_id, 'attempt-1');
    assert.equal(body.organization_id, 'org-1');
    assert.equal(body.request_id, 'request-1');
    assert.match(ui.notifications.at(-1), /Возврат выполнен/);
  });
}

for (const options of [
  { captured: '9007199254740992' }, { captured: null }, { captured: '1000.5' },
  { refunded: -1 }, { refunded: 1001 },
]) {
  test(`does not guess an unsafe server balance ${JSON.stringify(options)}`, async () => {
    await refused('1.00', /Не удалось проверить доступную сумму|Выберите платёж/, options);
  });
}

test('selection absent from workspace is refused, regardless of DOM state', async () => {
  const ui = await harness();
  ui.select('#paymentRefundAttempt').value = 'unknown-attempt';
  await ui.submit('1.00');
  assert.equal(ui.invocations.length, 0);
  assert.match(ui.notifications.at(-1), /Не удалось проверить доступную сумму/);
});

test('a change/reload does not clamp a nonempty amount or send it', async () => {
  const ui = await harness();
  ui.select('#paymentRefundAmount').value = '9.50';
  ui.payload.recent_attempts[0].refunded_amount_minor = 500;
  ui.changeAttempt();
  assert.equal(ui.select('#paymentRefundAmount').max, '5.00');
  assert.equal(ui.select('#paymentRefundAmount').value, '9.50');
  await ui.controller.load();
  assert.equal(ui.select('#paymentRefundAmount').value, '9.50');
  assert.equal(ui.invocations.length, 0);
});

test('definite prevalidation failure permits corrected input, no automatic second request', async () => {
  const ui = await refused('9.50', /остаться 0 ₽/);
  await ui.submit('9.00');
  assert.equal(ui.invocations.length, 1);
  assert.equal(ui.invocations[0][1].body.amount_minor, 900);
});

test('unknown Edge result remains unconfirmed and does not auto-retry or rewrite amount', async () => {
  const ui = await harness({ response: { error: { message: 'network response unknown' } } });
  await ui.submit('9.00');
  assert.equal(ui.invocations.length, 1);
  assert.equal(ui.uuidCount, 1);
  assert.equal(ui.resets, 0);
  assert.equal(ui.select('#paymentRefundAmount').value, '9.00');
  assert.equal(ui.select('#paymentRefundAmount').disabled, false);
  assert.match(ui.notifications.at(-1), /не подтверждён/);
});

test('pending provider refund stays in processing, not succeeded', async () => {
  const ui = await harness({ response: { data: { ok: true, status: 'pending' } } });
  await ui.submit('1.00');
  assert.equal(ui.invocations.length, 1);
  assert.match(ui.notifications.at(-1), /принят в обработку/);
  assert.doesNotMatch(ui.notifications.at(-1), /выполнен/);
});

async function selectSecondAttempt() {
  const ui = await harness();
  ui.payload.recent_attempts.push({ ...ui.payload.recent_attempts[0], id: 'attempt-2', amount_minor: 2000, captured_amount_minor: 2000 });
  await ui.controller.load();
  ui.select('#paymentRefundAttempt').value = 'attempt-2';
  ui.select('#paymentRefundAmount').value = '9.00';
  ui.select('#paymentRefundReason').value = 'Возврат для второго платежа';
  ui.changeAttempt();
  return ui;
}

test('workspace reload preserves chosen payment B, amount and reason instead of defaulting to A', async () => {
  const ui = await selectSecondAttempt();
  for (let reload = 0; reload < 2; reload += 1) {
    await ui.controller.load();
    assert.equal(ui.select('#paymentRefundAttempt').value, 'attempt-2');
    assert.equal(ui.select('#paymentRefundAmount').max, '20.00');
    assert.equal(ui.select('#paymentRefundAmount').value, '9.00');
    assert.equal(ui.select('#paymentRefundReason').value, 'Возврат для второго платежа');
    assert.equal(ui.invocations.length, 0);
  }
  await ui.submit('9.00', 'Возврат для второго платежа');
  assert.equal(ui.invocations.length, 1);
  assert.equal(ui.invocations[0][1].body.attempt_id, 'attempt-2');
});

for (const transition of ['removed', 'fully refunded']) {
  test(`payment B ${transition}: unset stays unset over reloads until explicit choice`, async () => {
    const ui = await selectSecondAttempt();
    if (transition === 'removed') ui.payload.recent_attempts.pop();
    else ui.payload.recent_attempts[1].refunded_amount_minor = 2000;
    for (let reload = 0; reload < 2; reload += 1) {
      await ui.controller.load();
      assert.equal(ui.select('#paymentRefundAttempt').value, '');
      assert.equal(ui.select('#paymentRefundAmount').value, '9.00');
      assert.equal(ui.select('#paymentRefundReason').value, 'Возврат для второго платежа');
      assert.equal(ui.select('#paymentRefundAmount').max, '');
      assert.equal(ui.invocations.length, 0);
      assert.equal(ui.resets, 0);
    }
    assert.match(ui.notifications.at(-1), /Выбранный платёж.*Выберите платёж заново/);
    const rpcCount = ui.rpcCalls.length;
    await ui.submit('9.00', 'Возврат для второго платежа');
    assert.equal(ui.invocations.length, 0);
    assert.equal(ui.rpcCalls.length, rpcCount);
    assert.equal(ui.uuidCount, 0);
    assert.match(ui.notifications.at(-1), /Выберите платёж для возврата/);
    ui.select('#paymentRefundAttempt').value = 'attempt-1';
    ui.changeAttempt();
    assert.equal(ui.select('#paymentRefundAmount').value, '9.00');
    assert.equal(ui.select('#paymentRefundReason').value, 'Возврат для второго платежа');
    await ui.controller.load();
    assert.equal(ui.select('#paymentRefundAttempt').value, 'attempt-1');
    await ui.submit('9.00', 'Подтверждён возврат первого платежа');
    assert.equal(ui.invocations.length, 1);
    assert.equal(ui.invocations[0][1].body.attempt_id, 'attempt-1');
    assert.equal(ui.invocations[0][1].body.amount_minor, 900);
  });
}
