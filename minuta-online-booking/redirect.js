(() => {
  'use strict';

  const target = new URL('https://primetime-booking.github.io/');
  target.search = window.location.search;
  target.hash = window.location.hash;
  document.querySelector('#continueLink')?.setAttribute('href', target.href);
  window.location.replace(target.href);
})();
