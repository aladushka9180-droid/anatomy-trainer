(function initializeSoftBookingSettings() {
  'use strict';
  const panel=document.querySelector('[data-provider-panel="settings"]');
  if(!panel||panel.classList.contains('pro-settings-soft'))return;
  panel.classList.add('pro-settings-soft');
  function heading(host,text,description){
    if(!host)return;
    const title=document.createElement('h4');title.className='soft-settings-label';title.textContent=text;
    const hint=document.createElement('p');hint.className='soft-settings-hint';hint.textContent=description;
    host.prepend(title,hint);
  }
  heading(panel.querySelector('#organizationBookingPolicyWorkspace'),'Правила организации','Сохранённые условия организации, филиалов и услуг. Изменения сохраняются в редакторе правила.');
  heading(panel.querySelector('#bookingPolicyForm'),'Настройки специалиста','Личные условия записи и завершения визитов. Сохраняются отдельно от правил организации.');
})();
