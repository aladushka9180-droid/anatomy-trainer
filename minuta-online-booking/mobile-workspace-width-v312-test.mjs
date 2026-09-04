import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(
  styles,
  /@media \(max-width:760px\)[\s\S]*data-provider-layout\] \.provider-workspace \{ padding-right:8px!important; padding-left:8px!important; \}/,
  'Компоновки с повышенной специфичностью снова могут сузить мобильную рабочую область',
);
assert.match(
  styles,
  /data-provider-layout="bento"\] \.provider-workspace \{ padding-right:0!important; padding-left:0!important; \}/,
  'Bento должен учитывать собственные внешние поля приложения без второго отступа',
);

for (const layout of ['linear', 'soft', 'capsule', 'editorial', 'bento', 'split']) {
  assert.match(styles, new RegExp(`data-provider-layout="${layout}"`), `Нет стилей компоновки ${layout}`);
}

console.log('Mobile workspace width v312 checks passed.');
