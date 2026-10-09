/** Catalog rules: exact three-decimal quantities, integer money, no I/O. */
export const PURPOSES=Object.freeze({retail:'Для продажи',consumable:'Расходный материал',both:'Продажа и расход'});
export const ICONS=Object.freeze({box:'Товар',bottle:'Флакон',jar:'Баночка',tube:'Тюбик',spray:'Спрей',brush:'Щётка',scissors:'Ножницы',ball:'Мяч',roller:'Ролик',mat:'Коврик',drop:'Капля'});
export const UNITS=Object.freeze({piece:'шт.',ml:'мл',g:'г',kg:'кг',l:'л',pack:'упак.'});
export const MAX_QUANTITY=99999999999.999;
const sample=(name,category,icon,purpose='both')=>Object.freeze({name,category,icon,purpose,unit:'piece',sale_unit:'piece',stock_per_sale_unit:1,sale_price_minor:null,metadata_version:0,inventory_item_id:null});
export const PROFESSION_TEMPLATES=Object.freeze([
{id:'spa',name:'Массаж / СПА',items:[sample('Массажный крем','Кремы и гели','jar'),sample('Массажный гель','Кремы и гели','tube'),sample('Массажное масло','Масла','bottle'),sample('Крем для домашнего ухода','Домашний уход','tube','retail'),sample('Массажный мяч','Аксессуары','ball','retail'),sample('Массажный ролик','Аксессуары','roller','retail')]},
{id:'hair',name:'Волосы / барбер',items:[sample('Шампунь','Уход за волосами','bottle'),sample('Кондиционер','Уход за волосами','bottle'),sample('Маска для волос','Уход за волосами','jar'),sample('Средство для укладки','Стайлинг','spray'),sample('Масло для бороды','Уход за бородой','drop'),sample('Щётка для бороды','Аксессуары','brush','retail')]},
{id:'nails',name:'Ногти / педикюр',items:[sample('Масло для кутикулы','Уход','drop'),sample('Крем для рук','Уход','tube'),sample('Крем для стоп','Педикюр','tube'),sample('Пилка','Инструменты','box'),sample('База для покрытия','Покрытия','bottle','consumable'),sample('Гель для покрытия','Покрытия','jar','consumable')]},
{id:'skin',name:'Косметология',items:[sample('Очищающий гель','Очищение','tube'),sample('Тоник','Очищение','bottle'),sample('Сыворотка','Уход','drop'),sample('Крем для лица','Уход','jar'),sample('Солнцезащитный крем','Защита','tube'),sample('Маска для лица','Маски','jar')]},
{id:'brows',name:'Брови / ресницы',items:[sample('Гель для бровей','Уход','tube','retail'),sample('Щёточка для бровей','Аксессуары','brush'),sample('Средство для очищения ресниц','Очищение','bottle'),sample('Краска для бровей','Материалы','tube','consumable'),sample('Состав для ламинирования','Материалы','bottle','consumable')]},
{id:'fitness',name:'Фитнес / йога',items:[sample('Коврик для йоги','Аксессуары','mat','retail'),sample('Массажный ролик','Восстановление','roller','retail'),sample('Массажный мяч','Восстановление','ball','retail'),sample('Эластичная лента','Аксессуары','box','retail'),sample('Блок для йоги','Аксессуары','box','retail'),sample('Бутылка для воды','Аксессуары','bottle','retail')]}
].map(row=>Object.freeze({...row,items:Object.freeze(row.items)})));
export function decimal(value,precision=3,max=MAX_QUANTITY){
 const text=String(value??'').trim().replace(',','.');
 if(!new RegExp('^\\d+(?:\\.\\d{1,'+precision+'})?$').test(text))return null;
 const n=Number(text);return Number.isFinite(n)&&n<=max?n:null;
}
export function scaled(value){
 if(decimal(value)===null)return null;
 const [a,b='']=String(value).trim().replace(',','.').split('.');return BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));
}
export function quantityText(value){const q=typeof value==='bigint'?value:scaled(value);return q===null?'':String(q/1000n)+(q%1000n?'.'+String(q%1000n).padStart(3,'0').replace(/0+$/,''):'');}
export function moneyMinor(value){
 const amount=decimal(value,2,Number.MAX_SAFE_INTEGER/100);if(amount===null||amount<=0)return null;
 const [a,b='']=String(value).trim().replace(',','.').split('.');const n=BigInt(a)*100n+BigInt(b.padEnd(2,'0'));return n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):null;
}
export function safePhotoUrl(value){if(/\s/.test(String(value)))return null;try{const u=new URL(String(value));return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname?u.href:null;}catch{return null;}}
export function validConversion(unit,saleUnit,factor){
 const q=scaled(factor);if(q===null||q<=0n||!Object.hasOwn(UNITS,unit)||!Object.hasOwn(UNITS,saleUnit))return false;
 if(unit===saleUnit)return q===1000n;const fixed={'l:ml':1000000n,'ml:l':1n,'kg:g':1000000n,'g:kg':1n};
 if(Object.hasOwn(fixed,saleUnit+':'+unit))return q===fixed[saleUnit+':'+unit];return ['piece','pack'].includes(saleUnit);
}
export function itemStock(item,balances=[],warehouseId){
 const b=balances.find(row=>row.inventory_item_id===item.id&&row.warehouse_id===warehouseId),q=scaled(b?.quantity),f=scaled(item.stock_per_sale_unit);
 return q===null||f===null||f<=0n?null:['piece','pack'].includes(item.sale_unit)?Number(q/f):Number(q*1000n/f)/1000;
}
export function itemProblem(item,quantity,state){
 if(!item||item.active!==true)return 'Позиция архивная или недоступна';
 if(item.catalog_ready!==true)return 'Заполните карточку товара';
 if(!['retail','both'].includes(item.purpose))return 'Позиция предназначена только для расхода';
 if(!Number.isSafeInteger(item.sale_price_minor)||item.sale_price_minor<=0)return 'Цена не указана';
 if(!Number.isSafeInteger(item.metadata_version)||item.metadata_version<1)return 'Версия карточки не подтверждена';
 if(!state.warehouseId||!state.warehouses?.some(row=>row.id===state.warehouseId&&row.active!==false))return 'Выберите действующий склад';
 const q=scaled(quantity),f=scaled(item.stock_per_sale_unit);
 if(q===null||q<=0n)return 'Укажите количество больше нуля, до трёх знаков после запятой';
 if(['piece','pack'].includes(item.sale_unit)&&q%1000n)return 'Штуки и упаковки продаются целиком';
 if(!validConversion(item.unit,item.sale_unit,item.stock_per_sale_unit)||f===null||q*f%1000n)return 'Количество нельзя точно списать со склада';
 const stock=itemStock(item,state.balances,state.warehouseId);
 if(stock===null)return 'Остаток не подтверждён';if(q>scaled(stock))return 'Недостаточно остатка: доступно '+stock+' '+(UNITS[item.sale_unit]||'');return '';
}
export function addLines(lines,additions,newId=()=>crypto.randomUUID()){
 const result=lines.map(row=>({...row}));
 for(const row of additions){const q=scaled(row.quantity);if(typeof row.itemId!=='string'||!row.itemId||q===null||q<=0n)continue;
 const existing=result.find(x=>!x.bundleId&&x.itemId===row.itemId&&!(x.discountMinor>0));
 if(existing){const c=scaled(existing.quantity);existing.quantity=c===null?quantityText(q):quantityText(c+q);}
 else result.push({...row,lineId:row.lineId||newId(),quantity:quantityText(q),discountMinor:row.discountMinor||0});}return result;
}
export function bundleLine(bundle,newId=()=>crypto.randomUUID()){return {lineId:newId(),bundleId:bundle.id,bundleVersion:bundle.version,quantity:'1',components:bundle.items.map(row=>({itemId:row.inventory_item_id,quantity:quantityText(row.quantity)}))};}
export function detachBundle(line,newId=()=>crypto.randomUUID()){
 const q=scaled(line.quantity);return(line.components||[]).map(c=>{const n=scaled(c.quantity);return {lineId:newId(),itemId:c.itemId,quantity:q!==null&&n!==null&&q*n%1000n===0n?quantityText(q*n/1000n):'',discountMinor:0,sourceBundleId:line.bundleId};});
}
export function evaluateCart(lines,state){
 const demand=new Map(),seen=new Set(),expanded=[];
 const rows=lines.map(line=>{
 let problem='',children=[];const q=scaled(line.quantity);
 if(!line.lineId||seen.has(line.lineId))problem='Некорректный идентификатор строки';seen.add(line.lineId);
 if(line.bundleId){const b=state.bundles?.find(row=>row.id===line.bundleId&&row.active===true);
 if(!b||!Number.isSafeInteger(line.bundleVersion)||b.version!==line.bundleVersion||b.items.length!==line.components?.length||b.items.some((x,i)=>x.inventory_item_id!==line.components[i].itemId||scaled(x.quantity)!==scaled(line.components[i].quantity)))problem='Состав набора изменился. Добавьте его заново';
 if(q===null||q<=0n)problem='Укажите количество набора';
 for(const c of line.components||[]){const n=scaled(c.quantity);children.push({itemId:c.itemId,quantity:q!==null&&n!==null&&q*n%1000n===0n?quantityText(q*n/1000n):'',discountMinor:0});}
 }else children=[line];
 const evaluated=children.map(child=>{
 const item=state.items?.find(x=>x.id===child.itemId),quantity=scaled(child.quantity),factor=scaled(item?.stock_per_sale_unit);let subtotal=null;
 if(quantity!==null&&Number.isSafeInteger(item?.sale_price_minor)&&item.sale_price_minor>0){const amount=(quantity*BigInt(item.sale_price_minor)+500n)/1000n;if(amount<=BigInt(Number.MAX_SAFE_INTEGER))subtotal=Number(amount);}
 const discount=child.discountMinor??0;let error=itemProblem(item,child.quantity,state)||(subtotal===null?'Сумма превышает допустимый предел':'');
 if(!Number.isSafeInteger(discount)||discount<0||subtotal!==null&&discount>=subtotal)error='Скидка должна быть меньше суммы строки';
 if(quantity!==null&&factor!==null&&quantity*factor%1000n===0n)demand.set(child.itemId,(demand.get(child.itemId)||0n)+quantity*factor/1000n);
 const row={...child,item,problem:error,totalMinor:subtotal===null?null:subtotal-discount};expanded.push(row);return row;});
 return {...line,item:line.bundleId?null:evaluated[0]?.item,children:evaluated,totalMinor:evaluated.reduce((sum,x)=>sum+(x.totalMinor??0),0),problem:line.unitChanged?'Единицы изменились: уточните количество':problem||evaluated.find(x=>x.problem)?.problem||''};
 });
 for(const [id,q] of demand){const b=state.balances?.find(x=>x.inventory_item_id===id&&x.warehouse_id===state.warehouseId),available=scaled(b?.quantity);
 if(available!==null&&q>available)for(const row of rows)if(row.children.some(x=>x.itemId===id))row.problem='Общее количество в корзине превышает остаток';}
 const totalMinor=rows.reduce((sum,x)=>sum+x.totalMinor,0);
 return {rows,totalMinor,valid:rows.length>0&&rows.length<=50&&expanded.length<=100&&rows.every(x=>!x.problem)&&Number.isSafeInteger(totalMinor)&&totalMinor>0};
}
export function buildIntent(lines,state,requestId){
 if(!evaluateCart(lines,state).valid)throw new Error('invalid_catalog_cart');
 const snapshot=id=>{const x=state.items.find(x=>x.id===id);return {inventory_item_id:x.id,metadata_version:x.metadata_version,unit_price_minor:x.sale_price_minor};};
 return {p_organization:state.orgId,p_booking:state.bookingId||null,p_client_account:state.clientId||null,p_seller:state.sellerId||null,
 p_lines:lines.map(line=>line.bundleId?{line_id:line.lineId,bundle_id:line.bundleId,bundle_version:line.bundleVersion,warehouse_id:state.warehouseId,quantity:decimal(line.quantity),components:line.components.map(c=>snapshot(c.itemId))}
 :{line_id:line.lineId,...snapshot(line.itemId),warehouse_id:state.warehouseId,quantity:decimal(line.quantity),discount_minor:line.discountMinor||0}),
 p_payment_method:state.paymentMethod,p_payment_account:state.paymentAccountId,p_request_id:requestId};
}
export function repeatPurchase(purchase,state,newId=()=>crypto.randomUUID()){
 if(!state.clientId||purchase?.organization_id!==state.orgId||purchase?.client_account_id!==state.clientId||purchase.found!==true)return [];
 return (purchase.lines||[]).map(row=>{const item=state.items?.find(x=>x.id===row.inventory_item_id);
 const changed=Boolean(item&&(row.sale_unit!==item.sale_unit||row.base_unit!==item.unit||scaled(row.stock_per_sale_unit)!==scaled(item.stock_per_sale_unit)));
 return {lineId:newId(),itemId:row.inventory_item_id,quantity:changed?'':quantityText(row.sale_quantity),discountMinor:0,unitChanged:changed};});
}
export function filterItems(items,{search='',category='',purpose='',favoritesOnly=false}={}){
 const q=search.trim().toLocaleLowerCase('ru');return items.filter(x=>(!category||x.category===category)&&(!purpose||x.purpose===purpose)&&(!favoritesOnly||x.favorite===true)&&(!q||[x.name,x.sku,x.variant_label,x.description].join(' ').toLocaleLowerCase('ru').includes(q)));
}
export function fallbackCatalogError(error){return error?.code==='PGRST202'||error?.code==='42883';}
export function lineErrors(error,lines){
 let d=error?.details;try{if(typeof d==='string')d=JSON.parse(d);}catch{return {};}
 const ids=Array.isArray(d?.line_ids)?d.line_ids:d?.line_id?[d.line_id]:Number.isInteger(d?.index)&&lines[d.index-1]?[lines[d.index-1].lineId]:[];
 const result={};for(const id of ids){const parent=lines.find(x=>id===x.lineId||typeof id==='string'&&id.startsWith(x.lineId+':'));if(parent)result[parent.lineId]=friendlyError(error);}return result;
}
export function friendlyError(error){
 const value=String(error?.message||error||'');const messages=[
 ['insufficient_inventory_stock','Недостаточно остатка. Обновите каталог и измените корзину.'],['catalog_import_metadata_only','Импорт содержит остатки. Здесь доступны только карточки и цены.'],
 ['catalog_import_owner_required','Импорт сохранить может только владелец.'],['financial_manager_role_required','Нужны права владельца или администратора.'],
 ['catalog_request_conflict','Параметры отправленного запроса отличаются. Сначала проверьте его результат.'],['catalog_sku_conflict','Артикул уже занят.'],
 ['catalog_metadata_changed','Карточка товара изменилась. Обновите каталог.'],['catalog_price_changed','Цена изменилась. Обновите каталог.'],
 ['catalog_bundle_changed','Состав набора изменился. Добавьте его заново.'],['catalog_preview_changed','Предпросмотр устарел. Проверьте импорт ещё раз.'],
 ['catalog_stock_precision_invalid','Количество нельзя точно списать со склада.'],['catalog_base_unit_locked','Единицу существующей позиции изменить нельзя.'],
 ['catalog_unit_conversion_invalid','Проверьте единицы и коэффициент списания.'],['finance_disabled','Финансовый учёт выключен.'],['inventory_disabled','Складской учёт выключен.'],
 ['sales_catalog_writes_disabled','Изменения каталога временно отключены.'],['commercial_client_mismatch','Выбранный клиент недоступен в этой организации.'],
 ['commercial_seller_not_active_member','Выберите действующего продавца.'],['catalog_warehouse_scope_mismatch','Выберите склад этой организации.'],
 ['invalid_catalog','Проверьте позиции, количество, цену и единицы.']];
 return messages.find(([key])=>value.includes(key))?.[1]||'Не удалось подтвердить результат. Проверьте соединение и статус запроса.';
}
