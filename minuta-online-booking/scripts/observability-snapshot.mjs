import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const DAY_MS = 24 * 60 * 60 * 1000;

export const PROPOSED_SLO = Object.freeze({
  availabilityPercent: 99.9,
  bookingLatencyP95Ms: 1000,
  notificationFinalPercent: 99,
  notificationFinalMinutes: 5,
  paymentProcessedPercent: 99.9,
  paymentProcessedMinutes: 2,
  unreconciledMaxMinutes: 15,
  backupMaxHours: 26,
  restoreMaxDays: 35,
  coverageDays: 30,
  alertMaxMinutes: 5,
  responseMaxMinutes: 15
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percent(part, total) {
  return total > 0 ? (part / total) * 100 : null;
}

function percentile95(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function ageIn(now, timestamp, unitMs) {
  const parsed = Date.parse(timestamp || '');
  return Number.isFinite(parsed) ? Math.max(0, (now.getTime() - parsed) / unitMs) : null;
}

function metric(id, title, target, status, observed, reason, source) {
  return { id, title, target, status, observed, reason, source };
}

export function evaluateSnapshot(raw, options = {}) {
  const now = new Date(options.now || raw.observedAt || new Date().toISOString());
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid observability timestamp');

  const coverageDays = finiteNumber(raw.coverage?.completeDaysWithAvailabilitySamples);
  const coverageComplete = coverageDays >= PROPOSED_SLO.coverageDays
    && raw.availability?.truncated !== true;
  const scheduledRuns = finiteNumber(raw.availability?.scheduledRuns);
  const successfulRuns = finiteNumber(raw.availability?.successfulRuns);
  const availability = percent(successfulRuns, scheduledRuns);

  const latencySamples = Array.isArray(raw.bookingLatency?.samplesMs)
    ? raw.bookingLatency.samplesMs.map(Number).filter(Number.isFinite)
    : [];
  const latencyP95 = percentile95(latencySamples);
  const latencyCoverage = finiteNumber(raw.bookingLatency?.windowDays);

  const notificationsEligible = finiteNumber(raw.notifications?.eligible);
  const notificationsWithin = finiteNumber(raw.notifications?.finalWithinTarget);
  const notificationsOverdue = finiteNumber(raw.notifications?.nonFinalOlderTarget);
  const notificationsPercent = percent(notificationsWithin, notificationsEligible);

  const paymentsEligible = finiteNumber(raw.payments?.eligible);
  const paymentsWithin = finiteNumber(raw.payments?.processedWithinTarget);
  const paymentsUnreconciled = finiteNumber(raw.payments?.unreconciledOlderTarget);
  const paymentsPercent = percent(paymentsWithin, paymentsEligible);

  const backupAgeHours = ageIn(now, raw.backup?.lastSuccessAt, 60 * 60 * 1000);
  const restoreAgeDays = ageIn(now, raw.restore?.lastSuccessAt, DAY_MS);

  const slos = [];
  slos.push(metric(
    'availability',
    'Доступность критического контура',
    `≥${PROPOSED_SLO.availabilityPercent}% за ${PROPOSED_SLO.coverageDays} дней`,
    !coverageComplete || availability === null
      ? 'insufficient_data'
      : availability >= PROPOSED_SLO.availabilityPercent ? 'pass' : 'fail',
    availability === null ? 'нет проб' : `${availability.toFixed(3)}% (${successfulRuns}/${scheduledRuns})`,
    !coverageComplete
      ? `полных дней с пробами: ${coverageDays}/${PROPOSED_SLO.coverageDays}; success-rate workflow является приближением доступности`
      : 'расчёт по завершённым плановым health-пробам',
    'github_actions_health'
  ));
  slos.push(metric(
    'booking_latency',
    'p95 серверных операций записи',
    `≤${PROPOSED_SLO.bookingLatencyP95Ms} мс за ${PROPOSED_SLO.coverageDays} дней`,
    latencyCoverage < PROPOSED_SLO.coverageDays || latencyP95 === null
      ? 'insufficient_data'
      : latencyP95 <= PROPOSED_SLO.bookingLatencyP95Ms ? 'pass' : 'fail',
    latencyP95 === null ? 'инструментирование отсутствует' : `${Math.round(latencyP95)} мс; проб: ${latencySamples.length}`,
    latencyP95 === null
      ? 'health-check измеряет чтение, но не создание, перенос и отмену записи'
      : `покрытие: ${latencyCoverage.toFixed(1)} дней`,
    'booking_operation_telemetry'
  ));
  slos.push(metric(
    'notification_final_status',
    'Конечный статус уведомлений',
    `≥${PROPOSED_SLO.notificationFinalPercent}% за ≤${PROPOSED_SLO.notificationFinalMinutes} мин`,
    !coverageComplete || raw.notifications?.available !== true || notificationsEligible <= 0
      ? 'insufficient_data'
      : notificationsPercent >= PROPOSED_SLO.notificationFinalPercent && notificationsOverdue === 0 ? 'pass' : 'fail',
    notificationsPercent === null
      ? 'нет подходящих уведомлений'
      : `${notificationsPercent.toFixed(3)}%; просрочено без финала: ${notificationsOverdue}`,
    raw.notifications?.available === true
      ? `финал вовремя: ${notificationsWithin}/${notificationsEligible}`
      : 'таблица или read-only источник недоступны',
    'notification_outbox'
  ));
  slos.push(metric(
    'payment_webhooks',
    'Обработка платёжных webhook',
    `≥${PROPOSED_SLO.paymentProcessedPercent}% за ≤${PROPOSED_SLO.paymentProcessedMinutes} мин; несверенных >${PROPOSED_SLO.unreconciledMaxMinutes} мин — 0`,
    !coverageComplete || raw.payments?.available !== true || paymentsEligible <= 0
      ? 'insufficient_data'
      : paymentsPercent >= PROPOSED_SLO.paymentProcessedPercent && paymentsUnreconciled === 0 ? 'pass' : 'fail',
    paymentsPercent === null
      ? 'нет подходящих webhook'
      : `${paymentsPercent.toFixed(3)}%; несверенных старше порога: ${paymentsUnreconciled}`,
    raw.payments?.available === true
      ? `обработано вовремя: ${paymentsWithin}/${paymentsEligible}; ошибки до записи в БД этим источником не видны`
      : 'таблицы или read-only источник недоступны',
    'payment_event_journal'
  ));
  slos.push(metric(
    'backup_freshness',
    'Свежесть резервной копии',
    `≤${PROPOSED_SLO.backupMaxHours} ч`,
    backupAgeHours === null ? 'insufficient_data' : backupAgeHours <= PROPOSED_SLO.backupMaxHours ? 'pass' : 'fail',
    backupAgeHours === null ? 'успешный запуск не найден' : `${backupAgeHours.toFixed(2)} ч`,
    raw.backup?.lastSuccessAt || 'нет timestamp',
    'github_actions_backup'
  ));
  slos.push(metric(
    'restore_drill_freshness',
    'Свежесть restore drill',
    `≤${PROPOSED_SLO.restoreMaxDays} дней`,
    restoreAgeDays === null ? 'insufficient_data' : restoreAgeDays <= PROPOSED_SLO.restoreMaxDays ? 'pass' : 'fail',
    restoreAgeDays === null ? 'успешный запуск не найден' : `${restoreAgeDays.toFixed(2)} дней`,
    raw.restore?.lastSuccessAt || 'нет timestamp',
    'github_actions_restore'
  ));

  const failed = slos.filter(item => item.status === 'fail');
  const insufficient = slos.filter(item => item.status === 'insufficient_data');
  const alertReasons = failed.map(item => `${item.id}: ${item.observed}`);

  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    policy: {
      approvalStatus: 'proposed_pending_approval',
      coverageRequiredDays: PROPOSED_SLO.coverageDays,
      liveAlertDelivery: 'disabled_pending_approval',
      note: 'Пороги применяются только для оценки. Адресаты и первая реальная тревога требуют подтверждения пользователя.'
    },
    sources: raw.sources || {},
    sourceLimitations: Array.isArray(raw.sourceLimitations) ? raw.sourceLimitations : [],
    coverage: {
      completeDaysWithAvailabilitySamples: coverageDays,
      requiredDays: PROPOSED_SLO.coverageDays,
      status: coverageComplete ? 'complete' : 'insufficient_data'
    },
    slos,
    summary: {
      pass: slos.filter(item => item.status === 'pass').length,
      fail: failed.length,
      insufficientData: insufficient.length,
      evaluation: failed.length ? 'breach_detected' : insufficient.length ? 'insufficient_data' : 'within_proposed_targets'
    },
    alertPreview: {
      wouldFire: failed.length > 0,
      reasons: alertReasons,
      externalDeliveryAttempted: false,
      deliveryStatus: 'disabled_pending_approval',
      targetDeliveryMinutes: PROPOSED_SLO.alertMaxMinutes
    }
  };
}

function markdownStatus(status) {
  return ({ pass: 'PASS', fail: 'FAIL', insufficient_data: 'INSUFFICIENT DATA' })[status] || status;
}

function escapeTable(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function renderMarkdown(report) {
  const rows = report.slos.map(item =>
    `| ${escapeTable(item.title)} | ${escapeTable(item.target)} | ${escapeTable(item.observed)} | ${markdownStatus(item.status)} | ${escapeTable(item.reason)} |`
  );
  const alertLine = report.alertPreview.wouldFire
    ? `Синтетическая тревога **сработала бы**: ${report.alertPreview.reasons.map(escapeTable).join('; ')}.`
    : 'По доступным данным синтетическая тревога не сработала бы.';
  const limitations = report.sourceLimitations.length
    ? `\n## Ограничения источников\n\n${report.sourceLimitations.map(item => `- ${item}`).join('\n')}\n`
    : '';
  return `# PrimeTime Pro — observability snapshot\n\n` +
    `Сформирован: ${report.generatedAt}. Пороги: **предложены, ожидают подтверждения**. ` +
    `Покрытие: ${report.coverage.completeDaysWithAvailabilitySamples}/${report.coverage.requiredDays} полных дней.\n\n` +
    `| SLO | Цель | Наблюдение | Статус | Основание |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n` +
    `## Предпросмотр тревоги\n\n${alertLine} Внешняя отправка не выполнялась.\n` +
    limitations;
}

function completeUtcDates(now, count) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: count }, (_, index) => new Date(end - (count - index) * DAY_MS).toISOString().slice(0, 10));
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'primetime-pro-observability'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path.split('?')[0]}`);
  return response.json();
}

async function workflowRunsForDate(repository, workflow, date, token, maxPages) {
  const result = [];
  let truncated = false;
  for (let page = 1; page <= maxPages; page += 1) {
    const query = new URLSearchParams({ branch: 'main', created: `${date}..${date}`, per_page: '100', page: String(page) });
    const data = await githubJson(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?${query}`, token);
    const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
    result.push(...runs);
    if (runs.length < 100) return { runs: result, truncated: false };
  }
  truncated = true;
  return { runs: result, truncated };
}

