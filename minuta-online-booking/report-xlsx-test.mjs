import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'provider.js'), 'utf8');
const workerSource = readFileSync(join(root, 'report-worker.js'), 'utf8');
const serviceWorkerSource = readFileSync(join(root, 'sw.js'), 'utf8');
const version = serviceWorkerSource.match(/const CACHE = `\$\{CACHE_PREFIX\}v(\d+)`;/)?.[1];
assert.ok(version, 'Не удалось определить версию отчёта');
const start = source.indexOf('function reportXmlText');
const end = source.indexOf('function exportBookingsXlsx');
assert.ok(start >= 0 && end > start, 'Не найден генератор Excel-отчёта');

const context = { Blob, TextEncoder };
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
const workbook = context.reportWorkbook([
  ['Дата', 'Клиент', 'Получено, ₽'],
  ['2026-09-03', 'Аладушка & партнёры', 4300]
]);
assert.equal(workbook.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

const bytes = new Uint8Array(await workbook.arrayBuffer());
const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
assert.equal(view.getUint32(0, true), 0x04034b50, 'Excel-отчёт не начинается с ZIP-заголовка');
assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50, 'Excel-отчёт не завершён ZIP-каталогом');
assert.equal(view.getUint16(bytes.length - 12, true), 6, 'В Excel-отчёте неполный набор файлов');

const binaryText = new TextDecoder().decode(bytes);
for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) {
  assert.ok(binaryText.includes(name), `В Excel-отчёте отсутствует ${name}`);
}
assert.ok(binaryText.includes('Аладушка &amp; партнёры'), 'Текст отчёта не экранирован для Excel');
assert.match(source, /async function exportBookingsXlsxInBackground\(privacy='masked'\)/, 'Фоновый экспорт не принимает настройку приватности');
assert.match(source, new RegExp(`new Worker\\('\\.\\/report-worker\\.js\\?v=${version}'\\)`), 'Excel-отчёт не передаётся отдельному worker текущей версии');
assert.match(serviceWorkerSource, new RegExp(`report-worker\\.js\\?v=${version}`), 'Worker отчёта не включён в текущий PWA-кэш');
assert.match(source, /button\.dataset\.reportExport === 'xlsx'\) void exportBookingsXlsxInBackground\(privacy\)/, 'Кнопка отчёта не подключена к фоновому экспорту XLSX');
assert.match(source, /exportBookingsXlsx\(privacy\)/, 'При недоступном worker нет безопасного синхронного экспорта');

const workerMessages = [];
const workerContext = { Blob, TextEncoder, self:{ postMessage:value => workerMessages.push(value) } };
vm.createContext(workerContext);
vm.runInContext(workerSource, workerContext);
await workerContext.self.onmessage({ data:{ sheets:[
  { name:'Сводка', rows:[[{ value:'Сводка', style:1 }]], options:{ widths:[20], merges:[], heights:{}, freeze:0 } },
  { name:'Записи', rows:[[{ value:'Клиент', style:4 }], [{ value:'Аладушка & партнёры', style:5 }]], options:{ widths:[30], merges:['A1:A1'], heights:{}, freeze:1, filter:'A1:A2' } }
] } });
assert.equal(workerMessages.length, 1, 'Worker не вернул результат');
assert.ok(workerMessages[0].blob instanceof Blob, `Worker вернул ошибку: ${workerMessages[0].error || 'нет файла'}`);
const workerBytes = new Uint8Array(await workerMessages[0].blob.arrayBuffer());
const workerText = new TextDecoder().decode(workerBytes);
assert.ok(workerText.includes('xl/worksheets/sheet2.xml'), 'Фоновый Excel потерял второй лист');
assert.ok(workerText.includes('Аладушка &amp; партнёры'), 'Фоновый Excel не экранирует пользовательский текст');
assert.ok(workerText.includes('zoomScale="95"'), 'Фоновый Excel потерял масштаб листа из основного генератора');
assert.ok(workerText.indexOf('<autoFilter ref="A1:A2"/>') < workerText.indexOf('<mergeCells count="1">'), 'В XML листа autoFilter должен находиться перед mergeCells');

// Ten years at ten appointments a day: the export must complete in the worker
// without depending on DOM APIs or freezing the cabinet thread.
workerMessages.length = 0;
const tenYearRows = [['Дата', 'Клиент', 'Получено, ₽']];
for (let index = 0; index < 36500; index += 1) {
  tenYearRows.push([`день-${Math.floor(index / 10) + 1}`, `Клиент ${index + 1}`, index % 5000]);
}
await workerContext.self.onmessage({ data:{ sheets:[
  { name:'Записи 10 лет', rows:tenYearRows, options:{ widths:[14,28,16], merges:[], heights:{}, freeze:1, filter:`A1:C${tenYearRows.length}` } }
] } });
assert.equal(workerMessages.length, 1, 'Worker не завершил десятилетний экспорт');
assert.ok(workerMessages[0].blob instanceof Blob, `Десятилетний экспорт завершился ошибкой: ${workerMessages[0].error || 'нет файла'}`);
assert.ok(workerMessages[0].blob.size > 1_000_000, 'Десятилетний экспорт неожиданно потерял строки');

console.log('report xlsx test: ok');
