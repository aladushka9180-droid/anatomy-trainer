import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('provider-price-list.js', root), 'utf8');
class FakeFile { constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; } }
const context = {
  window:{}, File:FakeFile,
  document:{ createElement:() => ({ getContext:() => ({
    measureText:value => ({ width:String(value).length * 12 }),
    scale(){}, fillRect(){}, fillText(){},
  }), toBlob:callback => callback({ image:true }) }) },
  Intl,
};
vm.runInNewContext(source, context);
const model = context.window.PrimeTimePriceList;
const records = [
  { name:'Массаж спины', active:true, price_rub:2500, duration_minutes:60 },
  { name:'Скрыто', active:false, price_rub:500, duration_minutes:30 },
  { name:'Без цены', active:true, price_rub:null, duration_minutes:30 },
  { name:'Поминутно', active:true, price_rub:50, duration_minutes:1, default_duration_minutes:45 },
];
const items = model.eligible(records);
assert.equal(items.length, 2);
const message = model.textFor(items, 'https://example.test/book');
assert.match(message, /Массаж спины — 2\s?500 ₽ · 60 мин/);
assert.match(message, /Поминутно — 50 ₽\/мин · обычно 45 мин/);
assert.match(message, /Онлайн-запись: https:\/\/example.test\/book/);
assert.doesNotMatch(message, /Скрыто|Без цены/);
const many = Array.from({ length:41 }, (_, i) => ({ name:`Услуга ${i + 1}`, active:true, price_rub:100, duration_minutes:30 }));
const pages = await model.imageFiles(many, 'https://example.test/book');
assert.equal(pages.length, 3);
assert.equal(pages.map(file => file.name).join(','), 'primetime-price-list-1.png,primetime-price-list-2.png,primetime-price-list-3.png');
console.log('Price list checks passed');
