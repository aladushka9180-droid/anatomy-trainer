const dataUrl=new URL('./commerce-catalog-data.js',import.meta.url),version=new URL(import.meta.url).searchParams.get('v');if(version)dataUrl.searchParams.set('v',version);
const {decimal,moneyMinor,PURPOSES,UNITS,safePhotoUrl,validConversion}=await import(dataUrl.href);
export const IMPORT_FIELDS=Object.freeze({inventory_item_id:'ID существующей позиции',name:'Название',sku:'Артикул',category:'Категория',purpose:'Назначение (retail/consumable/both)',unit:'Единица склада',sale_unit:'Единица продажи',stock_per_sale_unit:'Списываемый объём за единицу продажи',price:'Цена в рублях',group_key:'Группа вариантов',variant_label:'Вариант',icon:'Иконка',photo_url:'HTTPS фото',description:'Описание'});
const aliases={inventory_item_id:['inventory_item_id','id позиции'],name:['название','name','товар'],sku:['артикул','sku'],category:['категория','category'],purpose:['назначение','purpose'],unit:['единица склада','unit'],sale_unit:['единица продажи','sale_unit'],stock_per_sale_unit:['коэффициент','stock_per_sale_unit'],price:['цена','цена в рублях','price'],group_key:['группа','group_key'],variant_label:['вариант','variant_label'],icon:['иконка','icon'],photo_url:['фото','photo_url'],description:['описание','description']};
const forbidden=new Set(['stock','stock_quantity','quantity','opening_stock','остаток','остатки','количество','начальный остаток','начальные остатки']);
const normalized=value=>String(value??'').trim().toLocaleLowerCase('ru');
export function guessColumns(headers){return Object.fromEntries(Object.keys(IMPORT_FIELDS).map(field=>[field,headers.findIndex(header=>aliases[field].includes(normalized(header)))]));}
function parseWithSeparator(source,separator){
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++;}else if(quoted){quoted=false;closed=true;}else if(!cell&&!closed)quoted=true;else throw new Error('Проверьте кавычки в CSV.');}
  else if(c===separator&&!quoted){row.push(cell);cell='';closed=false;}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';closed=false;}
  else if(closed&&!/\s/.test(c))throw new Error('Проверьте разделители после кавычек.');else cell+=c;
  if(rows.length>201||cell.length>10000||row.length>50)throw new Error('Не более 200 строк, 50 колонок и 10000 символов в ячейке.');
 }
 if(quoted)throw new Error('Не закрыты кавычки в CSV.');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
 if(rows.length>201)throw new Error('Не более 200 строк за один импорт.');return rows;
}
export function parseDelimited(text){
 const source=String(text).replace(/^\uFEFF/,'');const candidates=[];
 for(const delimiter of [';',',','\t']){try{const rows=parseWithSeparator(source,delimiter);candidates.push({rows,width:rows[0]?.length||0});}catch{/* try a different delimiter */}}
 if(!candidates.length)throw new Error('Проверьте кавычки, размер и разделители в CSV.');
 return candidates.sort((a,b)=>b.width-a.width)[0].rows;
}
export function validateItem(input,existing=[]){
 const errors=[];const item={...input};
 for(const key of Object.keys(item))if(forbidden.has(normalized(key)))errors.push('Остатки и количество не импортируются.');
 const previous=existing.find(row=>row.id===item.inventory_item_id);
 if(item.inventory_item_id&&!previous)errors.push('Позиция недоступна в этой организации.');
 if(String(item.name||'').trim().length<2||String(item.name).length>120)errors.push('Название: 2–120 символов.');
 for(const [field,max] of [['sku',80],['category',80],['group_key',80],['variant_label',120],['icon',40],['description',2000]])if(String(item[field]||'').length>max)errors.push(field+': превышена допустимая длина.');
 if(!Object.hasOwn(PURPOSES,item.purpose))errors.push('Неизвестное назначение.');
 if(!validConversion(item.unit,item.sale_unit,item.stock_per_sale_unit))errors.push('Проверьте единицы и коэффициент списания.');
 if(previous&&previous.unit!==item.unit)errors.push('Единицу существующей позиции изменить нельзя.');
 if(item.sale_price_minor!==null&&(!Number.isSafeInteger(item.sale_price_minor)||item.sale_price_minor<=0))errors.push('Цена должна быть положительной и точной, либо не указана.');
 if(!Number.isSafeInteger(item.metadata_version)||item.metadata_version<0)errors.push('Версия карточки не подтверждена.');
 if(item.photo_url&&!safePhotoUrl(item.photo_url)||String(item.photo_url||'').length>2048)errors.push('Фото: HTTPS без пробелов, логина и пароля.');
 const sku=normalized(item.sku);if(sku&&existing.some(row=>normalized(row.sku)===sku&&row.id!==item.inventory_item_id))errors.push('Артикул уже занят.');
 return errors;
}
export function previewImport(matrix,mapping=guessColumns(matrix[0]||[]),existing=[]){
 const errors=[];if(!matrix.length||matrix.length>201)return {rows:[],errors:['Выберите файл с заголовком и не более 200 строк.'],valid:false};
 if(matrix[0].some(header=>forbidden.has(normalized(header))))errors.push('В файле есть остаток или количество. Уберите эти колонки: импорт сохраняет только карточки и цены.');
 const used=Object.values(mapping).filter(i=>Number.isInteger(i)&&i>=0);
 if(new Set(used).size!==used.length)errors.push('Каждой колонке назначьте только одно поле.');
 if(!(mapping.name>=0))errors.push('Выберите колонку названия.');
 const seen=new Set(),seenIds=new Set();
 const rows=matrix.slice(1).map((cells,index)=>({cells,index})).filter(({cells})=>cells.some(v=>String(v??'').trim())).map(({cells,index})=>{
  const get=field=>String(cells[mapping[field]]??'').trim(),sku=get('sku'),id=get('inventory_item_id');
  const previous=existing.find(row=>id?row.id===id:sku&&normalized(row.sku)===normalized(sku));
  const unit=get('unit')||previous?.unit||'piece',sale_unit=get('sale_unit')||unit;
  const item={inventory_item_id:id||previous?.id||null,name:get('name'),sku,unit,sale_unit,stock_per_sale_unit:get('stock_per_sale_unit')?decimal(get('stock_per_sale_unit')):1,
   sale_price_minor:get('price')?moneyMinor(get('price')):null,purpose:get('purpose')||'retail',category:get('category'),group_key:get('group_key'),variant_label:get('variant_label'),icon:get('icon')||'box',photo_url:get('photo_url'),description:get('description'),metadata_version:previous?.metadata_version??0};
  const rowErrors=validateItem(item,existing);
  if(get('price')&&item.sale_price_minor===null)rowErrors.push('Цена: положительное число до двух знаков после запятой.');
  const key=normalized(sku);if(key&&seen.has(key))rowErrors.push('Артикул повторяется в файле.');if(key)seen.add(key);
  if(item.inventory_item_id&&seenIds.has(item.inventory_item_id))rowErrors.push('Позиция повторяется в файле.');if(item.inventory_item_id)seenIds.add(item.inventory_item_id);
  return {line:index+2,item,errors:rowErrors,operation:previous?'Обновление':'Новая позиция'};
 });
 if(JSON.stringify(rows).length>1500000)errors.push('Объём данных превышает безопасный предел. Разделите файл.');
 return {rows,errors,valid:rows.length>0&&!errors.length&&rows.every(row=>!row.errors.length)};
}
export async function loadCatalogXlsx(){
 // Reuse the application's integrity-pinned, timeout/retry-safe loader only on XLSX selection.
 if(!globalThis.MinutaClientImport?.loadXlsx){const url=new URL('./client-import.js',import.meta.url);if(version)url.searchParams.set('v',version);await import(url.href);}
 if(!globalThis.MinutaClientImport?.loadXlsx)throw new Error('Модуль Excel недоступен. Можно выбрать CSV.');
 return globalThis.MinutaClientImport.loadXlsx();
}
export async function decodeCatalogFile(file,loadXlsx=loadCatalogXlsx){
 if(!file||file.size<1||file.size>12*1024*1024)throw new Error('Выберите непустой файл до 12 МБ.');
 if(/\.(csv|tsv)$/i.test(file.name)){
  const bytes=await file.arrayBuffer();let text=new TextDecoder('utf-8').decode(bytes);if(text.includes('\ufffd'))text=new TextDecoder('windows-1251').decode(bytes);
  return [{name:file.name,matrix:parseDelimited(text)}];
 }
 if(!/\.xlsx$/i.test(file.name))throw new Error('Поддерживаются XLSX, CSV и TSV.');
 const xlsx=await loadXlsx(),book=xlsx.read(await file.arrayBuffer(),{type:'array',cellFormula:true,sheetRows:202});
 return book.SheetNames.map(name=>{
  const sheet=book.Sheets[name];for(const [key,cell] of Object.entries(sheet))if(!key.startsWith('!')&&cell?.f)throw new Error('Формулы не импортируются. Сохраните значения или выберите CSV.');
  const matrix=xlsx.utils.sheet_to_json(sheet,{header:1,raw:true,defval:''});
  if(matrix.length>201||sheet['!fullref']&&xlsx.utils.decode_range(sheet['!fullref']).e.r>200)throw new Error('Не более 200 строк на листе.');
  return {name,matrix};
 });
}
