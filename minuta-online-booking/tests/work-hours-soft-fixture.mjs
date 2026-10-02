import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const html = readFileSync(path.join(root, 'provider.html'), 'utf8');
const sprite = readFileSync(path.join(root, 'ui-icons.svg'), 'utf8');
const provider = readFileSync(path.join(root, 'provider.js'), 'utf8');
const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)(?:\?[^\"]*)?"[^>]*>/g)]
  .map(match => ({ file:match[1], media:match[0].match(/media="([^"]+)"/)?.[1] || '' }));
function realFunction(name) {
  const start = new RegExp(`(?:^|\\n)(?:async )?function ${name}\\(`).exec(provider);
  if (!start) throw new Error(`Missing actual provider function ${name}`);
  const offset = start.index + (provider[start.index] === '\n' ? 1 : 0);
  const tail = provider.slice(offset);
  const next = /\n(?:async )?function \w+\(/.exec(tail);
  return next ? tail.slice(0, next.index).trim() : tail;
}
const functionNames = ['shortTime','defaultScheduleRows','comparableSchedule','normalizeScheduleMonth','shiftScheduleMonth',
  'scheduleRowsFromForm','scheduleDayRangeLabel','updateWeeklyScheduleSummary','updateScheduleSaveState','setScheduleDirty',
  'setScheduleSaveError','scheduleStateForDate','scheduleEmptyDayLabel','schedulePresetDays','schedulePresetForDays',
  'setScheduleQuickDays','syncScheduleQuickControls','syncScheduleDayCard','applyQuickSchedule','renderMonthlyScheduleDetails',
  'renderMonthlySchedule','renderSchedule','renderDaysOff','uiIcon','saveSchedule','syncSlotIntervalOptions','escapeHtml','parseLocalIsoDate','localIsoDate'];
const handlers = provider.slice(provider.indexOf("$$('[data-schedule-quick-preset]').forEach(button => button.addEventListener"),
  provider.indexOf("$('#monthlyScheduleDetails').addEventListener('click'"));
if (!handlers.includes("$('#applyQuickSchedule').addEventListener('click', applyQuickSchedule)")) throw new Error('Actual schedule listeners missing');
const runtime = `
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let currentUser = {id:'fixture-performer'}, sessionGeneration = 1, writesAllowed = true, scheduleDirty = false;
const weekdayNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
let scheduleRows, monthlyScheduleMonth = '2026-10', selectedMonthlyScheduleDate = '';
const daysOff = [{id:'fixture-day-off',off_date:'2026-10-02',all_day:true},
  {id:'fixture-partial',off_date:'2026-10-03',all_day:false,start_time:'13:00',end_time:'14:00'}];
const allBookings = [{booking_date:'2026-10-03',status:'confirmed'}];
const businessTodayIso = () => '2026-10-02';
const requireWrites = () => writesAllowed;
const sessionIsCurrent = (id,generation) => id === currentUser.id && generation === sessionGeneration;
const refreshSettingsQuickStart = () => {};
const clearFormError = selector => { $(selector).hidden = true; $(selector).textContent = ''; };
const showFormError = (selector,text) => { $(selector).hidden = false; $(selector).textContent = text; };
const notify = text => { window.hoursFixtureNotice = text; };
const saveProviderCache = async () => {};
window.hoursFixtureWrites = [];
const db = {from(table) {
  if (table !== 'provider_schedule') throw new Error('Unexpected fixture table');
  return {select(){return this;},eq(field,id){if(id !== 'fixture-performer')throw new Error('Unexpected fixture scope');return this;},
    async order(){return {data:structuredClone(scheduleRows),error:null};},
    async upsert(rows){if(window.hoursFixtureFailure)return {error:{message:'Synthetic failure'}};
      window.hoursFixtureWrites.push(structuredClone(rows)); return {error:null};}};
}};
${functionNames.map(realFunction).join('\n')}
scheduleRows = defaultScheduleRows(currentUser.id);
$('#dayOffDate').min = businessTodayIso();
renderSchedule();
renderDaysOff();
${handlers}
$('#slotInterval').addEventListener('change', event => { syncSlotIntervalOptions(event.target.value); setScheduleDirty(true); renderMonthlySchedule(); });
$('#saveSchedule').addEventListener('click', saveSchedule);
$('#weeklySchedule').addEventListener('change', event => {
  const card=event.target.closest('[data-schedule-day]'); if(!card)return;
  setScheduleDirty(true);
  if(event.target.matches('[data-schedule-enabled]'))syncScheduleDayCard(card,event.target.checked);
  if(event.target.matches('[data-schedule-break]'))card.querySelector('.break-hours').hidden=!event.target.checked;
  renderMonthlySchedule();
});
`;

export async function fixture(page, { theme='pink-porcelain', enhanced=true }={}) {
  const blocked=[];
  await page.route('**/*', route => {blocked.push(route.request().url()); return route.abort();});
  await page.setContent('<!doctype html><html lang="ru"><head><meta charset="utf-8"></head><body class="provider-body"></body></html>');
  await page.evaluate(({markup,theme,sprite}) => {
    document.body.dataset.providerTheme=theme;
    document.body.dataset.providerLayout='soft';
    document.body.dataset.providerResolvedColorMode=theme==='oled-mono'?'dark':'light';
    document.body.dataset.providerPorcelainCharacter='petal';
    document.body.dataset.providerPorcelainShade='gentle-pink';
    const original=new DOMParser().parseFromString(markup,'text/html');
    const dashboard=document.createElement('section'); dashboard.id='dashboard'; dashboard.className='provider-app'; dashboard.dataset.activeView='schedule';
    const sidebar=document.importNode(original.querySelector('.provider-sidebar'),true);
    sidebar.querySelectorAll('[data-provider-view]').forEach(button=>button.classList.toggle('active',button.dataset.providerView==='schedule'));
    const workspace=document.createElement('div'); workspace.className='provider-workspace';
    const section=document.importNode(original.querySelector('[data-provider-panel="schedule"]'),true); section.hidden=false;
    section.querySelector('#monthlyScheduleEditor').open=true;
    workspace.append(section); dashboard.append(sidebar,workspace); document.body.append(dashboard);
    const icons=new DOMParser().parseFromString(sprite,'image/svg+xml').documentElement;
    const symbols=document.createElementNS('http://www.w3.org/2000/svg','svg');
    symbols.setAttribute('style','position:absolute;width:0;height:0;overflow:hidden');
    symbols.setAttribute('aria-hidden','true');
    for(const symbol of icons.querySelectorAll('symbol'))symbols.append(document.importNode(symbol,true));
    document.body.append(symbols);
    document.querySelectorAll('use[href^="ui-icons.svg#"]').forEach(use=>use.setAttribute('href',use.getAttribute('href').replace('ui-icons.svg','')));
  },{markup:html,theme,sprite});
  for(const layer of styles) {
    const text=readFileSync(path.join(root,layer.file),'utf8');
    await page.addStyleTag({content:layer.media?`@media ${layer.media}{${text}}`:text});
  }
  await page.addScriptTag({content:readFileSync(path.join(root,'provider-porcelain-matrix.js'),'utf8')});
  await page.evaluate(() => {
    if(document.body.dataset.providerTheme!=='pink-porcelain')return;
    const palette=window.MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');
    for(const [key,token] of Object.entries({bg:'bg',surface:'surface','surface-alt':'surfaceAlt',ink:'ink',muted:'muted',line:'line',accent:'accent','accent-soft':'accentSoft','accent-contrast':'contrast'})) {
      document.body.style.setProperty(`--theme-${key}`,palette[token]);
    }
    document.body.style.setProperty('--porcelain-action-bg',palette.actionBg);
    document.body.style.setProperty('--porcelain-action-ink',palette.actionInk);
  });
  await page.addScriptTag({content:runtime});
  await page.evaluate(()=>document.querySelectorAll('use[href^="ui-icons.svg"]').forEach(use=>use.setAttribute('href',`#${use.getAttribute('href').split('#')[1]}`)));
  await page.addScriptTag({content:readFileSync(path.join(root,'provider-selects.js'),'utf8')});
  if(enhanced) {
    await page.addStyleTag({content:readFileSync(path.join(root,'work-hours-soft.css'),'utf8')});
    await page.addScriptTag({content:readFileSync(path.join(root,'work-hours-soft.js'),'utf8')});
  }
  return {blocked};
}
