(function () {
  const key = 'eldion-help-booking-context';
  const validators = {
    org: /^[a-z0-9][a-z0-9-]{2,62}$/,
    service: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    location: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    provider: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    group: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  };
  const readContext = params => Object.fromEntries(Object.entries(validators)
    .filter(([name, validator]) => validator.test(params.get(name) || ''))
    .map(([name]) => [name, params.get(name)]));
  const params = new URLSearchParams(location.search);
  const explicitContext = Object.keys(validators).some(name => params.has(name));
  let context = readContext(params);
  try {
    if (explicitContext) sessionStorage.setItem(key, JSON.stringify(context));
    else context = readContext(new URLSearchParams(JSON.parse(sessionStorage.getItem(key) || '{}')));
  } catch { /* Public link navigation also works with storage disabled. */ }
  window.MinutaHelpNavigation = {
    href(value) {
      const target = new URL(value, location.href);
      if (target.origin !== location.origin) return value;
      const inHelp = target.pathname.startsWith(new URL('./', location.href).pathname);
      const clientHome = target.pathname === new URL('../index.html', location.href).pathname;
      if (inHelp || clientHome) {
        Object.entries(context).forEach(([name, data]) => {
          if (!target.searchParams.has(name)) target.searchParams.set(name, data);
        });
      }
      return `${target.pathname}${target.search}${target.hash}`;
    }
  };
}());
