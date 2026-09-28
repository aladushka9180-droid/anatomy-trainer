import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function summarizeAutoCompletion(log, failed = false) {
  const visits = new Set();
  let warningCount = 0;
  let unclassifiedWarnings = 0;
  for (const line of log.split(/\r?\n/u)) {
    if (!line.includes('auto_completion_inventory_shortfall')) continue;
    warningCount += 1;
    const match = line.match(/auto_completion_inventory_shortfall booking_id=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![0-9a-f-])/iu);
    if (match) visits.add(match[1].toLowerCase());
    else unclassifiedWarnings += 1;
  }
  return {
    status: failed ? 'failure' : warningCount ? 'degraded' : 'ok',
    uniqueSkippedVisits: visits.size,
    warningCount,
    unclassifiedWarnings,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let log = '';
  for await (const chunk of process.stdin) log += chunk;
  const summary = summarizeAutoCompletion(log, process.argv.includes('--failed'));
  // Never print the raw SQL output or visit identifiers, including on failure.
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `maintenance_status=${summary.status}\nunique_skipped_visits=${summary.uniqueSkippedVisits}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Автозавершение визитов\n\nСтатус: **${summary.status}**. Уникальных пропущенных визитов: **${summary.uniqueSkippedVisits}**. Предупреждений: ${summary.warningCount}; без распознанного идентификатора: ${summary.unclassifiedWarnings}.\n\nНедостаточный учётный остаток не доказывает физическое отсутствие материалов. Пропущенные визиты остаются незавершёнными.\n`);
  if (summary.status === 'degraded') console.log(
    `::warning title=Частичное автозавершение::Уникальных пропущенных визитов: ${summary.uniqueSkippedVisits}; предупреждений без распознанного идентификатора: ${summary.unclassifiedWarnings}. Проверьте учётный остаток и нормы расхода.`);
}
