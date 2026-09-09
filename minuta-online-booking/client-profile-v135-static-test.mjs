import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const html=read('./provider.html');
const js=read('./provider.js');
const css=read('./client-records.css');
const migration=read('./supabase-migration-v135.sql');
const rollback=read('./supabase-migration-v135-rollback.sql');

assert.match(html,/id="clientMoreTitle">Дополнительно</);
assert.doesNotMatch(html,/id="clientBirthdayAction"/,'Birthday must not be duplicated inside Additional');
assert.match(html,/class="client-birthday-icon"/,'Birthday is a regular calendar row in the profile');
assert.match(html,/id="clientRestrictionsTitle">Ограничения</);
assert.match(html,/id="clientBlockReason" maxlength="500"/);
assert.match(html,/id="clientIdentityAction"/,'Identity editing must remain available');
assert.match(js,/get_minuta_client_profile_v135/);
assert.match(js,/set_minuta_client_online_booking_block_v135/);
assert.match(js,/isMissingRpc\(error, 'get_minuta_client_profile_v135'\)/,'Frontend must gracefully fall back before production migration');
assert.match(css,/\.client-profile-dialog \{ width:min\(390px/,'Dialogs stay compact on desktop');
assert.match(css,/\.client-profile-dialog-head>button[^}]*48px/,'Close control is easier to hit');
assert.match(css,/\.client-restrictions \.client-block-action[^}]*background:#a7433d/,'Only the dangerous action is red');
assert.match(migration,/online_booking_block_reason text/);
assert.match(migration,/char_length\(online_booking_block_reason\) between 1 and 500/);
assert.match(migration,/has_organization_role\(p_organization,array\['owner','admin'\]/,'Only managers can change restrictions');
assert.match(rollback,/v135_rollback_preserves_client_block_reasons/,'Rollback must not discard recorded reasons');

console.log('Client profile v135 static checks: PASS');
