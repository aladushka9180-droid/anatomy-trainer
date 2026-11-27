(async function () {
  'use strict';
  const api=window.MinutaWaitlistOffers, $=id=>document.getElementById(id);
  const request=new URLSearchParams(location.hash.slice(1)).get('request');
  const db=window.supabase.createClient(window.MINUTA_CONFIG.supabaseUrl,window.MINUTA_CONFIG.supabaseKey);
  let controller,loaded=null,loading=false,creating=false;
  const error=text=>{ $('employeeError').textContent=text; $('employeeError').hidden=!text; };
  const controls=()=>{ $('employeeCreateOffer').disabled=loading||creating||!loaded; $('employeeReload').disabled=loading||creating; $('employeeSlot').disabled=loading||creating; $('employeeDeadline').disabled=loading||creating; };
  function renderOffer(offer,token) {
    $('employeeLastOffer').hidden=!offer;
    if(!offer) return;
    $('employeeOfferState').textContent=api.labels[offer.state]||'Не удалось проверить предложение';
    $('employeeOfferDetails').textContent=`${offer.bookingDate} · ${offer.bookingTime.slice(0,5)} · ${offer.priceRub} ₽ · ${offer.durationMinutes} мин. Принять до ${api.dateText(offer.expiresAt)}.`;
    $('employeeOfferReason').textContent=api.reasons[offer.reason]||'';
    $('employeeOfferLink').value=api.offerLink(location.href,offer.offerId,token);
  }
  async function load() {
    if(loading||creating) return;
    loading=true; loaded=null; controls(); error('');
    try {
      const {data,error:authError}=await db.auth.getUser();
      if(authError||!data?.user) throw new Error('auth_required');
      controller ||= api.employee({db,request,newUUID:()=>crypto.randomUUID()});
      const value=await controller.read();
      if(value.requestId!==request || !Array.isArray(value.slots)) throw new Error('response_invalid');
      loaded=value; $('employeeContext').textContent=[value.clientName,value.serviceName,value.locationName,value.performerName].filter(Boolean).join(' · ');
      $('employeeContent').hidden=false;
      renderOffer(value.offer,value.clientToken);
      const allowed=['waiting','contacted'].includes(value.requestStatus)&&value.offer?.state!=='offered'&&value.slots.length;
      $('employeeOfferForm').hidden=!allowed;
      $('employeeSlot').replaceChildren(...value.slots.map(slot=>{const option=document.createElement('option');option.value=JSON.stringify(slot);option.textContent=`${slot.date} · ${slot.time.slice(0,5)}`;return option;}));
      $('employeeDeadline').min=api.samaraInput(value.serverNow);
      updateMax();
    } catch { $('employeeContent').hidden=true; error('Не удалось открыть заявку. Проверьте вход в кабинет и доступ к этой организации, затем обновите.'); }
    finally {loading=false;controls();}
  }
  function updateMax(){ const raw=$('employeeSlot').value;if(!raw)return;const slot=JSON.parse(raw);$('employeeDeadline').max=api.samaraInput(`${slot.date}T${slot.time}+04:00`); }
  $('employeeSlot').addEventListener('change',updateMax);
  $('employeeOfferForm').addEventListener('submit',async event=>{
    event.preventDefault(); if(creating||loading||!loaded)return;
    creating=true;controls();error('');
    try {
      const slot=JSON.parse($('employeeSlot').value),expires=api.samaraInputToISO($('employeeDeadline').value);
      if(Date.parse(expires)<=Date.parse(loaded.serverNow)||Date.parse(expires)>=Date.parse(`${slot.date}T${slot.time}+04:00`)) throw new Error('invalid_deadline');
      const offer=await controller.create({date:slot.date,time:slot.time,expires});
      renderOffer(offer,offer.clientToken);$('employeeOfferForm').hidden=true;
    } catch {error('Предложение не подтверждено. Проверьте срок и обновите заявку; повтор с тем же временем и сроком сохранит номер предложения.');}
    finally {creating=false;controls();}
  });
  $('employeeCopyLink').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('employeeOfferLink').value);$('employeeCopyResult').textContent='Ссылка скопирована. Передайте её клиенту согласованным способом.';}catch{$('employeeOfferLink').select();$('employeeCopyResult').textContent='Выделите и скопируйте ссылку.';}});
  $('employeeReload').addEventListener('click',load);
  await load();
})();
