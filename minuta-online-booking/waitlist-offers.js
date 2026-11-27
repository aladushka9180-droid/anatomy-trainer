(function (global) {
  'use strict';
  const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
  const labels = { offered:'Предложено', accepted:'Принято', expired:'Истекло', busy:'Уже занято' };
  const reasons = { deadline:'Срок предложения истёк.', request_closed:'Заявка закрыта или отменена.', service_terms_changed:'Условия услуги изменились. Попросите новое предложение.', slot_busy:'Это время уже занято. Попросите другое предложение.' };
  function samaraInputToISO(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('invalid_deadline');
    const [y,m,d,h,min] = value.match(/\d+/g).map(Number);
    const date = new Date(Date.UTC(y,m-1,d,h-4,min));
    if (new Date(date.getTime()+4*3600000).toISOString().slice(0,16)!==value) throw new Error('invalid_deadline');
    return date.toISOString();
  }
  function samaraInput(value) { return new Date(new Date(value).getTime()+4*3600000).toISOString().slice(0,16); }
  function dateText(value) { return new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Samara',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}); }
  function offerLink(base,offer,token) {
    if (!uuid(offer) || !uuid(token)) throw new Error('invalid_offer_link');
    const url = new URL('waitlist.html',base); url.search='?scope=organization';
    url.hash=new URLSearchParams({token,offer}).toString(); return url.href;
  }
  function validOffer(value,id) {
    if (!value || value.offerId!==id || !labels[value.state] || !/^\d{4}-\d{2}-\d{2}$/.test(value.bookingDate || '')
      || !/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value.bookingTime || '') || !Number.isFinite(Date.parse(value.expiresAt))
      || !Number.isInteger(value.priceRub) || value.priceRub<0 || !Number.isInteger(value.durationMinutes) || value.durationMinutes<=0)
      throw new Error('offer_response_invalid');
    if (value.state==='accepted' && (!uuid(value.booking?.manageToken) || !uuid(value.booking?.requestId) || !value.booking?.bookingCode))
      throw new Error('offer_response_invalid');
    return value;
  }
  async function rpc(db,name,args) { const {data,error}=await db.rpc(name,args); if(error) throw error; return data; }
  function client({db,offer,token,render}) {
    let running=false,latest=null;
    if(!uuid(offer) || !uuid(token)) throw new Error('invalid_offer_link');
    async function invoke(accept) {
      if(running || (accept && latest?.state!=='offered')) return;
      running=true; render({loading:true,offer:latest});
      try {
        const value=validOffer(await rpc(db,accept?'accept_minuta_waitlist_offer_v196':'get_minuta_waitlist_offer_v196',{p_offer:offer,p_token:token}),offer);
        latest=value; render({offer:value}); return value;
      } catch { latest=null; render({error:accept?'Результат принятия не подтверждён. Обновите предложение перед повтором.':'Не удалось проверить предложение. Повторите загрузку.'}); }
      finally { running=false; }
    }
    return {load:()=>invoke(false),accept:()=>invoke(true)};
  }
  function employee({db,request,newUUID}) {
    let pending=null,running=false;
    if(!uuid(request)) throw new Error('invalid_request');
    return {
      read:()=>rpc(db,'get_minuta_waitlist_employee_v196',{p_request:request}),
      async create({date,time,expires}) {
        if(running) throw new Error('request_in_progress');
        const key=JSON.stringify([date,time,expires]);
        if(pending?.key!==key) pending={key,id:newUUID()};
        running=true;
        try {
          const value=await rpc(db,'create_minuta_waitlist_offer_v196',{p_offer:pending.id,p_request:request,p_date:date,p_time:time,p_expires:expires});
          if(!value || value.offerId!==pending.id || !labels[value.state] || !uuid(value.clientToken)) throw new Error('offer_response_invalid');
          return value;
        } finally { running=false; }
      }
    };
  }
  global.MinutaWaitlistOffers={uuid,labels,reasons,samaraInputToISO,samaraInput,dateText,offerLink,validOffer,client,employee};
})(typeof window==='undefined'?globalThis:window);
