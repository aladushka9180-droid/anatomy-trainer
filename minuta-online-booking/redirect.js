(() => {
  'use strict';

  const legacyHost = 'aladushka9180-droid.github.io';
  const legacyEntry = '/anatomy-trainer/minuta-online-booking/';
  const normalizedPath = window.location.pathname.replace(/\/index\.html$/, '/');
  if (window.location.hostname !== legacyHost || normalizedPath !== legacyEntry) return;

  const target = new URL('https://primetime-booking.github.io/');
  target.search = window.location.search;
  target.hash = window.location.hash;
  window.location.replace(target.href);
})();
