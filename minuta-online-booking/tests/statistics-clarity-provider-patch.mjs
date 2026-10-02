import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const changes=[
  [
    "  if (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all') return reportCanViewTeam ? 'Вся команда' : 'Личная статистика';\n  return reportTeamAnalyticsState.rows.find(row => String(row.performer_id || '') === reportPerformerFilter)?.performer_name || 'Сотрудник';",
    "  if (!reportCanViewTeam || !reportPerformerFilter || reportPerformerFilter === 'all') return reportCanViewTeam ? 'Вся команда' : 'Личная статистика';\n  const s=reportTeamAnalyticsState,rows=window.MinutaStatisticsAuditProvider?.performerDirectory?.(s)||s.rows;\n  return rows.find(row=>String(row.performer_id||'')===reportPerformerFilter)?.performer_name||'Выбранный сотрудник';"
  ],
  [
    "  const wrap = $('#reportPerformerFilterWrap');\n  const select = $('#reportPerformerFilter');\n  if (!wrap || !select) return;\n  wrap.hidden = !reportCanViewTeam;\n  if (!reportCanViewTeam) { reportPerformerFilter = String(currentUser?.id || ''); updateReportFilterSummary(); return; }\n  if (!reportPerformerFilter) {\n    try { reportPerformerFilter = localStorage.getItem(`minuta-report-performer:${reportOrganizationId()}`) || 'all'; } catch { reportPerformerFilter = 'all'; }\n  }\n  if (reportPerformerFilter !== 'all' && !reportTeamAnalyticsState.rows.some(row => String(row.performer_id || '') === reportPerformerFilter)) reportPerformerFilter = 'all';\n  select.innerHTML = `<option value=\"all\">Вся команда</option>${reportTeamAnalyticsState.rows.map(row => `<option value=\"${escapeHtml(String(row.performer_id || ''))}\">${escapeHtml(row.performer_name || 'Сотрудник')}</option>`).join('')}`;\n  select.value = reportPerformerFilter;\n  updateReportFilterSummary();\n  const previous = previousReportRange(range);\n  loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);\n  loadReportAvailability(range, reportPerformerFilter);",
    "  const wrap = $('#reportPerformerFilterWrap');\n  const select = $('#reportPerformerFilter');\n  if (!wrap || !select) return;\n  const s=reportTeamAnalyticsState;\n  let rows=window.MinutaStatisticsAuditProvider?.performerDirectory?.(s)||s.rows;\n  wrap.hidden=!reportCanViewTeam;\n  if(!reportCanViewTeam){select.innerHTML='';reportPerformerFilter=String(currentUser?.id||'');updateReportFilterSummary();return;}\n  if (!reportPerformerFilter) {\n    try { reportPerformerFilter = localStorage.getItem(`minuta-report-performer:${reportOrganizationId()}`) || 'all'; } catch { reportPerformerFilter = 'all'; }\n  }\n  if(reportPerformerFilter!=='all'&&!rows.some(row=>String(row.performer_id||'')===reportPerformerFilter)){\n    if(!s.derived&&!['loading','failed'].includes(s.status))reportPerformerFilter='all';\n    else rows=[...rows,{performer_id:reportPerformerFilter,performer_name:'Выбранный сотрудник'}];\n  }\n  select.innerHTML=`<option value=\"all\">Вся команда</option>${rows.map(row=>`<option value=\"${escapeHtml(String(row.performer_id||''))}\">${escapeHtml(row.performer_name||'Сотрудник')}</option>`).join('')}`;\n  select.value=reportPerformerFilter;\n  updateReportFilterSummary();\n  const previous=previousReportRange(range);\n  loadReportScopedBookings({ start:previous?.start || range.start, end:reportForecastEnd(range) }, reportPerformerFilter);\n  loadReportAvailability(range,reportPerformerFilter);"
  ]
];
export function candidateProvider(input){
  let source=input.replace(/\r\n/g,'\n');
  if(source.includes(changes[0][1])){
    for(const [,after]of changes)assert.ok(source.includes(after),'both owner integration changes are required');
    return source;
  }
  for(const [before,after]of changes){
    assert.equal(source.split(before).length,2,'exact provider integration context required');
    source=source.replace(before,after);
  }
  return source;
}
export function providerPatch(input){
  const source=input.replace(/\r\n/g,'\n'),updated=candidateProvider(source);
  if(source===updated)return '';
  let offset=0;
  const hunks=changes.map(([before,after])=>{
    const index=source.indexOf(before),from=source.slice(0,index).split('\n').length-1;
    const lines=source.split('\n'),oldLines=before.split('\n'),newLines=after.split('\n');
    const pre=lines.slice(from-1,from),post=lines.slice(from+oldLines.length,from+oldLines.length+1);
    const hunk=`@@ -${from},${oldLines.length+2} +${from+offset},${newLines.length+2} @@\n`
      +[...pre.map(line=>' '+line),...oldLines.map(line=>'-'+line),...newLines.map(line=>'+'+line),...post.map(line=>' '+line)].join('\n')+'\n';
    offset+=newLines.length-oldLines.length;
    return hunk;
  });
  return 'diff --git a/minuta-online-booking/provider.js b/minuta-online-booking/provider.js\n--- a/minuta-online-booking/provider.js\n+++ b/minuta-online-booking/provider.js\n'+hunks.join('');
}
if(process.argv.includes('--write')){
  const source=readFileSync(resolve(root,'provider.js'),'utf8');
  writeFileSync(resolve(root,'docs/statistics-clarity-provider.patch'),providerPatch(source));
}
if(process.argv.includes('--check')){
  const source=readFileSync(resolve(root,'provider.js'),'utf8'),patch=providerPatch(source);
  if(patch){
    const saved=readFileSync(resolve(root,'docs/statistics-clarity-provider.patch'),'utf8').replace(/\r\n/g,'\n');
    const content=value=>value.split('\n').filter(line=>!line.startsWith('@@ ')).join('\n');
    assert.equal(content(saved),content(patch),'saved integration changes and context must match current provider');
    const checked=spawnSync('git',['apply','--check','-'],{input:saved,encoding:'utf8'});
    assert.equal(checked.status,0,checked.stderr);
    console.log('Exact owner integration patch applies cleanly.');
  } else console.log('Both provider integration changes are present.');
}
