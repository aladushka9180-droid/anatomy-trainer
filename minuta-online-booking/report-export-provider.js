function reportExportScope() {
  const range = reportRange();
  const organizationId = String(reportOrganizationId() || '');
  const performer = reportCanViewTeam ? String(reportPerformerFilter || 'all') : String(currentUser?.id || '');
  const previous = reportUsesScopedBookings() ? previousReportRange(range) : null;
  const query = reportUsesScopedBookings()
    ? reportDataQueryRange({ start:previous?.start || range.start, end:reportForecastEnd(range) }) : null;
  const expectedKey = query ? reportSessionKey(organizationId, query.start, query.end, performer) : '';
  const locationId = String(document.querySelector('#reportExportLocation')?.value || 'all');
  const segment = String(document.querySelector('#reportExportSegment')?.value || 'all');
  return { userId:String(currentUser?.id || ''), generation:sessionGeneration,
    organizationId, activeOrganizationId:String(organizationController?.getActiveOrganization?.()?.id || ''),
    source:reportDataSource, start:range.start, end:range.end, period:reportPeriod, locationId, segment,
    performer, scopedKey:reportUsesScopedBookings() ? reportScopedBookingsState.key : '',
    scopedStatus:reportUsesScopedBookings() && reportScopedBookingsState.key === expectedKey
      ? reportScopedBookingsState.status : reportUsesScopedBookings() ? 'stale' : 'ready' };
}
function reportExportScopeCurrent(scope) {
  const current = reportExportScope();
  return Boolean(scope.userId && scope.organizationId && scope.start && scope.end && scope.start <= scope.end
    && ['all','new','returning'].includes(scope.segment) && scope.locationId
    && (!reportUsesScopedBookings() || scope.scopedStatus === 'ready')
    && Object.keys(scope).every(key => scope[key] === current[key]));
}
function reportExportFullConsent() {
  return Boolean(document.querySelector('.report-export-review .report-audit-consent input:checked'));
}
async function reportExportAuthorized(scope, privacy, fullConsent) {
  if (!['none', 'masked', 'full'].includes(privacy) || !reportExportScopeCurrent(scope)) return false;
  if (privacy === 'full' && (!fullConsent || scope.source !== 'own')) return false;
  try {
    const identity = await db.auth.getUser();
    if (identity.error || String(identity.data?.user?.id || '') !== scope.userId || !reportExportScopeCurrent(scope)) return false;
    const workspace = await db.rpc('get_minuta_workspace');
    const organization = Array.isArray(workspace.data?.organizations)
      ? workspace.data.organizations.find(item => String(item.id || '') === scope.organizationId) : null;
    return !workspace.error && organization?.status === 'active'
      && (scope.locationId === 'all' || Array.isArray(organization.locations)
        && organization.locations.some(item => String(item.id || '') === scope.locationId))
      && (privacy !== 'full' || organization.current_role === 'owner') && reportExportScopeCurrent(scope);
  } catch { return false; }
}
function reportExportDenied() { notify('Экспорт остановлен: проверьте аккаунт, организацию и права, затем повторите.'); }
function reportExportFailed() { reportExportDenied(); }
function reportExportSegmentItems(items, segment) {
  if (segment === 'all') return items;
  const firstVisits = new Map();
  reportCompletedItems(items).forEach(item => {
    const key = reportClientIdentity(item);
    if (!key) return;
    const when = `${item.booking_date || ''}T${String(item.booking_time || '00:00').slice(0,5)}`;
    if (!firstVisits.has(key) || when < firstVisits.get(key).when) firstVisits.set(key, { when, prior:Boolean(item.client_had_previous) });
  });
  const keys = new Set([...firstVisits].filter(([,value]) => value.prior === (segment === 'returning')).map(([key]) => key));
  return items.filter(item => keys.has(reportClientIdentity(item)));
}
async function reportExportItems(scope, privacy, fullConsent) {
  if (scope.source === 'demo') return null;
  const selectedLocation = scope.locationId === 'all' ? null : scope.locationId;
  const params = { p_organization:scope.organizationId, p_start:scope.start, p_end:scope.end,
    p_performer:scope.performer === 'all' ? null : scope.performer, p_location:selectedLocation,
    p_phone_mode:privacy, p_limit:1000, p_offset:0 };
  const rows = [];
  const sources = selectedLocation ? ['get_minuta_report_export_bookings']
    : ['get_minuta_report_export_bookings','get_minuta_report_export_imported_history'];
  for (const name of sources) {
    let offset = 0;
    do {
      if (!await reportExportAuthorized(scope, privacy, fullConsent)) throw new Error('report_export_context_changed');
      const result = await db.rpc(name, { ...params, p_offset:offset });
      if (result.error) throw result.error;
      const payload = result.data;
      if (!payload || String(payload.organization_id || '') !== scope.organizationId
        || (payload.location_id || null) !== (name === 'get_minuta_report_export_bookings' ? selectedLocation : null)
        || String(payload.performer_id || 'all') !== scope.performer
        || payload.phone_mode !== privacy || !Array.isArray(payload.bookings)
        || payload.bookings.length > 1000) throw new Error('report_export_scope_mismatch');
      for (const item of payload.bookings) {
        if (!item || String(item.organization_id || '') !== scope.organizationId
          || item.booking_date < scope.start || item.booking_date > scope.end
          || (scope.performer !== 'all' && String(item.performer_id || '') !== scope.performer)
          || (selectedLocation && (String(item.location_id || '') !== selectedLocation || item.is_imported_history))
          || (privacy !== 'full' && /\d{6,}/.test(String(item.client_phone || '').replaceAll(/[^\d]/g,''))))
          throw new Error('report_export_row_scope_mismatch');
        rows.push({ ...item, is_report_export:true });
      }
      if (rows.length > 100000) throw new Error('report_export_too_large');
      if (!payload.has_more) break;
      if (payload.next_offset !== offset + 1000 || !payload.bookings.length) throw new Error('report_export_page_mismatch');
      offset = payload.next_offset;
    } while (true);
  }
  return reportExportSegmentItems(rows, scope.segment);
}
async function reportExportPreparedData(scope, privacy, fullConsent) {
  const items = await reportExportItems(scope, privacy, fullConsent);
  if (!await reportExportAuthorized(scope, privacy, fullConsent)) throw new Error('report_export_context_changed');
  const data = reportExportData(privacy, items, scope);
  if (scope.locationId !== 'all') notify('Выбранный филиал: импортированные визиты без филиала исключены из этого отчёта.');
  return data;
}
async function exportBookingsXlsx(privacy='masked') {
  const scope = reportExportScope(), consent = reportExportFullConsent();
  if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
  let data;
  try { data = await reportExportPreparedData(scope, privacy, consent); }
  catch (error) { reportExportFailed(error); return; }
  const blob = reportProfessionalWorkbook(reportExportSheets(data));
  if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
  reportExportDownload(blob,reportExportFilename(data.range,'xlsx'));notify('Готовый отчёт Excel скачан');
}
async function exportBookingsCsv(privacy='masked') {
  const scope = reportExportScope(), consent = reportExportFullConsent();
  if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
  let data;
  try { data = await reportExportPreparedData(scope, privacy, consent); }
  catch (error) { reportExportFailed(error); return; }
  const quote=value=>`"${String(value??'').replaceAll('"','""')}"`,csv=[data.headers,...data.rows].map(row=>row.map(quote).join(';')).join('\r\n');
  if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
  reportExportDownload(new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'}),reportExportFilename(data.range,'csv'));notify('Таблица CSV скачана');
}
function reportPdfText(ctx,text,x,y,maxWidth){let value=String(text??'');if(ctx.measureText(value).width<=maxWidth){ctx.fillText(value,x,y);return;}while(value.length&&ctx.measureText(`${value}…`).width>maxWidth)value=value.slice(0,-1);ctx.fillText(`${value}…`,x,y);}
function reportPdfPage(title,subtitle){const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1131;const ctx=canvas.getContext('2d');ctx.fillStyle='#f6f1ea';ctx.fillRect(0,0,1600,1131);ctx.fillStyle='#a9664c';ctx.fillRect(55,45,1490,105);ctx.fillStyle='#fff';ctx.font='700 34px Arial';ctx.fillText(title,85,92);ctx.font='20px Arial';ctx.fillText(subtitle,85,128);return {canvas,ctx};}
function reportPdfImageBytes(canvas){const base64=canvas.toDataURL('image/jpeg',.92).split(',')[1],binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i+=1)bytes[i]=binary.charCodeAt(i);return bytes;}
function reportPdfBlob(images){const encoder=new TextEncoder(),objects=[],pageIds=images.map((_,i)=>3+i*3);objects[0]=encoder.encode('<< /Type /Catalog /Pages 2 0 R >>');objects[1]=encoder.encode(`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(' ')}] /Count ${images.length} >>`);images.forEach((image,index)=>{const pageId=pageIds[index],contentId=pageId+1,imageId=pageId+2,content=`q 842 0 0 595 0 0 cm /Im${index+1} Do Q`;objects[pageId-1]=encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im${index+1} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);objects[contentId-1]=encoder.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);const head=encoder.encode(`<< /Type /XObject /Subtype /Image /Width 1600 /Height 1131 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),tail=encoder.encode('\nendstream');objects[imageId-1]=new Blob([head,image,tail]);});const chunks=[encoder.encode('%PDF-1.4\n%PDF\n')],offsets=[0];let offset=chunks[0].length;objects.forEach((object,index)=>{offsets[index+1]=offset;const head=encoder.encode(`${index+1} 0 obj\n`),tail=encoder.encode('\nendobj\n');chunks.push(head,object,tail);offset+=head.length+(object.size??object.length)+tail.length;});const xref=offset;let table=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<=objects.length;i+=1)table+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;chunks.push(encoder.encode(`${table}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));return new Blob(chunks,{type:'application/pdf'});}
async function exportBookingsPdf(){
  const scope=reportExportScope();
  if (!await reportExportAuthorized(scope, 'none', false)) { reportExportDenied(); return; }
  let data;
  try { data = await reportExportPreparedData(scope, 'none', false); }
  catch (error) { reportExportFailed(error); return; }
  const period=`${reportExportDate(data.range.start)} — ${reportExportDate(data.range.end)}`,images=[];
  let page=reportPdfPage('Отчёт Eldion Pro',`Период: ${period}`),ctx=page.ctx;const cards=[['Получено',money(data.revenue)],['Оказано на',money(data.completedValue)],['Визиты',data.completed.length],['Клиенты',data.clients.uniqueClients]];cards.forEach((card,index)=>{const x=55+index*378;ctx.fillStyle='#fffdfa';ctx.fillRect(x,180,352,125);ctx.fillStyle='#78695f';ctx.font='20px Arial';ctx.fillText(card[0],x+22,218);ctx.fillStyle='#332923';ctx.font='700 32px Arial';ctx.fillText(String(card[1]),x+22,270);});ctx.fillStyle='#78695f';ctx.font='16px Arial';ctx.fillText(data.unknownPaymentCount ? `Оплата не указана: ${money(data.importedValue)} · визитов: ${data.unknownPaymentCount} из ${data.completed.length}; это не подтверждённый долг.` : 'Отчёт по датам визитов. Получено — отмеченные оплаты, не банковская выписка.',55,334);ctx.fillStyle='#332923';ctx.font='700 26px Arial';ctx.fillText('Результаты мастеров',55,365);const teamHeaders=['Мастер','Визиты','Клиенты','Минуты','Выручка','Средний чек'];ctx.font='700 17px Arial';teamHeaders.forEach((value,index)=>ctx.fillText(value,65+[0,460,610,760,940,1170][index],410));ctx.font='17px Arial';data.team.slice(0,12).forEach((row,rowIndex)=>{const y=450+rowIndex*45;ctx.fillStyle=rowIndex%2?'#fffdfa':'#f2e6dd';ctx.fillRect(55,y-28,1490,40);ctx.fillStyle='#332923';row.slice(0,6).forEach((value,index)=>reportPdfText(ctx,index>=4&&typeof value==='number'?money(value):value,65+[0,460,610,760,940,1170][index],y,index===0?390:190));});images.push(reportPdfImageBytes(page.canvas));
  const perPage=22;for(let start=0;start<data.rows.length;start+=perPage){page=reportPdfPage('Реестр записей',`${period} · строки ${start+1}–${Math.min(start+perPage,data.rows.length)}`);ctx=page.ctx;const columns=[['Дата',0,120],['Время',125,90],['Клиент',220,260],['Услуга',485,420],['Мастер',910,210],['Мин.',1125,80],['Получено',1210,155],['Результат',1370,170]];ctx.fillStyle='#332923';ctx.font='700 16px Arial';columns.forEach(column=>ctx.fillText(column[0],60+column[1],190));ctx.font='15px Arial';data.rows.slice(start,start+perPage).forEach((row,rowIndex)=>{const y=230+rowIndex*38;ctx.fillStyle=rowIndex%2?'#fffdfa':'#f2e6dd';ctx.fillRect(55,y-25,1490,34);ctx.fillStyle='#332923';const values=[row[0],row[1],row[3],row[5],row[6],row[7],row[10] === null ? 'Нет данных' : money(row[10]),row[13]];values.forEach((value,index)=>reportPdfText(ctx,value,60+columns[index][1],y,columns[index][2]-10));});images.push(reportPdfImageBytes(page.canvas));}
  const blob=reportPdfBlob(images);
  if (!await reportExportAuthorized(scope, 'none', false)) { reportExportDenied(); return; }
  reportExportDownload(blob,reportExportFilename(data.range,'pdf'));notify('Готовый отчёт PDF скачан');
}

