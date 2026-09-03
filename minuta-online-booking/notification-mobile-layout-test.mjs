import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [css, provider] = await Promise.all([
  readFile(path.join(directory, 'styles.css'), 'utf8'),
  readFile(path.join(directory, 'provider.js'), 'utf8')
]);

assert.match(
  css,
  /\.unified-notification-panel #unifiedNotificationWorkspace>\.settings-check\s*\{[^}]*grid-template-columns:20px minmax\(0,1fr\)[^}]*min-height:52px[^}]*\}/s,
  'the unified notification switch must use a compact two-column card',
);
assert.match(
  css,
  /\.unified-notification-panel #unifiedNotificationsEnabled\s*\{[^}]*width:20px!important[^}]*height:20px!important[^}]*min-height:20px!important[^}]*\}/s,
  'the unified checkbox must not inherit a full-width form input layout',
);
assert.match(
  css,
  /\.unified-channel-card input\s*\{[^}]*flex:0 0 20px[^}]*width:20px!important[^}]*height:20px!important[^}]*min-height:20px!important[^}]*\}/s,
  'channel checkboxes must not inherit the global full-width form input layout',
);
assert.match(
  css,
  /\.unified-channel-card span\s*\{[^}]*flex:1 1 auto[^}]*width:auto[^}]*min-width:0[^}]*\}/s,
  'channel labels must keep the remaining card width without horizontal overflow',
);
assert.match(
  css,
  /@media \(max-width:760px\)[^{]*\{[\s\S]*?\.provider-view\[data-provider-panel="notifications"\]\s*\{[^}]*padding-bottom:calc\(96px \+ env\(safe-area-inset-bottom\)\)[^}]*\}/,
  'mobile notifications must reserve space above the fixed create button and navigation',
);
assert.match(
  css,
  /\.provider-view\[data-provider-panel="notifications"\] \.view-title\s*\{[^}]*display:grid[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*\}/s,
  'the notification title and actions must stack on mobile instead of squeezing the heading',
);
assert.match(
  css,
  /\.provider-view\[data-provider-panel="notifications"\] \.view-title-actions\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px[^}]*width:100%[^}]*\}/s,
  'mobile notification actions must use the available width and preserve a 44px refresh target',
);
assert.match(
  css,
  /@media \(max-width:760px\), \(max-width:1100px\) and \(pointer:coarse\)/,
  'notification touch targets must apply both on mobile widths and coarse-pointer tablets',
);
assert.match(
  css,
  /\.provider-view\[data-provider-panel="notifications"\] :is\([^)]*\.notification-filters button[^)]*\.notification-card-actions button[^)]*\)\s*\{ min-width:44px; min-height:44px; \}/,
  'notification actions and filters must have 44px touch targets',
);
assert.match(
  css,
  /\.notification-template-dialog-head button\s*\{ width:44px; min-width:44px; height:44px; min-height:44px; \}/,
  'dialog close controls must have a 44px touch target',
);
assert.match(provider, /\$\('#dashboard'\)\.dataset\.activeView = view;/, 'the active provider view must be exposed to responsive CSS');
assert.match(css, /\.provider-app\[data-active-view="notifications"\] \.provider-mobile-create\s*\{ display:none; \}/, 'the booking action must not cover notification content');
assert.match(
  css,
  /\.provider-body\[data-provider-theme\] \.provider-view\[data-provider-panel="notifications"\] :is\([\s\S]*?\.unified-channel-card small[\s\S]*?\)\s*\{[^}]*color:color-mix\(in srgb,var\(--theme-muted\) 78%,var\(--theme-ink\)\)!important[^}]*\}/,
  'secondary notification text must remain readable in every theme',
);
assert.match(
  css,
  /\.provider-body\[data-provider-theme\] \.provider-mobile-nav :is\(button,a\):not\(\.active\)\s*\{[^}]*color:color-mix\(in srgb,var\(--theme-muted\) 78%,var\(--theme-ink\)\)[^}]*\}/,
  'inactive mobile navigation items must inherit an accessible theme color',
);
assert.match(css, /data-provider-theme="hitech"[^}]*\.provider-mobile-nav button\.active\s*\{ color:#075d89; \}/, 'the Hi-tech active mobile item must not use low-contrast cyan text');

console.log('Notification mobile layout checks passed.');
