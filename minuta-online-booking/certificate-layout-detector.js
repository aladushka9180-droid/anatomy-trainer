(function (scope) {
  'use strict';
  const scriptURL = typeof document !== 'undefined' ? document.currentScript?.src : null;
  const assets = scriptURL ? new URL('vendor/certificate-ocr/', scriptURL).href : null;
  let runtime;
  function loadRuntime() {
    if (scope.Tesseract) return Promise.resolve(scope.Tesseract);
    if (!runtime) runtime = new Promise((resolve, reject) => {
      if (!assets || location.protocol === 'file:') { reject(new Error('recognition_unavailable')); return; }
      const script = document.createElement('script'); script.src = assets + 'tesseract.min.js';
      script.onload = () => scope.Tesseract ? resolve(scope.Tesseract) : reject(new Error('recognition_unavailable'));
      script.onerror = () => { script.remove(); reject(new Error('recognition_unavailable')); };
      document.head.append(script);
    }).catch(reason => { runtime = null; throw reason; });
    return runtime;
  }
  function horizontalLines(data, width, height) {
    const ink = (x,y) => {
      const i = (y * width + x) * 4;
      return data[i+3] > 180 && data[i]*.299 + data[i+1]*.587 + data[i+2]*.114 < 145;
    };
    const rows = [], minimum = Math.max(30, Math.round(width * .12));
    for (let y=0; y<height; y++) {
      let start=-1, last=-1;
      for (let x=0; x<=width+2; x++) {
        if (x<width && ink(x,y)) { if(start<0)start=x;last=x; }
        else if(start>=0 && x-last>2) {
          if(last-start>=minimum && start>width*.025 && last<width*.975)rows.push({x0:start,x1:last,y0:y,y1:y});
          start=-1;
        }
      }
    }
    const groups=[];
    for(const row of rows){
      const previous=groups.findLast(line=>row.y0-line.y1<=2&&Math.abs(line.x0-row.x0)<4&&Math.abs(line.x1-row.x1)<4);
      if(previous)previous.y1=row.y1;else groups.push({...row});
    }
    return groups.filter(line=>line.y1-line.y0<=Math.max(4,height*.007));
  }
  function labelKind(value) {
    const text = String(value).toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
    if (/дата\s*(выдач|выпуск)|выдан|issue[d]?\s*date|date\s*issued/.test(text)) return 'date';
    if (/номер|certificate\s*(no|number)|^(№|n[oº°]?\.?|n[23])$/.test(text)) return 'number';
    if (/процедур|услуг|вид\s*массаж|название\s*массаж|подарен|treatment|service/.test(text)) return 'procedure';
    return null;
  }
  function suggest(data, width, height, labels) {
    const lines=horizontalLines(data,width,height), proposals={};
    for(const key of ['procedure','date','number']){
      const anchors=labels.filter(label=>labelKind(label.text)===key && label.confidence>=35);
      const candidates=[];
      for(const anchor of anchors)for(const line of lines){
        const center=(anchor.bbox.x0+anchor.bbox.x1)/2, delta=(line.y0-(anchor.bbox.y0+anchor.bbox.y1)/2)/height;
        if(Math.abs(delta)>.12 || center<line.x0-width*.02 || center>line.x1+width*.02)continue;
        const distance=Math.abs(delta)+Math.abs(center-(line.x0+line.x1)/2)/width*.25;
        candidates.push({line,distance});
      }
      candidates.sort((a,b)=>a.distance-b.distance);
      if(!candidates.length)continue;
      // Two equally plausible places remain a manual choice.
      if(candidates[1] && candidates[1].line!==candidates[0].line && candidates[1].distance-candidates[0].distance<.01)continue;
      const line=candidates[0].line, size=key==='procedure'?.0315:.023;
      const field={x:(line.x0+line.x1)/2/width,y:(line.y0-Math.max(3,height*.002))/height,width:(line.x1-line.x0)/width*.94,size,italic:key==='procedure'};
      const top=Math.max(0,Math.floor(field.y*height-size*height*1.25));
      let dark=0,total=0;
      // Filled-in certificates and busy backgrounds must not be treated as blank templates.
      for(let y=top;y<Math.floor(field.y*height)-2;y+=2)for(let x=Math.round(line.x0+5);x<line.x1-5;x+=2){
        const i=(y*width+x)*4;total++;if(data[i+3]>180 && (data[i]+data[i+1]+data[i+2])/3<145)dark++;
      }
      if(total && dark/total<.025 && field.x>.03 && field.x<.97 && field.y>.03 && field.y<.97)proposals[key]=field;
    }
    // A line may never serve two different fields.
    const keys=Object.keys(proposals);
    for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){
      const a=proposals[keys[i]],b=proposals[keys[j]];
      if(a&&b&&Math.abs(a.y-b.y)<.01 && Math.abs(a.x-b.x)<.03){delete proposals[keys[i]];delete proposals[keys[j]];}
    }
    return proposals;
  }
  function tsvLabels(tsv) {
    const rows=String(tsv||'').trim().split('\n').slice(1).map(row=>row.split('\t')), groups=new Map();
    for(const row of rows){
      if(row[0]!=='5'||!row[11]?.trim())continue;
      const [x,y,w,h]=row.slice(6,10).map(Number),confidence=Number(row[10]);if(![x,y,w,h,confidence].every(Number.isFinite))continue;
      const word={text:row[11],confidence,bbox:{x0:x,y0:y,x1:x+w,y1:y+h}};
      const key=row.slice(1,5).join('-');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(word);
    }
    const labels=[];
    for(const words of groups.values()){
      labels.push(...words);
      if(words.length>1)labels.push({text:words.map(w=>w.text).join(' '),confidence:words.reduce((n,w)=>n+w.confidence,0)/words.length,
        bbox:{x0:Math.min(...words.map(w=>w.bbox.x0)),y0:Math.min(...words.map(w=>w.bbox.y0)),x1:Math.max(...words.map(w=>w.bbox.x1)),y1:Math.max(...words.map(w=>w.bbox.y1))}});
    }
    return labels;
  }
  function createJob(image, onProgress=()=>{}) {
    let stopped=false,worker=null,rejectStop;
    const stop=new Promise((_,reject)=>{rejectStop=reject});
    function cancel(){if(stopped)return;stopped=true;rejectStop(new Error('recognition_cancelled'));worker?.terminate().catch(()=>{});}
    const task=(async()=>{
      const canvas=document.createElement('canvas'), scale=Math.min(1,1800/Math.max(image.width,image.height));
      canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
      const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const T=await loadRuntime();if(stopped)throw new Error('recognition_cancelled');
      worker=await T.createWorker(['rus','eng'],1,{workerPath:assets+'worker.min.js',corePath:assets,langPath:assets.slice(0,-1),workerBlobURL:false,cacheMethod:'none',
        logger:()=>{if(!stopped)onProgress()},errorHandler:()=>{}});
      if(stopped){await worker.terminate();throw new Error('recognition_cancelled');}
      try{
        await worker.setParameters({tessedit_pageseg_mode:T.PSM.SPARSE_TEXT,user_defined_dpi:'200'});
        const {data}=await worker.recognize(canvas,{}, {text:false,tsv:true});
        if(stopped)throw new Error('recognition_cancelled');
        return suggest(pixels,canvas.width,canvas.height,tsvLabels(data.tsv));
      }finally{await worker.terminate();worker=null;}
    })();
    const timer=setTimeout(cancel,60000);
    return {cancel,promise:Promise.race([task,stop]).finally(()=>clearTimeout(timer))};
  }
  const api={createJob,suggest,horizontalLines,labelKind,tsvLabels};scope.MinutaCertificateLayoutDetector=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
