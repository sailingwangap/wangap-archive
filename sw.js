const CACHE_NAME = 'wangap-v8';

// Guaranteed-Response wrapper. Wraps any handler so a thrown exception or a
// resolved-non-Response value never bubbles up to the platform (which would
// throw "Failed to convert value to 'Response'" or "the promise was rejected"
// in the console). Fallback = a network-error stand-in the browser will treat
// like an offline failure rather than a SW crash.
function safeRespond(event, handler, fallback) {
  const fb = fallback || new Response('', { status: 503, statusText: 'sw-fallback' });
  event.respondWith(
    Promise.resolve()
      .then(() => handler())
      .then((r) => (r instanceof Response ? r : fb))
      .catch(() => fb)
  );
}

// cache.put can throw on opaque / opaqueredirect / partial responses.
// Swallow + log so the caller's promise chain never rejects from a side effect.
function safePut(request, response) {
  try {
    return caches.open(CACHE_NAME)
      .then((cache) => cache.put(request, response))
      .catch(() => undefined);
  } catch (_) {
    return Promise.resolve();
  }
}
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/wangap-archive/images/logo.webp',
  '/wangap-archive/images/boat.webp',
  '/wangap-archive/images/logo.png',
];

// Install — precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension, ws, etc.
  if (!url.protocol.startsWith('http')) return;

  // Supabase API — network first, fallback to cache (GET only)
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/rest/') && event.request.method === 'GET') {
    safeRespond(
      event,
      () =>
        fetch(event.request)
          .then((response) => {
            if (response && response.ok) safePut(event.request, response.clone());
            return response;
          })
          .catch(() =>
            caches.match(event.request).then((r) => r || new Response('[]', { status: 503, headers: { 'Content-Type': 'application/json' } }))
          ),
      new Response('[]', { status: 503, headers: { 'Content-Type': 'application/json' } })
    );
    return;
  }

  // Images (Supabase storage, Unsplash) — cache first
  if (
    (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')) ||
    url.hostname === 'images.unsplash.com'
  ) {
    safeRespond(event, () =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response && response.ok) safePut(event.request, response.clone());
            return response;
          })
          .catch(() => new Response('', { status: 404 }));
      }),
    new Response('', { status: 404 }));
    return;
  }

  // Same-origin navigation requests (SPA) — cache-first with background revalidation.
  // V1.8.11.4: switched from network-first to cache-first so a transient Vercel
  // 503 (cold start, deploy in progress) doesn't surface as a console error
  // even though the SW always served the cached shell. With cache-first the
  // user's request resolves immediately from cache; the network refresh is
  // fired-and-forgotten in the background and its failures are swallowed.
  if (url.origin === self.location.origin && event.request.mode === 'navigate') {
    const offlinePage = new Response('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wang\'ap — Offline</title></head><body style="background:#0B1026;color:#FBF7EF;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>⛵ Wang\'ap</h1><p>Offline — reconnectez-vous</p></div></body></html>', {
      // V1.9.3-fix: explicit charset=utf-8 in the Content-Type header AND a
      // <meta charset="utf-8"> in the HTML so the ⛵ + em-dash UTF-8 bytes
      // don't render as Latin-1 mojibake (â›µ / â€" — what users were seeing
      // when this fallback fired on https://wangap.fr/).
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
    // V1.9.3-fix: only cache the response as the SPA shell key '/' when
    // the request URL's pathname is actually '/'. Previously any navigation
    // (e.g., /uat-guide.html, /timeline) would have its response cached
    // under '/' — which poisoned the shell cache for any path that's
    // EXCLUDED from the SPA rewrite (uat-guide.html, guide.html, dev.html).
    // Symptom: visiting /uat-guide.html, then /, returned the UAT guide
    // content at the root URL.
    const isShell = url.pathname === '/';
    safeRespond(event, () =>
      caches.match('/').then((cached) => {
        // Background revalidation: fire-and-forget. Errors silenced so a
        // Vercel cold-start 5xx never bubbles up to the user's request flow.
        fetch(event.request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic' && isShell) {
              safePut('/', response.clone());
            }
          })
          .catch(() => undefined);

        if (cached && isShell) return cached;

        // Cache miss (first visit / cleared cache) — or non-root navigation
        // (uat-guide.html etc.) — fall back to network synchronously, and
        // use the inline offline page if even that fails.
        return fetch(event.request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic' && isShell) {
              safePut('/', response.clone());
            }
            if (response && (response.ok || response.type === 'opaqueredirect')) return response;
            return offlinePage;
          })
          .catch(() => offlinePage);
      }),
    offlinePage);
    return;
  }

  // Same-origin assets — stale while revalidate
  // V1.8.11.8 self-heal for stale-bundle:
  //   The cached SPA shell ('/' under wangap-vN) references hash-named JS
  //   bundles. After a deploy, the bundle filename changes; the cached shell
  //   still points at the old name. The browser then asks for /assets/<old>.js
  //   and Vercel either 404s (with the rewrite-exclusion fix) or serves the
  //   SPA fallback HTML (without it). Either way, the module load fails and
  //   the app crashes ("Failed to fetch dynamically imported module").
  //   When we detect that signal here, evict the cached '/' so the next
  //   navigation pulls a fresh shell — automatic recovery within one reload.
  if (url.origin === self.location.origin) {
    safeRespond(event, () =>
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            const isAsset = url.pathname.startsWith('/assets/');
            const ct = response && response.headers ? response.headers.get('content-type') || '' : '';
            const looksLikeStaleBundle = isAsset && (
              !response.ok ||
              ct.includes('text/html') // SPA fallback served instead of JS
            );
            if (looksLikeStaleBundle) {
              // Drop the cached SPA shell so the next nav fetches a fresh one.
              caches.open(CACHE_NAME).then((cache) => cache.delete('/')).catch(() => undefined);
              return response;
            }
            if (response && response.ok) safePut(event.request, response.clone());
            return response;
          })
          .catch(() => cached || new Response('', { status: 503 }));
        // If we have a cached copy, return it immediately and let fetch refresh in the background.
        // Otherwise wait for the network. fetchPromise is guaranteed to resolve to a Response now.
        return cached || fetchPromise;
      }),
    new Response('', { status: 503 }));
    return;
  }

  // External resources — just fetch, don't cache
  // (map tiles are handled by MapLibre's own caching)
});

// ═══ PUSH NOTIFICATIONS ═══

self.addEventListener('push', (event) => {
  let data = { title: "Wang'ap", body: 'Nouvelle notification', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/wangap-archive/images/logo.webp',
    badge: '/favicon.svg',
    tag: data.tag || 'wangap-notification',
    data: { url: data.url || '/' },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Click on notification — open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(url);
    })
  );
});