async function exportBookingsXlsxInBackground(privacy='masked') {
  if (!window.Worker || !window.Blob || !window.URL) { await exportBookingsXlsx(privacy); return; }
  const scope = reportExportScope(), consent = reportExportFullConsent();
  if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
  let data;
  try { data = await reportExportPreparedData(scope, privacy, consent); }
  catch (error) { reportExportFailed(error); return; }
  const button = $('[data-report-export="xlsx"]');
  const originalText = button?.querySelector('strong')?.textContent || '';
  if (button) button.disabled = true;
  if (button?.querySelector('strong')) button.querySelector('strong').textContent = 'Готовим…';
  let worker;
  try {
      worker = new Worker('./report-worker.js?v=811');
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('report_worker_timeout')), 20000);
      worker.onmessage = event => {
        clearTimeout(timeout);
        if (event.data?.error || !event.data?.blob) reject(new Error(event.data?.error || 'report_worker_failed'));
        else resolve(event.data.blob);
      };
      worker.onerror = event => { clearTimeout(timeout); reject(event.error || new Error('report_worker_failed')); };
      worker.postMessage({ sheets:reportExportSheets(data) });
    });
    if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
    reportExportDownload(result, reportExportFilename(data.range, 'xlsx'));
    notify('Готовый отчёт Excel скачан');
  } catch {
    if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
    const fallback = reportProfessionalWorkbook(reportExportSheets(data));
    if (!await reportExportAuthorized(scope, privacy, consent)) { reportExportDenied(); return; }
    reportExportDownload(fallback, reportExportFilename(data.range, 'xlsx'));
    notify('Готовый отчёт Excel скачан');
  } finally {
    worker?.terminate();
    if (button) button.disabled = false;
    if (button?.querySelector('strong')) button.querySelector('strong').textContent = originalText;
  }
}
