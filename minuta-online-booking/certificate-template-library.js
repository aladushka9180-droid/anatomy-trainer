(function () {
  'use strict';
  // Vector originals are rasterized only when chosen. No fonts, images or remote assets are fetched.
  const definitions = [
    ['Тихий свет','#ffffff','#40484a','sans'], ['Тонкая рамка','#faf9f6','#776d5b','serif'],
    ['Шалфей','#f6f8f3','#687c66','sans'], ['Песочная арка','#faf6ef','#a38663','serif'],
    ['Нежная линия','#fff7f7','#ac7e83','serif'], ['Графит','#fafafa','#383838','sans'],
    ['Оливковая ветвь','#fafbf6','#78855d','serif'], ['Молочная геометрия','#fbf9f4','#9b8d76','sans'],
    ['Лавандовый штрих','#faf8fd','#8a7b9e','sans'], ['Воздух','#f5f9fb','#6c8a97','sans'],
    ['Бумага','#fcfaf5','#928572','serif'], ['Двойной контур','#fff','#7f8984','sans'],
    ['Солнце','#fffaf1','#ab8b52','serif'], ['Розовый кварц','#fdf8f9','#9c7d87','sans'],
    ['Типографика','#fff','#252525','sans'], ['Терракота','#fcf6f2','#af8069','serif'],
    ['Лунный круг','#f7f8fa','#7e879c','serif'], ['Лён','#f9f7f1','#8b8772','sans'],
    ['Ритм','#fff','#7c8a8a','sans'], ['Складка','#faf8f3','#9a8a70','serif'],
    ['Горизонт','#f8fafb','#68818c','sans'], ['Светлая галерея','#fff','#3e4843','serif'],
    ['Камень','#faf9f6','#8e8a7c','sans'], ['Зелёный акцент','#f7faf5','#728766','sans'],
    ['Тёплый вечер','#fcf7f2','#ab8c70','serif'], ['Лиловая пауза','#faf8fc','#9987a6','serif'],
    ['Пунктир','#fff','#768580','sans'], ['Контраст линий','#fafafa','#343a3c','sans'],
    ['Мягкие углы','#f9f8f4','#958b78','serif'], ['Баланс','#f5f9f8','#6f8b81','sans']
  ];
  const items = Object.freeze(definitions.map(([name,background,accent,type],index) => Object.freeze({id:`minimal-${String(index+1).padStart(2,'0')}`,name,background,accent,type,orientation:index<20?'portrait':'landscape',index})));
  function find(id) { const item=items.find(value=>value.id===id); if(!item)throw new Error('unknown_certificate_design'); return item; }
  function layoutFor(item) {
    const portrait=item.orientation==='portrait';
    return {
      procedure:{x:.5,y:portrait?.622:.60,width:.78,size:portrait?.027:.039,italic:item.type==='serif'},
      date:{x:.25,y:portrait?.805:.81,width:.30,size:portrait?.022:.032,italic:false},
      number:{x:.75,y:portrait?.805:.81,width:.30,size:portrait?.022:.032,italic:false}
    };
  }
  function draw(canvas,item,width) {
    const portrait=item.orientation==='portrait',height=Math.round(width*(portrait?3508/2480:2480/3508));
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.scale(width,height);ctx.fillStyle=item.background;ctx.fillRect(0,0,1,1);
    ctx.strokeStyle=item.accent;ctx.fillStyle=item.accent;ctx.lineWidth=.0012;
    const line=(x,y,X,Y)=>{ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(X,Y);ctx.stroke()};
    const rect=(x,y,w,h,fill=false)=>fill?ctx.fillRect(x,y,w,h):ctx.strokeRect(x,y,w,h);
    const ellipse=(x,y,rx,ry,fill=false,start=0,end=Math.PI*2)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,start,end);fill?ctx.fill():ctx.stroke()};
    const pale=(fn)=>{ctx.save();ctx.globalAlpha=.10;fn();ctx.restore()};
    switch(item.index) {
      case 0: line(.46,.145,.54,.145);line(.46,.915,.54,.915);break;
      case 1: rect(.055,.04,.89,.92);break;
      case 2: pale(()=>rect(0,0,1,.12,true));line(.12,.15,.33,.15);line(.67,.9,.88,.9);break;
      case 3: pale(()=>{ellipse(.5,.19,.25,.18,true);rect(.25,.19,.5,.20,true)});break;
      case 4: ctx.beginPath();ctx.moveTo(.1,.13);ctx.bezierCurveTo(.3,.08,.7,.22,.9,.13);ctx.stroke();line(.14,.92,.86,.92);break;
      case 5: rect(.06,.06,.09,.009,true);rect(.85,.925,.09,.009,true);line(.06,.075,.06,.29);break;
      case 6: line(.8,.12,.89,.31);for(let i=0;i<5;i++){ellipse(.802+i*.018,.15+i*.032,.019,.009);ellipse(.833+i*.018,.162+i*.032,.019,.009)}break;
      case 7: pale(()=>{rect(0,0,.15,.24,true);rect(.85,.87,.15,.13,true)});rect(.06,.065,.12,.08);break;
      case 8: line(.1,.07,.1,.4);line(.1,.07,.38,.07);pale(()=>ellipse(.9,.92,.15,.10,true));break;
      case 9: pale(()=>{ellipse(.1,.06,.36,.16,true);ellipse(.95,1,.35,.12,true)});break;
      case 10: rect(.075,.055,.85,.89);line(.1,.095,.9,.095);line(.1,.905,.9,.905);break;
      case 11: rect(.045,.035,.91,.93);rect(.062,.047,.876,.906);break;
      case 12: ellipse(.5,.155,.06,.042);for(let i=0;i<9;i++){const a=i*Math.PI/8;line(.5+Math.cos(a)*.079,.155-Math.sin(a)*.056,.5+Math.cos(a)*.095,.155-Math.sin(a)*.067)}break;
      case 13: pale(()=>{ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(.42,0);ctx.lineTo(0,.36);ctx.fill();});line(.78,.94,.93,.94);break;
      case 14: rect(.095,.09,.012,.10,true);line(.095,.92,.905,.92);break;
      case 15: pale(()=>ellipse(.98,.09,.23,.16,true));line(.10,.10,.32,.10);line(.76,.9,.9,.9);break;
      case 16: ellipse(.5,.15,.083,.058);ellipse(.54,.15,.083,.058);break;
      case 17: for(let i=0;i<4;i++){line(.08+i*.009,.06,.08+i*.009,.31);line(.88+i*.009,.75,.88+i*.009,.94)}break;
      case 18: for(let i=0;i<5;i++)line(.38+i*.06,.105,.38+i*.06,.17);line(.10,.93,.9,.93);break;
      case 19: pale(()=>{ctx.beginPath();ctx.moveTo(.72,0);ctx.lineTo(1,0);ctx.lineTo(1,.20);ctx.fill()});line(.72,0,1,.20);break;
      case 20: pale(()=>rect(0,0,1,.08,true));line(.08,.13,.92,.13);line(.08,.93,.92,.93);break;
      case 21: rect(.035,.05,.93,.9);line(.065,.12,.18,.12);line(.82,.88,.935,.88);break;
      case 22: pale(()=>{ellipse(.09,.15,.14,.20,true);ellipse(.93,.92,.14,.20,true)});break;
      case 23: rect(.045,.10,.009,.31,true);line(.045,.10,.20,.10);line(.80,.9,.955,.9);break;
      case 24: ellipse(.86,.19,.065,.092);line(.045,.94,.33,.94);break;
      case 25: pale(()=>rect(.04,.06,.92,.15,true));line(.09,.92,.91,.92);break;
      case 26: ctx.setLineDash([.004,.009]);rect(.04,.055,.92,.89);ctx.setLineDash([]);break;
      case 27: line(.07,.085,.93,.085);ctx.lineWidth=.006;line(.07,.92,.29,.92);ctx.lineWidth=.0012;break;
      case 28: ctx.beginPath();ctx.roundRect(.04,.055,.92,.89,[.045]);ctx.stroke();pale(()=>ellipse(.085,.115,.045,.064,true));break;
      case 29: ellipse(.10,.19,.033,.047);rect(.84,.13,.06,.085);line(.07,.93,.93,.93);break;
    }
    const text=(value,x,y,size,font='Arial',align='center')=>{ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.fillStyle='#26312e';ctx.font=`${size*height}px ${font}`;ctx.textAlign=align;ctx.textBaseline='alphabetic';ctx.fillText(value,x*width,y*height);ctx.restore()};
    const font=item.type==='serif'?'Georgia':'Arial',titleSize=portrait?.06:.058;
    if(item.index===14){text('ПОДАРОЧНЫЙ',.12,.32,.049,'Arial','left');text('СЕРТИФИКАТ',.12,.388,.064,'Arial','left')}
    else if([2,8,15,23,27].includes(item.index)){text('Подарочный',.13,portrait?.30:.32,titleSize,font,'left');text('сертификат',.13,portrait?.375:.415,titleSize,font,'left')}
    else {text('Подарочный',.5,portrait?.31:.32,titleSize,font);text('сертификат',.5,portrait?.383:.415,titleSize,font)}
    text('ДЛЯ ТЕБЯ',.5,portrait?.46:.49,portrait?.014:.019,'Arial');
    const fields=layoutFor(item);
    text('ВАШ ПОДАРОК',.5,portrait?.555:.54,portrait?.012:.017,'Arial');
    ctx.strokeStyle=item.accent;ctx.globalAlpha=.55;
    for(const [key,f] of Object.entries(fields)){line(f.x-f.width/2,f.y+.011,f.x+f.width/2,f.y+.011);if(key!=='procedure')text(key==='date'?'ДАТА ВЫДАЧИ':'НОМЕР',f.x,f.y+(portrait?.040:.054),portrait?.011:.016,'Arial')}
    ctx.globalAlpha=1;
    return canvas;
  }
  function thumbnail(id) { return draw(document.createElement('canvas'),find(id),320).toDataURL('image/png'); }
  function create(id) {
    const item=find(id),canvas=draw(document.createElement('canvas'),item,item.orientation==='portrait'?2480:3508);
    return {id:crypto.randomUUID(),name:item.name,image_data:canvas.toDataURL('image/png'),layout:layoutFor(item),font_files:{}};
  }
  const api=Object.freeze({items,create,thumbnail});
  if(typeof window!=='undefined')window.MinutaCertificateTemplateLibrary=api;
})();
