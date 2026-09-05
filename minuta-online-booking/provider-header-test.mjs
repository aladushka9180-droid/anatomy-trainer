import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('provider.js',import.meta.url),'utf8');
const functions=source.slice(source.indexOf('function compactSyncLabel('),source.indexOf('async function manualSynchronizeProvider('));
const label={}, attributes={}, events=[];
const element={querySelector:()=>label,setAttribute:(key,value)=>attributes[key]=value};
let availability=0;
const context=vm.createContext({$:()=>element,pendingBookingColors:new Set(),pendingBookingNotes:new Set(),pendingClientLabels:new Set(),pendingClientNotes:new Map(),renderProviderVerification(){},recordConnectionEvent:(...args)=>events.push(args),applyWriteAvailability:()=>availability++});
vm.runInContext(functions,context);
const examples=[
  ['online','Синхронизировано · 14:58','Синхронизировано'],
  ['online','Онлайн · данные обновляются','Онлайн'],
  ['checking','Синхронизация…','Обновляем данные…'],
  ['offline','Офлайн · данные на 14:00 · новую запись можно отложить','Нет интернета'],
  ['warning','Есть несохранённое расписание · серверная сверка приостановлена','Не всё сохранено'],
  ['warning','Связь нестабильна · только чтение','Только просмотр'],
  ['warning','Основные данные синхронизированы · дополнительные данные сохранены на этом устройстве','Обновлено частично'],
  ['warning','Не удалось обновить данные · повторите позже','Проверить связь'],
];
for(const [kind,full,compact] of examples){
  context.setSyncState(kind,full);
  assert.equal(label.textContent,compact);
  assert.equal(element.className,`sync-state is-${kind}`);
  assert.ok(element.title.startsWith(full)); assert.ok(attributes['aria-label'].startsWith(full));
  assert.equal(events.at(-1)[1],full);
}
assert.equal(availability,examples.length,'write-safety state must still be refreshed');
console.log('Provider header: 8 status states preserve details, accessibility and write safety.');
