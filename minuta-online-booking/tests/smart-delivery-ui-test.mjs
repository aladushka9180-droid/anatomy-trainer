import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = read('../provider.html');
const center = read('../notification-center.js');
const styles = read('../styles.css');

for (const tab of ['events','channels','deliveries']) {
  assert.match(html, new RegExp(`data-unified-tab="${tab}"`));
  assert.match(html, new RegExp(`data-unified-page="${tab}"`));
}
for (const filter of ['attention','transit','delivered','all']) {
  assert.match(html, new RegExp(`data-unified-delivery-filter="${filter}"`));
}
assert.match(html, /id="saveUnifiedNotifications"[^>]*disabled/);
assert.match(html, /Внешняя стоимость SMS и WhatsApp всегда показывается отдельно до активации/);
assert.match(html, /Автопокупок и списаний нет/);

for (const group of ['При записи','Перед визитом','После визита','Возвращаемость']) assert.match(center, new RegExp(group));
for (const channel of ['telegram','max','whatsapp','sms','vk']) assert.match(center, new RegExp(`['"]${channel}['"]`));
assert.match(center, /Доступно в Pro/);
assert.match(center, /Маркетинговые события выключены до явного согласия клиента/);
assert.match(center, /Официальный Cloud API ещё не подключён к серверной очереди/);
assert.match(center, /Нужны сообщество VK, разрешение клиента и проверка webhook/);
assert.match(html, /После подтверждённого успеха цепочка останавливается/);
assert.match(center, /item\.status === 'failed' \|\| item\.status === 'cancelled'/);
assert.match(center, /async function save\(\)[\s\S]*set_minuta_notification_channel[\s\S]*set_minuta_notification_master/);
assert.doesNotMatch(center, /WHATSAPP_(?:TOKEN|SECRET)|VK_(?:TOKEN|SECRET)|MAX_(?:TOKEN|SECRET)|SMS_(?:TOKEN|SECRET)/);

assert.match(styles, /\.smart-delivery-tabs/);
assert.match(styles, /\.smart-event-row>summary/);
assert.match(styles, /\.smart-channel-row\[data-channel-state="unavailable"\]/);
assert.match(styles, /bottom:max\(0px,env\(safe-area-inset-bottom,0px\)\)/);
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.smart-event-detail \{ grid-template-columns:1fr/);
assert.match(styles, /\.provider-body\[data-provider-theme\] \.smart-delivery-panel/);

console.log('PrimeTime Pro smart delivery UI contract: PASS');