async function latestSuccessfulWorkflowRun(repository, workflow, token) {
  const query = new URLSearchParams({ branch: 'main', status: 'success', per_page: '10' });
  const data = await githubJson(`/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs?${query}`, token);
  const run = (data.workflow_runs || []).find(item => item.status === 'completed' && item.conclusion === 'success');
  return run ? { createdAt: run.created_at, updatedAt: run.updated_at, url: run.html_url, headSha: run.head_sha } : null;
}

async function collectGithubMetrics(now) {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)?.trim();
  if (!repository || !token) throw new Error('GITHUB_REPOSITORY/GITHUB_TOKEN are not configured');
  const maxPages = Math.max(1, Math.min(10, finiteNumber(process.env.MINUTA_OBSERVABILITY_MAX_API_PAGES_PER_DAY, 4)));
  const dates = completeUtcDates(now, PROPOSED_SLO.coverageDays);
  const daily = [];
  for (const date of dates) {
    daily.push(await workflowRunsForDate(repository, 'minuta-production-health.yml', date, token, maxPages));
  }
  const scheduled = daily.flatMap(item => item.runs)
    .filter(run => run.event === 'schedule' && run.status === 'completed');
  const backup = await latestSuccessfulWorkflowRun(repository, 'minuta-supabase-backup.yml', token);
  const restore = await latestSuccessfulWorkflowRun(repository, 'minuta-supabase-restore-drill.yml', token);
  return {
    availability: {
      scheduledRuns: scheduled.length,
      successfulRuns: scheduled.filter(run => run.conclusion === 'success').length,
      failedRuns: scheduled.filter(run => run.conclusion !== 'success').length,
      truncated: daily.some(item => item.truncated)
    },
    coverageDays: daily.filter(item => item.runs.some(run => run.event === 'schedule' && run.status === 'completed')).length,
    backup,
    restore
  };
}

