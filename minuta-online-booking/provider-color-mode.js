(function initializeProviderColorMode() {
  'use strict';

  const modes = Object.freeze(['light', 'dark', 'system']);
  const overrideProperties = Object.freeze([
    '--theme-bg', '--theme-surface', '--theme-surface-alt', '--theme-ink', '--theme-muted', '--theme-line',
    '--theme-accent', '--theme-accent-soft', '--theme-accent-contrast', '--theme-shadow',
    '--material-card-bg', '--material-card-border', '--signature-sidebar', '--signature-stage',
    '--signature-nav-active', '--signature-card-shadow', '--atmosphere-background', '--atmosphere-panel',
    '--atmosphere-panel-strong', '--workspace-secondary'
  ]);

  function normalizeMode(value, fallback = 'light') {
    const normalizedFallback = modes.includes(fallback) ? fallback : 'light';
    return modes.includes(String(value || '')) ? String(value) : normalizedFallback;
  }

  function resolveMode(value, prefersDark = false, fallback = 'light') {
    const requested = normalizeMode(value, fallback);
    return requested === 'system' ? (prefersDark ? 'dark' : 'light') : requested;
  }

  function rgbFromHex(value) {
    const hex = String(value || '').trim().replace(/^#/, '');
    if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(hex)) return { r:52, g:114, b:88 };
    const full = hex.length === 3 ? [...hex].map(character => character + character).join('') : hex;
    return {
      r:parseInt(full.slice(0, 2), 16),
      g:parseInt(full.slice(2, 4), 16),
      b:parseInt(full.slice(4, 6), 16)
    };
  }

  function hexFromRgb({ r, g, b }) {
    const channel = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`;
  }

  function mix(first, second, secondShare) {
    const a = rgbFromHex(first);
    const b = rgbFromHex(second);
    const share = Math.max(0, Math.min(1, Number(secondShare) || 0));
    return hexFromRgb({
      r:a.r + (b.r - a.r) * share,
      g:a.g + (b.g - a.g) * share,
      b:a.b + (b.b - a.b) * share
    });
  }

  function luminance(value) {
    const rgb = rgbFromHex(value);
    const channel = component => {
      const normalized = component / 255;
      return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    };
    return .2126 * channel(rgb.r) + .7152 * channel(rgb.g) + .0722 * channel(rgb.b);
  }

  function contrast(first, second) {
    const lighter = Math.max(luminance(first), luminance(second));
    const darker = Math.min(luminance(first), luminance(second));
    return (lighter + .05) / (darker + .05);
  }

  function readableAccent(accent, surface, mode) {
    let result = accent;
    const target = mode === 'dark' ? '#ffffff' : '#000000';
    for (let step = 0; step < 8 && contrast(result, surface) < 4.5; step += 1) {
      result = mix(result, target, .14);
    }
    return result;
  }

  function readableContrast(background) {
    return contrast('#ffffff', background) >= contrast('#101418', background) ? '#ffffff' : '#101418';
  }

  function rgba(value, alpha) {
    const color = rgbFromHex(value);
    return `rgba(${color.r},${color.g},${color.b},${alpha})`;
  }

  function derivePalette(theme, mode) {
    const selectedMode = mode === 'dark' ? 'dark' : 'light';
    const sourceAccent = theme?.palette?.accent || '#347258';
    if (selectedMode === 'dark') {
      const bg = mix('#0b0f12', sourceAccent, .07);
      const surface = mix('#171c20', sourceAccent, .08);
      const surfaceAlt = mix('#1e252a', sourceAccent, .10);
      const ink = mix('#f4f6f5', sourceAccent, .035);
      const muted = mix('#aab4b3', sourceAccent, .07);
      const line = mix('#3c464a', sourceAccent, .11);
      const accent = readableAccent(mix(sourceAccent, '#ffffff', .28), surface, selectedMode);
      const accentSoft = mix(surface, accent, .18);
      return Object.freeze({
        bg, surface, surfaceAlt, ink, muted, line, accent, accentSoft,
        contrast:readableContrast(accent), shadow:'rgba(0,0,0,.34)',
        pattern:`radial-gradient(circle at 84% 7%,${rgba(accent, .14)},transparent 36%),radial-gradient(circle at 10% 82%,${rgba(sourceAccent, .09)},transparent 40%),linear-gradient(145deg,${bg},${surfaceAlt} 54%,${bg})`,
        themeColor:bg, dark:true
      });
    }
    const bg = mix('#f7f9f8', sourceAccent, .045);
    const surface = mix('#ffffff', sourceAccent, .012);
    const surfaceAlt = mix('#f2f5f4', sourceAccent, .065);
    const ink = mix('#182126', sourceAccent, .07);
    const muted = mix('#657176', sourceAccent, .075);
    const line = mix('#d6dedf', sourceAccent, .09);
    const accent = readableAccent(mix(sourceAccent, '#000000', .08), surface, selectedMode);
    const accentSoft = mix('#edf2f1', accent, .14);
    return Object.freeze({
      bg, surface, surfaceAlt, ink, muted, line, accent, accentSoft,
      contrast:readableContrast(accent), shadow:'rgba(24,46,43,.12)',
      pattern:`radial-gradient(circle at 84% 7%,${rgba(sourceAccent, .13)},transparent 36%),radial-gradient(circle at 10% 82%,rgba(255,255,255,.82),transparent 40%),linear-gradient(145deg,${bg},${surface} 54%,${surfaceAlt})`,
      themeColor:bg, dark:false
    });
  }

  function clearOverrides(element) {
    if (!element?.style) return;
    overrideProperties.forEach(property => element.style.removeProperty(property));
  }

  function apply(element, theme, requestedMode, prefersDark = false) {
    if (!element || !theme?.palette) return null;
    const nativeMode = theme.palette.dark ? 'dark' : 'light';
    const requested = normalizeMode(requestedMode, nativeMode);
    const resolved = resolveMode(requested, prefersDark, nativeMode);
    clearOverrides(element);
    element.dataset.providerColorMode = requested;
    element.dataset.providerResolvedColorMode = resolved;
    element.dataset.providerColorVariant = resolved === nativeMode ? 'native' : 'derived';
    element.style.colorScheme = resolved;
    if (resolved === nativeMode) {
      return Object.freeze({ requested, resolved, nativeMode, derived:false, palette:theme.palette, themeColor:theme.palette.themeColor });
    }
    const palette = derivePalette(theme, resolved);
    const values = {
      '--theme-bg':palette.bg,
      '--theme-surface':palette.surface,
      '--theme-surface-alt':palette.surfaceAlt,
      '--theme-ink':palette.ink,
      '--theme-muted':palette.muted,
      '--theme-line':palette.line,
      '--theme-accent':palette.accent,
      '--theme-accent-soft':palette.accentSoft,
      '--theme-accent-contrast':palette.contrast,
      '--theme-shadow':palette.shadow,
      '--material-card-bg':palette.surface,
      '--material-card-border':palette.line,
      '--signature-sidebar':palette.surface,
      '--signature-stage':palette.surfaceAlt,
      '--signature-nav-active':palette.accentSoft,
      '--signature-card-shadow':`0 10px 30px ${palette.shadow}`,
      '--atmosphere-background':palette.pattern,
      '--atmosphere-panel':palette.surface,
      '--atmosphere-panel-strong':palette.surface,
      '--workspace-secondary':palette.muted
    };
    Object.entries(values).forEach(([property, value]) => element.style.setProperty(property, value, 'important'));
    return Object.freeze({ requested, resolved, nativeMode, derived:true, palette, themeColor:palette.themeColor });
  }

  window.MinutaProviderColorMode = Object.freeze({
    modes, normalizeMode, resolveMode, derivePalette, contrast, apply, clearOverrides
  });
})();
