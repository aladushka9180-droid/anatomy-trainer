import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../android/primetime-calls/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const activity = readFileSync(new URL('../android/primetime-calls/app/src/main/java/ru/primetime/pro/calls/MainActivity.java', import.meta.url), 'utf8');
const policy = readFileSync(new URL('../android/primetime-calls/app/src/main/java/ru/primetime/pro/calls/CallLogPolicy.java', import.meta.url), 'utf8');
const disclosure = readFileSync(new URL('../android/primetime-calls/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');

assert.match(provider, /id="newBookingRecentCalls"[^>]+hidden/);
assert.match(provider, /PrimeTimeAndroidCalls\.openRecentCalls\(\)/);
assert.match(provider, /PrimeTimeReceiveRecentCall = receiveNewBookingRecentCall/);
assert.match(provider, /handleNewBookingPhoneInput\(\)/, 'Selected caller must pass through the CRM lookup');
assert.match(styles, /#newBookingRecentCalls:not\(\[hidden\]\) \{ display:grid; \}/);

assert.match(manifest, /android\.permission\.READ_CALL_LOG/);
assert.match(manifest, /android:usesCleartextTraffic="false"/);
assert.match(activity, /CallLog\.Calls\.INCOMING_TYPE/);
assert.match(activity, /CallLog\.Calls\.MISSED_TYPE/);
assert.match(activity, /MAX_RECENT_CALLS = 20/);
assert.match(activity, /seenNumbers\.add\(normalized\)/, 'The picker must show fresh unique callers');
assert.match(activity, /checkSelfPermission\(Manifest\.permission\.READ_CALL_LOG\)/);
assert.match(activity, /requestPermissions\(new String\[\]\{Manifest\.permission\.READ_CALL_LOG\}/);
assert.match(activity, /JSONObject\.quote\(rawNumber\)/, 'Only a safely encoded selected number may cross the bridge');
const bridge = activity.slice(activity.indexOf('private final class CallsBridge'), activity.indexOf('private static final class CallEntry'));
assert.match(bridge, /public boolean isAvailable\(\)/);
assert.match(bridge, /public void openRecentCalls\(\)/);
assert.doesNotMatch(bridge, /CallEntry|List<|String\[\]|CharSequence/, 'The JavaScript bridge must not expose call-log rows');
assert.match(policy, /TRUSTED_HOST = "aladushka9180-droid\.github\.io"/);
assert.match(policy, /path\.startsWith\(TRUSTED_PATH\)/);
assert.match(disclosure, /Журнал звонков не загружается на сервер/);
assert.match(disclosure, /только номер, который вы выберете/);

console.log('PASS: Android recent-call access is explicit, bounded and selection-only');
