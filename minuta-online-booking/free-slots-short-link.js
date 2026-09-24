const SHORT_BOOKING_LINK_API = 'https://primetime-booking.primetime-booking-ru.workers.dev/api/booking-short-links';
const shortLinkCache = new Map();

function canonicalBookingUrl(value) {
  const source = new URL(value);
  if (source.origin === 'https://primetime-booking.github.io' && ['/','/index.html'].includes(source.pathname)) return source.href;
  if (source.origin !== 'https://aladushka9180-droid.github.io'
    || source.pathname !== '/anatomy-trainer/minuta-online-booking/index.html') throw new Error('invalid_booking_origin');
  const target = new URL('https://primetime-booking.github.io/');
  target.search = source.search;
  return target.href;
}

export async function resolveShortBookingLink(sourceUrl) {
  const cached = shortLinkCache.get(sourceUrl);
  if (cached) return cached;
  const response = await fetch(SHORT_BOOKING_LINK_API, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ url:canonicalBookingUrl(sourceUrl) })
  });
  if (!response.ok) throw new Error('short_link_unavailable');
  const payload = await response.json();
  const shortUrl = new URL(payload.url);
  if (shortUrl.origin !== new URL(SHORT_BOOKING_LINK_API).origin
    || !/^\/[A-HJ-NP-Z2-9]{10}$/.test(shortUrl.pathname)
    || shortUrl.search || shortUrl.hash) throw new Error('invalid_short_link');
  shortLinkCache.set(sourceUrl, shortUrl.href);
  return shortUrl.href;
}
