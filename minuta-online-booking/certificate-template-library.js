(function () {
  'use strict';
  // Three independent compositions. Originals are drawn locally only after selection.
  const items=Object.freeze([
    Object.freeze({id:'original-atelier',name:'Ателье',orientation:'landscape',index:0}),
    Object.freeze({id:'original-outline',name:'Контур',orientation:'portrait',index:1}),
    Object.freeze({id:'original-panorama',name:'Панорама',orientation:'landscape',index:2})
  ]);
  function find(id){const item=items.find(value=>value.id===id);if(!item)throw new Error('unknown_certificate_design');return item;}
  function layoutFor(item){
    if(item.id==='original-atelier')return {
      procedure:{x:.5,y:.571,width:.80,size:.045,italic:false},
      date:{x:.265,y:.858,width:.35,size:.035,italic:false},
      number:{x:.757,y:.858,width:.32,size:.035,italic:false}
    };
    if(item.id==='original-outline')return {
      procedure:{x:.5,y:.649,width:.82,size:.034,italic:false},
      date:{x:.285,y:.837,width:.35,size:.027,italic:false},
      number:{x:.75,y:.837,width:.30,size:.027,italic:false}
    };
    return {
      procedure:{x:.665,y:.493,width:.51,size:.045,italic:false},
      date:{x:.54,y:.800,width:.24,size:.030,italic:false},
      number:{x:.827,y:.800,width:.20,size:.030,italic:false}
    };
  }
  function draw(canvas,item,width){
    const portrait=item.orientation==='portrait',height=Math.round(width*(portrait?3508/2480:2480/3508));canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');ctx.lineWidth=height*.0012;
    const rect=(x,y,w,h,color)=>{ctx.fillStyle=color;ctx.fillRect(x*width,y*height,w*width,h*height)};
    const line=(x,y,X,Y,color)=>{ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(x*width,y*height);ctx.lineTo(X*width,Y*height);ctx.stroke()};
    const text=(value,x,y,size,color,font='Arial',weight='400',maxWidth=1)=>{
      ctx.fillStyle=color;let px=size*height;ctx.font=`${weight} ${px}px ${font}`;
      while(ctx.measureText(value).width>maxWidth*width&&px>8){px-=1;ctx.font=`${weight} ${px}px ${font}`}
      ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(value,x*width,y*height);
    };
    const tracked=(value,x,y,size,color,spacing=.002)=>{
      ctx.fillStyle=color;ctx.font=`${size*height}px Arial`;ctx.textAlign='left';ctx.textBaseline='alphabetic';let left=x*width;
      for(const letter of value){ctx.fillText(letter,left,y*height);left+=ctx.measureText(letter).width+spacing*width;}
    };
    const arc=(x,y,r,start,end,color)=>{ctx.strokeStyle=color;ctx.beginPath();ctx.arc(x*width,y*height,r*width,start,end);ctx.stroke()};
    if(item.id==='original-atelier'){
      rect(0,0,1,1,'#f4eee4');rect(.029,.058,.012,.881,'#a25b45');
      tracked('ПОДАРОЧНЫЙ',.083,.125,.019,'#8b4d39',.003);
      text('Сертификат',.079,.321,.112,'#302c27','Georgia','400',.76);
      line(.083,.385,.927,.385,'#b8a99a');
      arc(.862,.179,.045,Math.PI*.08,Math.PI*1.78,'#a25b45');arc(.890,.179,.024,Math.PI*.08,Math.PI*1.78,'#a25b45');
      tracked('УСЛУГА',.086,.455,.014,'#635246');rect(.079,.483,.849,.148,'#fffbf6');
      line(.083,.713,.927,.713,'#b8a99a');
      tracked('ДАТА ВЫДАЧИ',.092,.787,.014,'#635246');tracked('НОМЕР',.596,.787,.014,'#635246');
      line(.515,.759,.515,.892,'#b8a99a');
    }else if(item.id==='original-outline'){
      rect(0,0,1,1,'#f7f7f2');rect(0,0,1,.475,'#202824');
      tracked('ПОДАРОЧНЫЙ',.081,.091,.014,'#d5e1cf',.004);
      text('СЕРТИ',.072,.244,.101,'#f7f7f2','Arial','600',.85);
      text('ФИКАТ',.072,.358,.101,'#f7f7f2','Arial','600',.85);
      ctx.lineWidth=height*.0016;arc(.896,.436,.09,Math.PI*.90,Math.PI*1.91,'#c3d4b7');
      rect(.079,.424,.12,.005,'#c3d4b7');
      tracked('СОДЕРЖАНИЕ',.089,.555,.012,'#465348',.002);
      line(.081,.715,.919,.715,'#8f9f90');
      tracked('ДАТА ВЫДАЧИ',.113,.785,.011,'#465348',.0013);tracked('НОМЕР',.601,.785,.011,'#465348',.0013);
      rect(.081,.918,.025,.018,'#aabc9e');rect(.119,.918,.025,.018,'#202824');
    }else{
      rect(0,0,1,1,'#fcfcf9');rect(0,0,.343,1,'#2e4c96');
      tracked('ПОДАРОЧНЫЙ',.045,.078,.014,'#ffffff',.0015);
      ctx.save();ctx.translate(.193*width,.915*height);ctx.rotate(-Math.PI/2);ctx.fillStyle='#ffffff';ctx.font=`500 ${height*.089}px Arial`;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText('СЕРТИФИКАТ',0,0);ctx.restore();
      arc(.337,.205,.070,Math.PI*.5,Math.PI*1.5,'#b8c7eb');
      tracked('ВЫБРАННАЯ УСЛУГА',.415,.326,.015,'#2e4c96',.0015);
      line(.411,.621,.93,.621,'#8197c1');
      tracked('ДАТА ВЫДАЧИ',.424,.729,.013,'#45516b',.001);tracked('НОМЕР',.729,.729,.013,'#45516b',.001);
      for(let n=0;n<3;n++)rect(.898+n*.014,.886,.004,.044,'#2e4c96');
    }
    return canvas;
  }
  function thumbnail(id){return draw(document.createElement('canvas'),find(id),480).toDataURL('image/png');}
  function create(id){const item=find(id),canvas=draw(document.createElement('canvas'),item,item.orientation==='portrait'?2480:3508);return{id:crypto.randomUUID(),name:item.name,image_data:canvas.toDataURL('image/png'),layout:layoutFor(item),font_files:{}};}
  window.MinutaCertificateTemplateLibrary=Object.freeze({items,create,thumbnail});
})();
