// Read-only, on-demand review. The caller owns the existing enable mutation.
export function coverage(data, start, end) {
  const days=[];
  for(let date=start;date<=end;){days.push(date);const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);}
  const locations=new Set(data.locations.filter(x=>x.active).map(x=>x.id));
  const performers=new Set(data.performers.map(x=>x.id));
  const absent=(id,date)=>data.absences.some(x=>x.active&&x.performer_id===id&&x.starts_on<=date&&x.ends_on>=date);
  const shifts=data.shifts.filter(x=>x.active&&locations.has(x.location_id)&&performers.has(x.performer_id)&&x.shift_date>=start&&x.shift_date<=end&&x.start_time<x.end_time&&!absent(x.performer_id,x.shift_date));
  const gaps=data.performers.map(p=>({name:p.display_name,days:days.filter(d=>!shifts.some(s=>s.performer_id===p.id&&s.shift_date===d))}));
  const minutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));
  const uncovered=data.bookings.filter(b=>b.status!=='cancelled'&&b.booking_date>=start&&b.booking_date<=end&&!shifts.some(s=>{
    if(s.performer_id!==b.performer_id||s.location_id!==b.location_id||s.shift_date!==b.booking_date)return false;
    const from=minutes(b.booking_time),to=from+Number(b.duration_minutes);
    return from>=minutes(s.start_time)&&to<=minutes(s.end_time)&&!(s.break_start&&s.break_end&&from<minutes(s.break_end)&&to>minutes(s.break_start));
  }));
  return {shifts:shifts.length,gaps,uncovered:uncovered.length};
}

function ranges(days){
  const result=[];
  for(const day of days){const last=result.at(-1);if(last&&new Date(day+'T12:00:00Z')-new Date(last[1]+'T12:00:00Z')===86400000)last[1]=day;else result.push([day,day]);}
  const label=d=>d.slice(8)+'.'+d.slice(5,7)+'.'+d.slice(0,4);
  return result.map(([a,b])=>a===b?label(a):label(a)+'–'+label(b)).join(', ');
}

export async function review({db,organizationId,current,timeoutMs}){
  const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
  const start=now.toISOString().slice(0,10);const last=new Date(start+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+62);const end=last.toISOString().slice(0,10);
  const read=async()=>{let timer;return Promise.race([
    db.rpc('get_minuta_shift_workspace',{p_organization:organizationId,p_start:start,p_end:end}),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('coverage timeout')),timeoutMs);})
  ]).finally(()=>clearTimeout(timer));};
  const response=await read();
  if(!current())return false;
  const data=response?.data;
  if(response?.error||data?.organization_id!==organizationId||data.current_role!=='owner'||!['locations','performers','shifts','absences','bookings'].every(k=>Array.isArray(data[k])))throw Error('coverage unavailable');
  // Another session has already enabled it; refresh instead of sending a second write.
  if(data.enabled)throw Error('schedule already enabled');
  const state=coverage(data,start,end);
  const blocked=!state.shifts||state.uncovered>0;
  const dialog=document.createElement('dialog');dialog.className='shift-enable-review';
  dialog.style.cssText='width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--theme-line);border-radius:16px;background:var(--theme-surface,#fff);color:var(--theme-ink,#302c30)';
  dialog.setAttribute('aria-labelledby','shiftReviewTitle');
  const add=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;dialog.append(n);return n;};
  add('h3',blocked?'Сначала подготовьте смены':'Проверьте покрытие сменами').id='shiftReviewTitle';
  add('p',`Проверен период ${start.split('-').reverse().join('.')} — ${end.split('-').reverse().join('.')} (63 дня). Это отдельная проверка, независимо от открытой недели.`);
  if(!state.shifts)add('p','В этом периоде нет действующих смен. Включение запрещено: сначала добавьте смены специалистов.');
  else if(state.uncovered)add('p',`Будущих записей вне смен: ${state.uncovered}. Подготовьте подходящие смены. Режим не включён.`);
  else{
    add('p',`Действующих смен: ${state.shifts}. После включения клиент сможет выбрать время только внутри смен с учётом перерывов и отсутствий.`);
    const gaps=state.gaps.filter(x=>x.days.length);
    if(gaps.length){add('h4','Дни без смен');const list=add('ul','');for(const gap of gaps){const item=document.createElement('li');item.textContent=`${gap.name}: ${ranges(gap.days)}`;list.append(item);}}
    add('p','Дни без смен могут быть выходными — проверьте, что это намеренно. Даже в день со сменой время вне её часов недоступно. Даты за пределами проверенного периода здесь не оценивались.');
  }
  const form=document.createElement('form');form.method='dialog';form.style.cssText='display:grid;gap:12px;margin-top:20px';dialog.append(form);
  const cancel=document.createElement('button');cancel.type='submit';cancel.value='cancel';cancel.className='secondary-button';cancel.textContent=blocked?'Понятно':'Отмена';form.append(cancel);
  if(!blocked){
    const label=document.createElement('label');label.style.cssText='display:flex;gap:10px;align-items:flex-start;font-size:14px;font-weight:400;line-height:1.45';const check=document.createElement('input');check.type='checkbox';check.style.cssText='width:20px;height:20px;min-width:20px;flex:0 0 20px;padding:0;margin:2px 0';label.append(check,document.createTextNode('Я проверил дни и часы и понимаю, что время вне смен будет закрыто для онлайн-записи.'));form.prepend(label);
    const confirm=document.createElement('button');confirm.type='submit';confirm.value='enable';confirm.className='primary';confirm.textContent='Включить учёт смен';confirm.disabled=true;check.addEventListener('change',()=>confirm.disabled=!check.checked);form.append(confirm);
  }
  document.body.append(dialog);
  const accepted=await new Promise(resolve=>{
    let watch;
    const finish=()=>{clearInterval(watch);const accepted=dialog.returnValue==='enable'&&current();dialog.remove();resolve(accepted);};
    dialog.addEventListener('close',finish,{once:true});
    watch=setInterval(()=>{if(!current())dialog.close('cancel');},200);
    try{dialog.showModal();}catch(error){clearInterval(watch);dialog.remove();throw error;}
  });
  if(!accepted||!current())return false;
  const fresh=await read();
  const keys=['locations','performers','shifts','absences','bookings'];
  if(!current())return false;
  if(fresh?.error||fresh.data?.organization_id!==organizationId||fresh.data?.current_role!=='owner'||fresh.data?.enabled||JSON.stringify(keys.map(k=>fresh.data?.[k]))!==JSON.stringify(keys.map(k=>data[k])))throw Error('coverage changed during review');
  return true;
}