export function postgresConnectionEnv(databaseUrl) {
  let parsed;
  try { parsed = new URL(String(databaseUrl || '').trim()); } catch { throw new Error('MINUTA_OBSERVABILITY_DATABASE_URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.username || parsed.pathname.length < 2) {
    throw new Error('MINUTA_OBSERVABILITY_DATABASE_URL is invalid');
  }
  try {
    return {
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || '5432',
      PGUSER: decodeURIComponent(parsed.username),
      PGPASSWORD: decodeURIComponent(parsed.password),
      PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
      PGSSLMODE: parsed.searchParams.get('sslmode') || 'require',
      PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=15000'
    };
  } catch {
    throw new Error('MINUTA_OBSERVABILITY_DATABASE_URL is invalid');
  }
}

async function psqlJson(sql) {
  const databaseUrl = (process.env.MINUTA_OBSERVABILITY_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('MINUTA_OBSERVABILITY_DATABASE_URL is not configured');
  const env = {
    ...process.env,
    ...postgresConnectionEnv(databaseUrl)
  };
  delete env.MINUTA_OBSERVABILITY_DATABASE_URL;
  const { stdout } = await execFileAsync('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env,
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  const output = stdout.trim();
  if (!output) throw new Error('psql returned no JSON');
  return JSON.parse(output.split(/\r?\n/).at(-1));
}

async function collectDatabaseMetrics() {
  const schema = await psqlJson(`select jsonb_build_object(
    'notification_outbox',to_regclass('public.notification_outbox') is not null,
    'payment_events',to_regclass('public.payment_events') is not null,
    'payment_provider_events',to_regclass('public.payment_provider_events') is not null,
    'payment_provider_attempts',to_regclass('public.payment_provider_attempts') is not null,
    'payment_provider_refunds',to_regclass('public.payment_provider_refunds') is not null,
    'payment_provider_reconciliations',to_regclass('public.payment_provider_reconciliations') is not null
  )`);

  let notifications = { available: false, eligible: 0, finalWithinTarget: 0, nonFinalOlderTarget: 0 };
  if (schema.notification_outbox) {
    notifications = await psqlJson(`select jsonb_build_object(
      'available',true,
      'eligible',count(*) filter(where created_at>=now()-interval '30 days' and created_at<now()-interval '5 minutes'),
      'finalWithinTarget',count(*) filter(where created_at>=now()-interval '30 days' and created_at<now()-interval '5 minutes'
        and status in ('sent','failed','cancelled')
        and coalesce(delivered_at,sent_at,updated_at)<=created_at+interval '5 minutes'),
      'nonFinalOlderTarget',count(*) filter(where status in ('pending','sending') and created_at<now()-interval '5 minutes')
    ) from public.notification_outbox`);
  }

  let payments = { available: false, eligible: 0, processedWithinTarget: 0, unreconciledOlderTarget: 0 };
  if (schema.payment_events || schema.payment_provider_events) {
    const eventParts = [];
    if (schema.payment_events) {
      eventParts.push(`select received_at,processed_at,processing_status from public.payment_events where actor_kind='webhook' and received_at>=now()-interval '30 days'`);
    }
    if (schema.payment_provider_events) {
      eventParts.push(`select received_at,processed_at,processing_status from public.payment_provider_events where received_at>=now()-interval '30 days'`);
    }
    const staleParts = [];
    if (schema.payment_provider_attempts) staleParts.push(`select id::text as key from public.payment_provider_attempts where status='creating' and updated_at<now()-interval '15 minutes'`);
    if (schema.payment_provider_refunds) staleParts.push(`select id::text as key from public.payment_provider_refunds where status='creating' and updated_at<now()-interval '15 minutes'`);
    if (schema.payment_provider_reconciliations) {
      staleParts.push(`select concat(object_kind,':',coalesce(refund_id,attempt_id)::text) as key from (
        select distinct on (object_kind,coalesce(refund_id,attempt_id)) object_kind,refund_id,attempt_id,outcome,checked_at
        from public.payment_provider_reconciliations
        order by object_kind,coalesce(refund_id,attempt_id),checked_at desc,id desc
      ) latest where outcome in ('pending','failed') and checked_at<now()-interval '15 minutes'`);
    }
    payments = await psqlJson(`with events as (${eventParts.join(' union all ')}), stale as (${staleParts.length ? staleParts.join(' union ') : "select null::text as key where false"})
      select jsonb_build_object(
        'available',true,
        'eligible',(select count(*) from events where received_at<now()-interval '2 minutes'),
        'processedWithinTarget',(select count(*) from events where received_at<now()-interval '2 minutes' and processing_status='processed' and processed_at<=received_at+interval '2 minutes'),
        'unreconciledOlderTarget',(select count(*) from stale)
      )`);
  }
  return { notifications, payments, schema };
}

export async function collectSnapshot(options = {}) {
  const now = new Date(options.now || new Date().toISOString());
  const sourceLimitations = [
    'Доступность вычисляется как success-rate плановых GitHub health-проб и пока не является полноценной time-based availability.',
    'p95 создания, переноса и отмены записи требует отдельного production-инструментирования; эта задача его намеренно не добавляет.',
    'Ошибки платёжного webhook до записи события в БД не видны текущему read-only журналу.',
    'Реальная доставка тревоги отключена до утверждения адресатов и первой контролируемой проверки.'
  ];
  const raw = {
    observedAt: now.toISOString(),
    sources: {},
    sourceLimitations,
    coverage: { completeDaysWithAvailabilitySamples: 0 },
    availability: { scheduledRuns: 0, successfulRuns: 0, failedRuns: 0, truncated: false },
    bookingLatency: { samplesMs: [], windowDays: 0 },
    notifications: { available: false, eligible: 0, finalWithinTarget: 0, nonFinalOlderTarget: 0 },
    payments: { available: false, eligible: 0, processedWithinTarget: 0, unreconciledOlderTarget: 0 },
    backup: { lastSuccessAt: null },
    restore: { lastSuccessAt: null }
  };

  try {
    const github = await collectGithubMetrics(now);
    raw.sources.github = { status: 'available' };
    raw.coverage.completeDaysWithAvailabilitySamples = github.coverageDays;
    raw.availability = github.availability;
    raw.backup = { lastSuccessAt: github.backup?.updatedAt || null, ...github.backup };
    raw.restore = { lastSuccessAt: github.restore?.updatedAt || null, ...github.restore };
  } catch (error) {
    raw.sources.github = { status: 'unavailable', error: error?.message || String(error) };
    sourceLimitations.push(`GitHub Actions: ${error?.message || error}`);
  }

  try {
    const database = await collectDatabaseMetrics();
    raw.sources.database = { status: 'available', transactionMode: 'read_only', schema: database.schema };
    raw.notifications = database.notifications;
    raw.payments = database.payments;
  } catch (error) {
    raw.sources.database = { status: 'unavailable', transactionMode: 'read_only', error: error?.message || String(error) };
    sourceLimitations.push(`База данных: ${error?.message || error}`);
  }
  return raw;
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unknown argument: ${key}`);
    if (key === '--help') return { help: true };
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

async function writeOutput(path, content) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node observability-snapshot.mjs [--input raw.json] [--now ISO] --json-out report.json --markdown-out report.md');
    return;
  }
  const raw = args.input
    ? JSON.parse(await readFile(resolve(args.input), 'utf8'))
    : await collectSnapshot({ now: args.now });
  const report = evaluateSnapshot(raw, { now: args.now });
  const markdown = renderMarkdown(report);
  if (args['json-out']) await writeOutput(args['json-out'], `${JSON.stringify(report, null, 2)}\n`);
  if (args['markdown-out']) await writeOutput(args['markdown-out'], markdown);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8');
  console.log(`PrimeTime Pro observability: ${report.summary.evaluation}; pass=${report.summary.pass}; fail=${report.summary.fail}; insufficient=${report.summary.insufficientData}; alert_would_fire=${report.alertPreview.wouldFire}`);
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) main().catch(error => {
  console.error(`PrimeTime Pro observability: ERROR; ${error?.message || error}`);
  process.exitCode = 1;
});
