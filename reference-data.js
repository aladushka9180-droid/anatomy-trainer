(function(){
  'use strict';

  const CATEGORY_LABELS={
    all:'Все',
    muscles:'Мышцы',
    bones:'Кости',
    movements:'Движения',
    palpation:'Пальпация',
    safety:'Безопасность',
    terms:'Термины'
  };

  const normalize=value=>String(value||'')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g,'е')
    .replace(/[^a-zа-я0-9c]+/gi,' ')
    .trim();

  const unique=(rows,key)=>{
    const seen=new Set();
    return rows.filter(row=>{
      const value=normalize(key(row));
      if(!value||seen.has(value))return false;
      seen.add(value);
      return true;
    });
  };

  const PAGE_SIZE=12;
  const POPULAR_HINTS=[
    'лопатка','дельтовидная','трапециевидная','атлант','позвоночник','плечевой сустав',
    'седалищный нерв','икроножная','пальпация','красные флаги','боль','осанка'
  ];
  const POPULAR_TERM_HINTS=[
    'пальпация','сочленяется','иннервация','фасция','триггерная точка','гипертонус',
    'амплитуда','антагонист','синергист','проксимальный','дистальный','медиальный'
  ];

  const richerText=(a,b)=>{
    const first=String(a||'').trim();
    const second=String(b||'').trim();
    return normalize(second).length>normalize(first).length?second:first;
  };

  const mergeSections=(first=[],second=[])=>{
    const seen=new Set();
    return [...first,...second].filter(section=>{
      if(!section||!String(section.text||'').trim())return false;
      const key=normalize(`${section.label||''}|${section.text||''}`);
      if(!key||seen.has(key))return false;
      seen.add(key);
      return true;
    }).map(section=>({label:String(section.label||'').trim(),text:String(section.text||'').trim()}));
  };

  const entryIdentity=entry=>{
    const category=String(entry.category||'all');
    const title=normalize(entry.title).replace(/^(движение|движения|пальпация|безопасность)\s+/,'');
    if(['terms','muscles','bones','movements'].includes(category))return `${category}|${title}`;
    const decisive=(entry.sections||[])
      .filter(section=>/как поступить|правильн|ответ|решение/i.test(String(section.label||'')))
      .map(section=>section.text)
      .join(' ');
    return `${category}|${title}|${normalize(entry.lead||'')}|${normalize(decisive||'')}`;
  };

  const mergeEntries=rows=>{
    const merged=new Map();
    rows.forEach(entry=>{
      const key=entryIdentity(entry);
      const current=merged.get(key);
      if(!current){
        merged.set(key,{...entry,sections:mergeSections(entry.sections),keywords:unique([entry.keywords].flat().filter(Boolean),value=>value)});
        return;
      }
      current.title=richerText(current.title,entry.title);
      current.subtitle=richerText(current.subtitle,entry.subtitle);
      current.lead=richerText(current.lead,entry.lead);
      current.sections=mergeSections(current.sections,entry.sections);
      current.keywords=unique([...([current.keywords].flat()),...([entry.keywords].flat())].filter(Boolean),value=>value);
    });
    return [...merged.values()];
  };

  function massageEntry(q,category){
    const area=String(q.cat||'').split(' · ')[1]||q.visual||'Общая практика';
    const title=category==='palpation'
      ?`Пальпация: ${area}`
      :`Безопасность: ${area}`;
    const lead=q.simple||q.text||'';
    const answer=typeof q.correct==='string'?q.correct:'';
    return{
      id:`${category}:${q.key||title}`,
      category,
      title,
      subtitle:q.label||q.cat||'',
      lead,
      sections:[
        answer&&{label:'Как поступить',text:answer},
        q.explain&&{label:'Почему',text:q.explain},
        q.memory&&{label:'Как запомнить',text:q.memory},
        q.safety&&{label:'Важно',text:q.safety}
      ].filter(Boolean),
      keywords:[q.cat,q.label,q.visual,answer].filter(Boolean).join(' ')
    };
  }

  function buildReferenceEntries({items=[],massageQuestions=[],practiceCases=[],simpleTerms=[],anatomyTerms=[]}={}){
    const entries=[];
    items.forEach(item=>{
      const isBone=item.kind==='bone';
      entries.push({
        id:`${isBone?'bone':'muscle'}:${item.id}`,
        category:isBone?'bones':'muscles',
        title:item.name,
        subtitle:item.cat||'',
        lead:isBone?'Кость или костный ориентир':'Мышца',
        sections:[
          {label:isBone?'Роль и расположение':'Что делает',text:item.function},
          {label:isBone?'Как узнать':'Где крепится',text:item.attach}
        ].filter(section=>section.text),
        keywords:[item.cat,item.function,item.attach].filter(Boolean).join(' ')
      });
      if(!isBone&&item.function){
        entries.push({
          id:`movement:${item.id}`,
          category:'movements',
          title:`Движения: ${item.name}`,
          subtitle:item.cat||'',
          lead:item.function,
          sections:[
            {label:'Мышца',text:item.name},
            item.attach&&{label:'Крепление',text:item.attach}
          ].filter(Boolean),
          keywords:[item.name,item.cat,item.function].filter(Boolean).join(' ')
        });
      }
    });

    const questions=[...massageQuestions,...practiceCases];
    questions.forEach(q=>{
      const categoryText=normalize(`${q.cat||''} ${q.label||''}`);
      if(categoryText.includes('пальпатор')||categoryText.includes('пальпац')){
        entries.push(massageEntry(q,'palpation'));
      }
      if(categoryText.includes('безопас')||categoryText.includes('опасн')||categoryText.includes('топограф')||String(q.key||'').startsWith('case::')){
        entries.push(massageEntry(q,'safety'));
      }
      if(categoryText.includes('кинезиолог')){
        entries.push({
          ...massageEntry(q,'movements'),
          id:`movement:${q.key}`,
          title:`Движение: ${String(q.cat||'').split(' · ')[1]||q.visual||'практика'}`,
          subtitle:'Кинезиология'
        });
      }
    });

    unique([...simpleTerms,...anatomyTerms],row=>row?.[1]).forEach((row,index)=>{
      if(!row?.[1]||!row?.[2])return;
      entries.push({
        id:`term:${index}:${normalize(row[1])}`,
        category:'terms',
        title:row[1],
        subtitle:'Термин простыми словами',
        lead:row[2],
        sections:[],
        keywords:row[2]
      });
    });

    return mergeEntries(entries)
      .map(row=>({...row,searchText:normalize([row.title,row.subtitle,row.lead,row.keywords,...row.sections.flatMap(section=>[section.label,section.text])].join(' '))}));
  }

  function injectStyles(){
    if(document.getElementById('referenceStyles'))return;
    const style=document.createElement('style');
    style.id='referenceStyles';
    style.textContent=`
      .referencehead{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:22px}
      .referencehead h2{margin:5px 0 7px}.referencehead p{max-width:680px;margin:0;color:var(--muted);line-height:1.5}
      .referencetabs{display:flex;gap:8px;margin:0 0 18px;overflow-x:auto;padding:2px 1px 5px;scrollbar-width:thin}
      .referencetab{flex:1 0 170px;min-height:46px;padding:9px 14px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font:inherit;font-weight:800;cursor:pointer;white-space:nowrap}
      .referencetab[aria-selected="true"]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,var(--surface));box-shadow:inset 0 0 0 1px var(--accent)}
      .referencetab:focus-visible,.referencemore:focus-visible,.referencecard summary:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 45%,transparent);outline-offset:2px}
      .referencetabpanel[hidden],.referencefilters[hidden],.referencefilterhint[hidden]{display:none!important}.referencebrowse{min-width:0}
      .referencecontrols{display:grid;gap:12px;margin-bottom:18px}
      .referencesearch{position:relative;display:block}.referencesearch span{position:absolute;top:50%;left:15px;transform:translateY(-50%);color:var(--muted);pointer-events:none}
      .referencesearch input{width:100%;min-height:54px;padding:0 48px 0 44px;border:1px solid var(--border);border-radius:14px;background:var(--surface2);color:var(--text);font:inherit;font-size:17px}
      .referencesearch input::placeholder{color:var(--muted)}
      .referenceclear{position:absolute;top:50%;right:8px;transform:translateY(-50%);min-width:38px;min-height:38px;border:0;border-radius:10px;background:transparent;color:var(--muted);cursor:pointer}
      .referencefilters{display:flex;gap:7px;overflow-x:auto;padding:2px 1px 5px;scrollbar-width:thin}
      .referencefilters button{flex:0 0 auto;min-height:42px;padding:8px 13px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text);font-weight:750;cursor:pointer}
      .referencefilters button.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,var(--surface));box-shadow:inset 0 0 0 1px var(--accent)}
      .referencestatus{display:flex;justify-content:space-between;gap:12px;align-items:center;margin:0 2px 12px;color:var(--muted);font-size:14px}
      .referenceresults{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .referencecard{border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden}
      .referencecard summary{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 10px;min-height:94px;padding:15px;cursor:pointer;list-style:none}
      .referencecard summary::-webkit-details-marker{display:none}.referencecard strong{min-width:0;font-size:17px;line-height:1.3;overflow-wrap:anywhere}.referencecard small{grid-column:1;min-width:0;color:var(--muted);line-height:1.35;overflow-wrap:anywhere}
      .referencecardaction{grid-column:2;grid-row:1/3;align-self:center;color:var(--accent);font-size:13px;font-weight:850;white-space:nowrap}
      .referencecategory{display:inline-flex;align-items:center;width:max-content;margin-bottom:8px;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 13%,var(--surface2));color:var(--text);font-size:12px;font-weight:750}
      .referencebody{padding:0 15px 15px;border-top:1px solid var(--border);line-height:1.55}.referencebody>p{margin:13px 0}.referencebody dl{margin:0}.referencebody dt{margin-top:12px;color:var(--muted);font-size:13px;font-weight:750}.referencebody dd{margin:4px 0 0}
      .referenceempty{grid-column:1/-1;padding:36px 18px;border:1px dashed var(--border);border-radius:14px;text-align:center;color:var(--muted)}
      .referencemore{display:block;width:min(100%,360px);min-height:46px;margin:14px auto 0;padding:10px 16px;border:1px solid var(--border);border-radius:12px;background:var(--surface);color:var(--text);font:inherit;font-weight:800;cursor:pointer}
      .referencemore:hover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--surface))}
      @media(max-width:700px){.referencehead{flex-direction:column}.referencehead .btn{width:100%}.referenceresults{grid-template-columns:1fr}.referencetabs{margin-inline:-2px}.referencetab{flex-basis:160px}.referencecard summary{min-height:84px;padding:14px}.referencecardaction{font-size:12px}}
    `;
    document.head.appendChild(style);
  }

  function init(config={}){
    const screen=document.getElementById('referenceScreen');
    if(!screen||screen.dataset.referenceReady==='true')return;
    const input=document.getElementById('referenceSearch');
    const clear=document.getElementById('referenceClear');
    const filters=document.getElementById('referenceFilters');
    const results=document.getElementById('referenceResults');
    const status=document.getElementById('referenceStatus');
    const controls=screen.querySelector('.referencecontrols');
    const assistantPanel=screen.querySelector('.assistantpanel');
    if(!input||!filters||!results||!status||!controls)return;
    injectStyles();

    const localBadge=assistantPanel?.querySelector('.localbadge');
    if(localBadge)localBadge.textContent='Ответы по материалам курса';

    const entries=buildReferenceEntries(config);
    const tabs=document.createElement('div');
    tabs.className='referencetabs';
    tabs.setAttribute('role','tablist');
    tabs.setAttribute('aria-label','Разделы справочника');

    const panels={};
    const hosts={};
    const tabConfig=[
      ['search','Найти материал'],
      ['terms','Словарь терминов'],
      ['assistant','Спросить помощника']
    ];
    tabConfig.forEach(([id,label])=>{
      const button=document.createElement('button');
      button.type='button';
      button.id=`referenceTab-${id}`;
      button.className='referencetab';
      button.dataset.referenceTab=id;
      button.setAttribute('role','tab');
      button.setAttribute('aria-controls',`referencePanel-${id}`);
      button.setAttribute('aria-selected',String(id==='search'));
      button.tabIndex=id==='search'?0:-1;
      button.textContent=label;
      tabs.appendChild(button);

      const panel=document.createElement('div');
      panel.id=`referencePanel-${id}`;
      panel.className='referencetabpanel';
      panel.setAttribute('role','tabpanel');
      panel.setAttribute('aria-labelledby',button.id);
      panel.hidden=id!=='search';
      panels[id]=panel;
      if(id!=='assistant'){
        const host=document.createElement('div');
        host.className='referencebrowsehost';
        panel.appendChild(host);
        hosts[id]=host;
      }
    });

    const anchor=assistantPanel||controls;
    screen.insertBefore(tabs,anchor);
    tabConfig.forEach(([id])=>screen.insertBefore(panels[id],anchor));

    const browse=document.createElement('div');
    browse.className='referencebrowse';
    const more=document.createElement('button');
    more.type='button';
    more.className='referencemore hidden';
    more.textContent='Показать ещё';
    browse.append(controls,status,results,more);
    hosts.search.appendChild(browse);
    if(assistantPanel)panels.assistant.appendChild(assistantPanel);

    filters.replaceChildren();
    Object.entries(CATEGORY_LABELS).forEach(([id,label])=>{
      const button=document.createElement('button');
      button.type='button';
      button.dataset.referenceCategory=id;
      button.textContent=label;
      button.classList.toggle('active',id==='all');
      button.setAttribute('aria-pressed',String(id==='all'));
      filters.appendChild(button);
    });

    const filterHint=controls.querySelector('.referencefilterhint');
    const searchState={query:'',category:'all'};
    const termState={query:''};
    let activeTab='search';
    let visibleCount=PAGE_SIZE;

    const effectiveCategory=()=>activeTab==='terms'?'terms':searchState.category;

    function matches(entry,query,tokens,category=effectiveCategory()){
      if(category!=='all'&&entry.category!==category)return false;
      if(!query)return true;
      return entry.searchText.includes(query)||tokens.every(token=>entry.searchText.includes(token));
    }

    function score(entry,query,tokens){
      if(!query)return 0;
      const title=normalize(entry.title);
      let value=title===query?100:title.startsWith(query)?60:title.includes(query)?35:0;
      tokens.forEach(token=>{if(title.includes(token))value+=10;if(entry.searchText.includes(token))value+=2});
      return value;
    }

    function popularEntries(candidates,termsOnly=false){
      const hints=(termsOnly?POPULAR_TERM_HINTS:POPULAR_HINTS).map(normalize);
      const selected=[];
      const used=new Set();
      const add=entry=>{
        if(!entry||used.has(entry.id))return;
        used.add(entry.id);
        selected.push(entry);
      };
      hints.forEach(hint=>{
        const found=candidates.find(entry=>!used.has(entry.id)&&(normalize(entry.title).includes(hint)||entry.searchText.includes(hint)));
        add(found);
      });
      const categories=['muscles','bones','movements','palpation','safety','terms'];
      categories.forEach(category=>add(candidates.find(entry=>entry.category===category&&!used.has(entry.id))));
      [...candidates].sort((a,b)=>a.title.localeCompare(b.title,'ru')).forEach(entry=>{
        if(selected.length<PAGE_SIZE)add(entry);
      });
      return selected.slice(0,PAGE_SIZE);
    }

    function syncFilterButtons(){
      filters.querySelectorAll('[data-reference-category]').forEach(button=>{
        const active=button.dataset.referenceCategory===effectiveCategory();
        button.classList.toggle('active',active);
        button.setAttribute('aria-pressed',String(active));
      });
    }

    function appendCard(entry){
      const card=document.createElement('details');
      card.className='referencecard';
      const summary=document.createElement('summary');
      const title=document.createElement('strong');
      const subtitle=document.createElement('small');
      const action=document.createElement('span');
      action.className='referencecardaction';
      action.textContent='Открыть ›';
      title.textContent=entry.title;
      subtitle.textContent=entry.subtitle||CATEGORY_LABELS[entry.category];
      summary.append(title,subtitle,action);
      const body=document.createElement('div');
      body.className='referencebody';
      const badge=document.createElement('span');
      badge.className='referencecategory';
      badge.textContent=CATEGORY_LABELS[entry.category];
      body.appendChild(badge);
      if(entry.lead){const lead=document.createElement('p');lead.textContent=entry.lead;body.appendChild(lead)}
      if(entry.sections.length){
        const list=document.createElement('dl');
        entry.sections.forEach(section=>{
          const term=document.createElement('dt');
          const description=document.createElement('dd');
          term.textContent=section.label;
          description.textContent=section.text;
          list.append(term,description);
        });
        body.appendChild(list);
      }
      const ask=document.createElement('button');
      ask.type='button';
      ask.className='btn secondary referenceask';
      ask.dataset.assistantQuery=`Объясни простыми словами: ${entry.title}`;
      ask.textContent='Объяснить с помощником';
      body.appendChild(ask);
      card.addEventListener('toggle',()=>{action.textContent=card.open?'Свернуть':'Открыть ›'});
      card.append(summary,body);
      results.appendChild(card);
    }

    function render(){
      if(activeTab==='assistant')return;
      const query=normalize(input.value);
      const tokens=query.split(' ').filter(token=>token.length>1);
      const category=effectiveCategory();
      const matchesCategory=entries.filter(entry=>matches(entry,'',[],category));
      const filtered=query
        ?matchesCategory.filter(entry=>matches(entry,query,tokens,category)).sort((a,b)=>score(b,query,tokens)-score(a,query,tokens)||a.title.localeCompare(b.title,'ru'))
        :popularEntries(matchesCategory,activeTab==='terms');
      results.replaceChildren();
      const shown=filtered.slice(0,visibleCount);
      shown.forEach(appendCard);
      if(!shown.length){
        const empty=document.createElement('div');
        empty.className='referenceempty';
        empty.textContent=activeTab==='terms'
          ?'Термин не найден. Попробуй другое написание или более короткое слово.'
          :'Ничего не найдено. Попробуй название мышцы, кости, движения или более простое слово.';
        results.appendChild(empty);
      }
      if(query){
        status.textContent=`Найдено: ${filtered.length}${filtered.length>shown.length?` · показано ${shown.length}`:''}`;
      }else if(activeTab==='terms'){
        status.textContent='Популярные термины';
      }else if(category==='all'){
        status.textContent='Популярные темы';
      }else{
        status.textContent=`Популярное в разделе «${CATEGORY_LABELS[category]}»`;
      }
      const remaining=Math.max(0,filtered.length-shown.length);
      more.classList.toggle('hidden',remaining===0);
      more.textContent=remaining?`Показать ещё · ${remaining}`:'Показать ещё';
      clear?.classList.toggle('hidden',!input.value);
    }

    function saveCurrentQuery(){
      if(activeTab==='search')searchState.query=input.value;
      if(activeTab==='terms')termState.query=input.value;
    }

    function activateTab(next,{focus=false}={}){
      if(!panels[next])return;
      if(next!==activeTab)saveCurrentQuery();
      activeTab=next;
      tabs.querySelectorAll('[data-reference-tab]').forEach(button=>{
        const active=button.dataset.referenceTab===next;
        button.setAttribute('aria-selected',String(active));
        button.tabIndex=active?0:-1;
      });
      Object.entries(panels).forEach(([id,panel])=>{panel.hidden=id!==next});
      if(next==='assistant'){
        if(focus)requestAnimationFrame(()=>assistantPanel?.querySelector('#assistantQuery')?.focus());
        return;
      }
      hosts[next].appendChild(browse);
      const termsMode=next==='terms';
      filters.hidden=termsMode;
      if(filterHint)filterHint.hidden=termsMode;
      input.placeholder=termsMode?'Введите термин, например «пальпация»':'Например: лопатка, отведение плеча, седалищный нерв';
      input.value=termsMode?termState.query:searchState.query;
      visibleCount=PAGE_SIZE;
      syncFilterButtons();
      render();
      if(focus)requestAnimationFrame(()=>input.focus());
    }

    tabs.addEventListener('click',event=>{
      const button=event.target.closest('[data-reference-tab]');
      if(button)activateTab(button.dataset.referenceTab,{focus:false});
    });
    tabs.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const buttons=[...tabs.querySelectorAll('[data-reference-tab]')];
      const current=Math.max(0,buttons.indexOf(document.activeElement));
      const nextIndex=event.key==='Home'?0:event.key==='End'?buttons.length-1:event.key==='ArrowRight'?(current+1)%buttons.length:(current-1+buttons.length)%buttons.length;
      event.preventDefault();
      buttons[nextIndex].focus();
      activateTab(buttons[nextIndex].dataset.referenceTab);
    });
    input.addEventListener('input',()=>{
      if(activeTab==='terms')termState.query=input.value;
      else searchState.query=input.value;
      visibleCount=PAGE_SIZE;
      render();
    });
    clear?.addEventListener('click',()=>{
      input.value='';
      if(activeTab==='terms')termState.query='';
      else searchState.query='';
      visibleCount=PAGE_SIZE;
      render();
      input.focus();
    });
    filters.addEventListener('click',event=>{
      const button=event.target.closest('[data-reference-category]');
      if(!button||activeTab==='terms')return;
      searchState.category=button.dataset.referenceCategory;
      visibleCount=PAGE_SIZE;
      syncFilterButtons();
      render();
    });
    more.addEventListener('click',()=>{
      visibleCount+=PAGE_SIZE;
      render();
      more.focus();
    });
    results.addEventListener('click',event=>{
      const ask=event.target.closest('[data-assistant-query]');
      if(!ask)return;
      const assistantInput=assistantPanel?.querySelector('#assistantQuery');
      if(assistantInput)assistantInput.value=ask.dataset.assistantQuery||'';
      activateTab('assistant',{focus:true});
    });
    assistantPanel?.addEventListener('focusin',()=>{
      if(activeTab!=='assistant')activateTab('assistant');
    });

    screen.dataset.referenceReady='true';
    activateTab('search');

    window.AnatomyReference={
      entries,
      open(query=''){
        searchState.query=String(query||'');
        searchState.category='all';
        if(activeTab==='search'){
          input.value=searchState.query;
          visibleCount=PAGE_SIZE;
          syncFilterButtons();
          render();
        }else{
          activateTab('search');
        }
        requestAnimationFrame(()=>input.focus());
      },
      search(query=''){
        const normalized=normalize(query);
        const tokens=normalized.split(' ').filter(token=>token.length>1);
        const category=activeTab==='terms'?'terms':searchState.category;
        return entries.filter(entry=>matches(entry,normalized,tokens,category)).sort((a,b)=>score(b,normalized,tokens)-score(a,normalized,tokens));
      },
      showAssistant(query=''){
        const assistantInput=assistantPanel?.querySelector('#assistantQuery');
        if(assistantInput&&query)assistantInput.value=String(query);
        activateTab('assistant',{focus:true});
      }
    };
  }

  window.initAnatomyReference=init;
})();
