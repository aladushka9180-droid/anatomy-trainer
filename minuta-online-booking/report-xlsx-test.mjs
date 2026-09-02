import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'provider.js'), 'utf8');
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
assert.match(source, /link\.download = `записи-\$\{businessTodayIso\(\)\}\.xlsx`/, 'Отчёт сохраняется не в формате XLSX');
assert.match(source, /addEventListener\('click', exportBookingsXlsx\)/, 'Кнопка отчёта не подключена к экспорту XLSX');

console.log('report xlsx test: ok');
