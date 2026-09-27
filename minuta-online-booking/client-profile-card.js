/* Presentation of the existing profile. Original controls and permissions stay intact. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const paths = {copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',message:'<path d="M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.8L3 21l1.4-4.7A9 9 0 1 1 21 11.5Z"/>',phone:'<path d="m8 3 3 5-3 2a15 15 0 0 0 6 6l2-3 5 3c-1 5-4 6-9 3S3 11 3 7c0-3 2-4 5-4Z"/>',gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C5 8 5 2 8 2c3 0 4 6 4 6Zm0 0s1-6 4-6c3 0 3 6-4 6Z"/>'};
  const icon = name => paths[name] ? `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>` : `<svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-${name}"></use></svg>`;
  const date = (value, time = false) => new Date(value).toLocaleString('ru-RU', { day:'numeric',month:'long',year:'numeric',...(time ? {hour:'2-digit',minute:'2-digit',timeZone:'Europe/Samara'} : {}) });
  let current = null, limit = 8, clientKey = '';
  function mount() {
    const profile = $('#clientProfileContent')?.closest('.client-profile');
    if (!profile || profile.classList.contains('client-profile-card')) return;
    profile.classList.add('client-profile-card');
    const head = profile.querySelector('.client-profile-head');
    const toolbar = document.createElement('div'); toolbar.className = 'profile-card-toolbar';
    const back = $('#clientProfileBack'); profile.prepend(toolbar); toolbar.append(back);
    const menu = document.createElement('details'); menu.className = 'profile-card-menu';
    menu.innerHTML = `<summary aria-label="Дополнительно">${icon('more')}</summary><div></div>`;
    toolbar.append(menu);
    const menuBody = menu.querySelector('div');
    for (const id of ['clientCommerceSale','clientMoreButton']) { const button = $(`#${id}`); if (button) menuBody.append(button); }
    const help=profile.querySelector('[data-contextual-help]');if(help)menuBody.append(help);
    menuBody.addEventListener('click', event => { if (event.target.closest('button')) menu.open = false; });
    const avatar = $('#clientProfileOrbit');
    const avatarSlot = document.createElement('div'); avatarSlot.className = 'profile-card-avatar-slot'; avatar.before(avatarSlot); avatarSlot.append(avatar);
    const identity = profile.querySelector('.client-profile-identity');
    const contact = profile.querySelector('.client-profile-contact'); identity.append(contact);
    $('#clientCopyPhone').innerHTML = icon('copy');
    const actions = profile.querySelector('.client-profile-primary-actions');
    const quick = $('#clientQuickRepeat'); actions.before(quick);
    const write = $('#clientContactButton'); write.innerHTML = `${icon('message')}<span>Написать</span>`;
    write.setAttribute('aria-label','Выбрать способ связи с клиентом');
    const call = document.createElement('a');call.id='clientProfileCall';call.innerHTML=`${icon('phone')}<span>Позвонить</span>`;actions.append(call);
    call.addEventListener('click',event=>{if(call.getAttribute('aria-disabled')==='true')event.preventDefault();});
    const summary = profile.querySelector('.client-summary');
    const totals = document.createElement('div');totals.className='profile-card-totals';
    const visit = $('#clientVisits').closest('article'), spent = $('#clientSpent').closest('article');
    summary.before(totals);totals.append(visit,spent);
    const last = $('#clientLastVisit').closest('article'), next = $('#clientNext').closest('article');
    for (const [row,label,name] of [[last,'Последний визит','calendar'],[next,'Следующая запись','clock']]) {
      row.querySelector('.client-summary-icon').innerHTML=icon(name);
      const small=row.querySelector('small');small.textContent=label;row.querySelector('div').prepend(small);
    }
    const loyalty=$('#clientMilestoneCard');
    const loyaltyIcon=document.createElement('span');loyaltyIcon.className='profile-card-row-icon';loyaltyIcon.innerHTML=icon('gift');loyalty.prepend(loyaltyIcon);
    const birthday=$('#clientBirthdayInfo');if(birthday)loyalty.after(birthday);
    const level=$('#clientLoyaltyLevel');if(level)loyalty.after(level);
    const history=document.createElement('section');history.id='clientProfileVisitHistory';history.className='profile-card-history';
    $('#clientProfilePanelHistory').prepend(history);
    history.addEventListener('click',event=>{if(event.target.closest('[data-profile-history-more]')){limit+=12;renderHistory();}});
  }
  function historyGroups(bookings, outcome, now = new Date()) {
    const unique=[...new Map((bookings||[]).map(item=>[item.id,item])).values()];
    const future = item => item.status !== 'cancelled' && outcome(item).visit_status === 'scheduled'
      && new Date(`${item.booking_date}T${String(item.booking_time).slice(0,8)}+04:00`) >= now;
    const stamp=item=>`${item.booking_date} ${item.booking_time}`;
    return {upcoming:unique.filter(future).sort((a,b)=>stamp(a).localeCompare(stamp(b))),past:unique.filter(item=>!future(item)).sort((a,b)=>stamp(b).localeCompare(stamp(a)))};
  }
  function historyItem(item) {
    const { outcome, status, money, serviceName } = current;
    const result=outcome(item), imported=Boolean(item.is_imported_history), cancelled=item.status==='cancelled';
    const label=cancelled?status(item):imported?'Импортировано':result.visit_status==='completed'?'Состоялся':status(item);
    const tone=cancelled||result.visit_status==='no_show'?'muted':imported?'imported':result.visit_status==='completed'||item.status==='confirmed'?'success':'pending';
    const received=Math.max(0,Number(result.amount_rub)||0);
    const payment=received ? `Получено ${money(received)}` : 'Оплата пока не получена';
    const debt=!cancelled&&result.visit_status==='completed'&&current.value ? Math.max(0,current.value(item)-received) : 0;
    const duration=Number(item.duration_minutes || item.services?.duration_minutes || 0);
    const title=serviceName(item.services?.name || 'Услуга');
    const durationText=duration && !/\d+\s*мин/.test(title) ? `${duration} мин` : '';
    return `<article class="profile-card-visit">${icon('calendar')}<div><time>${escape(date(`${item.booking_date}T${String(item.booking_time).slice(0,8)}+04:00`,true))}</time>
      <button type="button" class="profile-card-visit-open" data-open-booking="${escape(item.id)}"><strong>${escape(title)}</strong><span aria-hidden="true">›</span></button>
      ${durationText?`<span class="profile-card-visit-details">${escape(durationText)}</span>`:''}<span class="profile-card-status is-${tone}">${escape(label)}</span>
      <p>${escape(payment)}${debt?` · Долг ${escape(money(debt))}`:''}</p>${imported?'<small>Из импортированной истории</small>':''}${result._sync_pending?'<small>Сохранено на устройстве · ожидает синхронизации</small>':''}</div></article>`;
  }
  function renderHistory() {
    if(!current)return;
    const {upcoming,past}=historyGroups(current.client.bookings,current.outcome);
    const shownPast=past.slice(0,limit);
    const pastTitle=past.every(item=>current.outcome(item).visit_status==='completed'&&item.status!=='cancelled')?'Прошлые визиты':'Прошлые записи';
    $('#clientProfileVisitHistory').innerHTML=`${upcoming.length?`<h4>Предстоящие записи</h4>${upcoming.slice(0,limit).map(historyItem).join('')}`:''}
      ${shownPast.length?`<h4>${pastTitle}</h4>${shownPast.map(historyItem).join('')}`:''}
      ${!upcoming.length&&!past.length?'<p class="profile-card-empty">История появится после первой записи.</p>':''}
      ${upcoming.length>limit||past.length>limit?'<button type="button" class="profile-card-history-more" data-profile-history-more>Показать ещё</button>':''}`;
  }
  function render(options) {
    if (!$('#clientProfileContent') || !options?.client) return;
    mount();current=options;
    const key=`${options.scope || ''}:${options.client.phone}`;
    if(key!==clientKey){clientKey=key;limit=8;}
    const digits=String(options.client.phone||'').replace(/\D/g,'');
    const call=$('#clientProfileCall');call.href=digits?`tel:${digits}`:'#';call.setAttribute('aria-disabled',String(!digits));
    const visits=Number(options.visits)||0;
    const word=visits%100>=11&&visits%100<=14?'визитов':visits%10===1?'визит':[2,3,4].includes(visits%10)?'визита':'визитов';
    $('#clientVisits').closest('article').querySelector('small').textContent=word;
    const completed=(options.client.bookings||[]).filter(item=>item.status!=='cancelled'&&options.outcome(item).visit_status==='completed');
    const last=completed.sort((a,b)=>`${b.booking_date}${b.booking_time}`.localeCompare(`${a.booking_date}${a.booking_time}`))[0];
    const lastDate=[last?.booking_date, options.client.imported?.last_visit_on].filter(Boolean).sort().at(-1);
    $('#clientLastVisit').textContent=lastDate?date(`${lastDate}T12:00:00`):'Пока нет';
    const next=historyGroups(options.client.bookings,options.outcome).upcoming[0];
    $('#clientNext').textContent=next?new Date(`${next.booking_date}T${String(next.booking_time).slice(0,8)}+04:00`).toLocaleString('ru-RU',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Samara'}):'Не запланирована';
    $('#clientNextDetails').textContent=next?options.serviceName(next.services?.name||'Услуга'):'';
    renderHistory();
  }
  window.addEventListener('minuta:provider-session-reset',()=>{current=null;clientKey='';limit=8;$('#clientProfileVisitHistory')?.replaceChildren();});
  window.PrimeTimeClientProfileCard=Object.freeze({render,historyGroups});
})();
