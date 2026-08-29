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

    return unique(entries,row=>`${row.category}|${row.title}|${row.lead}|${row.sections.map(section=>section.text).join('|')}`)
      .map(row=>({...row,searchText:normalize([row.title,row.subtitle,row.lead,row.keywords,...row.sections.flatMap(section=>[section.label,section.text])].join(' '))}));
  }

  function injectStyles(){
    if(document.getElementById('referenceStyles'))return;
    const style=document.createElement('style');
    style.id='referenceStyles';
    style.textContent=`
      .referencehead{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:22px}
      .referencehead h2{margin:5px 0 7px}.referencehead p{max-width:680px;margin:0;color:var(--muted);line-height:1.5}
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
      .referencecard summary{display:grid;grid-template-columns:1fr auto;gap:5px 10px;min-height:94px;padding:15px;cursor:pointer;list-style:none}
      .referencecard summary::-webkit-details-marker{display:none}.referencecard summary::after{content:'＋';grid-column:2;grid-row:1/3;align-self:center;color:var(--accent);font-size:22px}
      .referencecard[open] summary::after{content:'−'}.referencecard strong{font-size:17px;line-height:1.3}.referencecard small{color:var(--muted);line-height:1.35}
      .referencecategory{display:inline-flex;align-items:center;width:max-content;margin-bottom:8px;padding:4px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent) 13%,var(--surface2));color:var(--text);font-size:12px;font-weight:750}
      .referencebody{padding:0 15px 15px;border-top:1px solid var(--border);line-height:1.55}.referencebody>p{margin:13px 0}.referencebody dl{margin:0}.referencebody dt{margin-top:12px;color:var(--muted);font-size:13px;font-weight:750}.referencebody dd{margin:4px 0 0}
      .referenceempty{grid-column:1/-1;padding:36px 18px;border:1px dashed var(--border);border-radius:14px;text-align:center;color:var(--muted)}
      @media(max-width:700px){.referencehead{flex-direction:column}.referencehead .btn{width:100%}.referenceresults{grid-template-columns:1fr}}
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
    if(!input||!filters||!results||!status)return;
    injectStyles();
    const entries=buildReferenceEntries(config);
    let category='all';

    Object.entries(CATEGORY_LABELS).forEach(([id,label])=>{
      const button=document.createElement('button');
      button.type='button';
      button.dataset.referenceCategory=id;
      button.textContent=label;
      button.classList.toggle('active',id==='all');
      button.setAttribute('aria-pressed',String(id==='all'));
      filters.appendChild(button);
    });

    function matches(entry,query,tokens){
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

    function appendCard(entry){
      const card=document.createElement('details');
      card.className='referencecard';
      const summary=document.createElement('summary');
      const title=document.createElement('strong');
      const subtitle=document.createElement('small');
      title.textContent=entry.title;
      subtitle.textContent=entry.subtitle||CATEGORY_LABELS[entry.category];
      summary.append(title,subtitle);
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
      card.append(summary,body);
      results.appendChild(card);
    }

    function render(){
      const query=normalize(input.value);
      const tokens=query.split(' ').filter(token=>token.length>1);
      const filtered=entries.filter(entry=>matches(entry,query,tokens))
        .sort((a,b)=>score(b,query,tokens)-score(a,query,tokens)||a.title.localeCompare(b.title,'ru'));
      results.replaceChildren();
      const shown=filtered.slice(0,80);
      shown.forEach(appendCard);
      if(!shown.length){
        const empty=document.createElement('div');
        empty.className='referenceempty';
        empty.textContent='Ничего не найдено. Попробуй название мышцы, кости, движения или более простое слово.';
        results.appendChild(empty);
      }
      status.textContent=query||category!=='all'
        ?`Найдено: ${filtered.length}${filtered.length>shown.length?` · показаны первые ${shown.length}`:''}`
        :`В справочнике: ${entries.length} материалов`;
      clear?.classList.toggle('hidden',!input.value);
    }

    input.addEventListener('input',render);
    clear?.addEventListener('click',()=>{input.value='';render();input.focus()});
    filters.addEventListener('click',event=>{
      const button=event.target.closest('[data-reference-category]');
      if(!button)return;
      category=button.dataset.referenceCategory;
      filters.querySelectorAll('button').forEach(item=>{
        const active=item===button;
        item.classList.toggle('active',active);
        item.setAttribute('aria-pressed',String(active));
      });
      render();
    });
    screen.dataset.referenceReady='true';
    render();

    window.AnatomyReference={
      entries,
      open(query=''){
        input.value=query;
        render();
        requestAnimationFrame(()=>input.focus());
      },
      search(query=''){
        const normalized=normalize(query);
        const tokens=normalized.split(' ').filter(token=>token.length>1);
        return entries.filter(entry=>matches(entry,normalized,tokens)).sort((a,b)=>score(b,normalized,tokens)-score(a,normalized,tokens));
      }
    };
  }

  window.initAnatomyReference=init;
})();
