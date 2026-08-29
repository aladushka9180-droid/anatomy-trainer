const HumanAudio=(()=>{
const DB_NAME='anatomy-human-audio-v1',STORE='clips';
let dbPromise=null,recorder=null,stream=null,chunks=[],recordMeta=null,stopResolve=null,currentAudio=null,currentUrl='';
function open(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'})};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});return dbPromise}
async function tx(mode,action){const db=await open();return new Promise((resolve,reject)=>{const transaction=db.transaction(STORE,mode),store=transaction.objectStore(STORE),request=action(store);if(request){request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)}else{transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error)}})}
function hash(text){let h=2166136261;for(const ch of String(text||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)}return (h>>>0).toString(36)}
function makeKey(qkey,language,part,text){return `${qkey}:${language}:${part}:${hash(text)}`}
function get(key){return tx('readonly',s=>s.get(key))}
function put(value){return tx('readwrite',s=>s.put(value))}
function remove(key){return tx('readwrite',s=>s.delete(key))}
function count(){return tx('readonly',s=>s.count())}
function all(){return tx('readonly',s=>s.getAll())}
function supported(){return !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder&&window.indexedDB)}
function mime(){if(!window.MediaRecorder)return '';return ['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(x=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(x))||''}
async function start(key,meta={}){if(!supported())throw new Error('recording-unsupported');if(recorder)throw new Error('recording-active');stopPlayback();stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});chunks=[];recordMeta={key,...meta,createdAt:new Date().toISOString()};const type=mime();recorder=type?new MediaRecorder(stream,{mimeType:type}):new MediaRecorder(stream);recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data)};recorder.start(250);return true}
function stop(){if(!recorder)return Promise.resolve(null);return new Promise(resolve=>{stopResolve=resolve;const active=recorder;active.onstop=async()=>{const blob=new Blob(chunks,{type:active.mimeType||chunks[0]?.type||'audio/webm'}),saved={...recordMeta,blob,mimeType:blob.type,size:blob.size};try{await put(saved);resolve(saved)}catch(e){resolve(null)}finally{stream?.getTracks().forEach(t=>t.stop());recorder=null;stream=null;chunks=[];recordMeta=null;stopResolve=null}};active.stop()})}
function isRecording(){return !!recorder}
function stopPlayback(){if(currentAudio){currentAudio.pause();currentAudio.src='';currentAudio=null}if(currentUrl){URL.revokeObjectURL(currentUrl);currentUrl=''}}
async function play(key,onEnd){stopPlayback();const item=await get(key);if(!item||!item.blob)return false;currentUrl=URL.createObjectURL(item.blob);currentAudio=new Audio(currentUrl);currentAudio.onended=()=>{stopPlayback();if(onEnd)onEnd()};currentAudio.onerror=()=>{stopPlayback();if(onEnd)onEnd()};await currentAudio.play();return true}
function toDataUrl(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})}
function fromDataUrl(data){const [head,body]=data.split(','),type=(head.match(/data:([^;]+)/)||[])[1]||'audio/webm',bytes=atob(body),arr=new Uint8Array(bytes.length);for(let i=0;i<bytes.length;i++)arr[i]=bytes.charCodeAt(i);return new Blob([arr],{type})}
async function exportPack(){const items=await all(),packed=[];for(const item of items)packed.push({...item,blob:await toDataUrl(item.blob)});const file=new Blob([JSON.stringify({version:1,createdAt:new Date().toISOString(),clips:packed})],{type:'application/json'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='anatomy-human-voice-pack.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return items.length}
async function importPack(file){const data=JSON.parse(await file.text());if(!data||data.version!==1||!Array.isArray(data.clips))throw new Error('invalid-pack');let imported=0;for(const item of data.clips){if(!item.key||typeof item.blob!=='string')continue;await put({...item,blob:fromDataUrl(item.blob)});imported++}return imported}
return {supported,hash,makeKey,get,remove,count,start,stop,isRecording,play,stopPlayback,exportPack,importPack};
})();
