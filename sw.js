// V3.0 F3 26 May 2026: bump v10 → v11. New dedicated caches —
// IMAGE_CACHE for Supabase storage + Unsplash photos, TILE_CACHE for the
// basemap (CARTO raster + OpenSeaMap overlay + demotiles glyph PBFs).
// Each has a FIFO entry cap (audit §7 — the previous unbounded image
// cache was the main eviction risk on iOS, and the basemap was not
// cached at all). The activate handler now keeps the expected three
// caches and only purges older `wangap-v*` shell caches.
// PREVIOUSLY (V3.0 F8.1) v9 → v10 to ship the full asset-manifest precache.
// V3.2 (ADR-0016) 2 June 2026: bump v11 → v12 to force clients off the stale
// shell so the new stats banners (incl. the public one) load without a manual
// cache clear.
// V3.2.5 (UAT Batch 4) 5 June 2026: bump v16 → v17 so PWA clients pick up the
// readability controls (font size, line-spacing) + rich-text rendering.
// V3.2.6 (UAT Batch 5) 6 June 2026: bump v17 → v18 for the theming presets +
// bottom-sheet declutter (post ⋯ menu + journal ⚙ Filtres).
// V3.2.7 (UAT fixes) 6 June 2026: bump v18 → v19 — videos bypass the SW so iOS
// gets native HTTP range (fixes black inline video) + landscape overlay removed.
// V3.2.8 6 June 2026: bump v19 → v20 — official Outremer 52 spec figures on Genèse.
// V3.2.9 6 June 2026: bump v20 → v21 — map post-detail persistent ✕ + scroll-to-top.
// V3.2.10 6 June 2026: bump v21 → v22 — map ✕/↑ inside card, video in map lightbox,
// LiveNavCard collapsed default, map toolbar declutter, Journal filter reset ✕.
// V3.2.11 7 June 2026: bump v22 → v23 — landscape portrait-lock restored except in
// viewers/map-detail (body.lightbox-open); manifest orientation portrait → any.
// V3.2.12 7 June 2026: bump v23 → v24 — useIsMobile uses min(w,h) so a phone in
// landscape no longer flips to desktop layout (was unmounting the lightbox →
// "rotate to portrait" inside the photo viewer); journal header redesign +
// combined floating chapter/étape/date pill; map/public label + thumbnail fixes.
// V3.4.1 4 July 2026: bump v98 → v99 — journal CALENDAR view: 📅 Calendrier tab
// → responsive month grid (desktop, ◀/▶ nav) / vertical agenda (phone), day
// cells show post thumb+count + étape/chapter milestone markers; opens the
// shared PublicPostDetail. (src/lib/calendar.js + JournalCalendarView.)
// V3.4.0 4 July 2026: bump v97 → v98 — public journal gets VIEW MODES: a
// 📜 Chronologique / 📖 Chapitres switcher + inline dropdown filters. Chapters
// view = cards (cover, dates, post count, SVG trace thumb) → drill-in shows the
// chapter's posts grouped by étape with a sticky étape-name bar. (JournalPage +
// JournalChapterView + ChapterTraceThumb.) Calendar mode still to come.
// V3.3.18 4 July 2026: bump v96 → v97 — (1) inbox red-dot clears instantly on
// opening a comment (optimistic decrement instead of a racing thread_reads
// re-read); (2) manual stats override — Settings toggle + hand-entered banner
// values (boat_config, migration 079). (useInboxActivity/useComments, useStats.)
// V3.3.17 3 July 2026: bump v95 → v96 — newsletter signup now records the
// subscriber's language (FR/EN, from the page they signed up on) so alert
// emails render in the right language (was defaulting everyone to FR).
// V3.3.16 3 July 2026: bump v94 → v95 — public newsletter/alert signup was
// silently failing (direct anon upsert blocked by RLS, error ignored → false
// "merci"). Signup now goes through POST /api/notify {action:'subscribe'}
// (service role) + the form surfaces real errors. (PublicHomeAlt + api/notify.)
// V3.3.15 3 July 2026: bump v93 → v94 — public comment + contact forms now
// require a name + an email OR phone (WhatsApp) so a reply can always reach the
// visitor (PublicPostEngagement + PublicHomeAlt contact + api/notify contact-submit).
// V3.4.3 4 July 2026: bump v100 -> v101 -- calendar view gains chapter+etape
// colour bands per day + a legend, and each etape is introduced by a mini-map of
// its own trace (agenda intro cards + desktop "Etapes du mois" strip).
// V3.4.4 4 July 2026: bump v101 -> v102 -- the in-app post like badge now shows
// the COMBINED total (family + anonymous public-site visitors); the "who liked"
// list names the family likers + a "+ N visiteurs" summary. (useLikes + PostCard.)
// V3.4.5 4 July 2026: bump v102 -> v103 -- calendar (desktop) polish: clicking a
// day now opens a CENTERED POP-UP modal (was an easy-to-miss panel under the grid),
// and hovering a day shows its chapter + etape (native title tooltip).
// V3.4.6 4 July 2026: bump v103 -> v104 -- calendar (desktop): "Etapes du mois"
// moved from a strip under the grid to a top-right sidebar (grid left, stages right).
// V3.4.7 4 July 2026: bump v104 -> v105 -- visitor-message bug fixes: (#4) a
// verified contact message no longer arrives DUPLICATED (verify link claimed
// atomically before release); the inbox no longer shows "email non verifie" for
// phone-only visitors (shows "par telephone"). (api/notify + InboxPage.)
// v106 (V3.4.8): #3 inbox comment deep-link scrolls to the exact comment;
// B1 replies email the visitor from contact@wangap.fr (Reply-To boat Gmail),
// no mail-client composer. (reply-email + InboxPage + Timeline/PostCard.)
// v107 (V3.4.9, B3): verify a visitor's email ONCE (shared across messages +
// comments) via verified_contacts + a generic pending_verifications queue;
// first-time comments now require email confirmation. (migration 080 + notify.)
// v108 (V3.4.10, B7): 💬 bubble + device-scoped comment count on the public +
// journal cards; tapping it opens the post straight at the note form. New
// service-role public-comment-counts action. (notify + PublicHomeAlt/JournalPage.)
// v109 (V3.4.11, B4/B5): skipper "Commentaires" tab + badge now persist by
// ANSWERED (a visitor thread stays until replied, re-appears if the visitor
// writes again); visitors can re-reply inside their own device thread
// (public-comment-reply). (commentActivity + useInbox/CommentActivity + notify.)
// v110 (V3.4.12, B6): a visitor's "Nous envoyer un message" thread is now
// device-scoped — their message(s) + the skipper's replies show on the public
// page (only on that device). (migration 081 + notify + PublicHomeAlt.)
// v111 (V3.4.13, audit fixes): F1 link a verified email to every device it's
// used on; F3 gate visitor re-replies on a verified device; F2 family comments
// return to the tab as click-to-dismiss (visitor threads still persist); F4
// bubble turns into a filled pill when there's activity; F6 unanswered query
// now scales with active visitor threads. (notify + commentActivity + hooks.)
// v112 (V3.4.14): comment tab is per-skipper — an answered visitor thread clears
// for whoever replied, and stays as an FYI for the other skipper until they open
// it (persistence = answered + seen). New /messagerie.html guide linked in Help.
// v113 (V3.4.15): the visitor's public message thread now matches by device_key
// OR by an email the device has verified (F1 device↔email), so the thread shows
// across browsers and heals messages whose row had a blank device_key. (notify.)
// v114 (V3.4.16): skipper Commentaires tab — a ✕ button dismisses an unanswered
// visitor thread WITHOUT replying (per-skipper, reversible; re-surfaces if the
// visitor writes again). Reuses thread_reads (comment_dismissed marker).
// v115 (V3.4.17): post comment section shows a visitor's email/phone with copy +
// mailto (reply outside the thread) and a Block button (shadow-ban by email/
// phone/device + hides their comments; migration 082). Interface "L" size bigger.
// v116 (V3.4.18): visitor comment thread + card counts are now email-aware
// (device_key OR verified email), like the message thread; and the Commentaires
// tab dismiss (✕) now asks Retirer?/Annuler before removing. (notify + CommentActivity.)
// v117 (V3.4.19, Newsletter batch A): crew is recovered again — the étape query
// selected non-existent latitude/longitude columns, 400ing it and wiping both
// crew sources; and the newsletter crew section is now editable (rename / étape /
// dates / add / remove, local to the letter). (api/newsletter + Composer.)
// v118 (V3.4.20, Newsletter B+C): Send (test + abonnés) moved to the Aperçu
// review step with an inline confirm (#11,#4); a "Régénérer l'anglais" button
// re-translates FR→EN after the French is edited (#5); inclusive writing removed
// from user-facing strings ("abonnés", "connecté").
// v119 (V3.4.21, Newsletter D): email 'Read in English' now links to the web
// page ?lang=en (in-email #anchors don't work) (#6); NewsletterDetailPage honors
// ?lang; the public newsletters archive is unlisted (detail back-links go home)
// + a 'copier le lien' button on sent rows (#10). (newsletterPrompt + pages.)
// v120 (V3.4.22, Newsletter E+F): photo sorter — Tout désélectionner, selected
// strip with GREEN NUMBERED badges (collage order), pool in its own scroll panel,
// max 10 (#7,#8); reorder ◀▶ + per-photo size M/L/S (#9); smart cover-based
// mosaic renderer up to 10, no mismatched rows (#3). (Composer + newsletterPrompt.)
// v121 (V3.4.23, Newsletter G): map is less sketchy (50m coastlines, was 110m)
// and gets an operator ZOOM control in edit mode that re-renders + persists the
// PNG server-side (#1). (newsletterMap + api/newsletter map-rerender + MapSection.)
// v122 (V3.4.24): a visitor's re-reply now appears immediately in their thread
// (optimistic append + reconcile) instead of needing a reload — the refetch was
// racing a Supabase read replica. (PublicPostEngagement.)
// v131 (V3.4.33): newsletter photos become a FREE-FORM canvas — move / resize /
// reshape each photo anywhere (sections.collage). Web renders it 1:1; email
// composites the exact layout to one PNG (newsletterCollage + send/collage-render).
// v132 (V3.4.34): fix — the layout panel is now height-bounded + scrollable and
// the canvas is capped, so the send footer below the collage stays reachable.
// v133 (V3.4.35): Renard — paste a Google Drive FOLDER link to batch-index every
// document inside (PDF / Word / Google Docs, recursive), skipping already-imported
// files; single-file upload gains .docx + plain-language errors. (RenardAdminPage
// + api/renard-admin ingest-folder + scripts/ingest/documents.mjs worker.)
// v134 (V3.4.36): fix — strip NUL / C0 control chars from extracted PDF text
// before insert (PostgreSQL rejected them: "unsupported Unicode escape
// sequence"), so manuals like the BRANDT cooktop PDF index cleanly. Applies to
// both the Drive-folder worker + the single-file upload. (documents.mjs + api/rag.)
// v135 (V3.4.37): fix — embedTexts batches by token budget (~250k), not just
// count, so a large manual (e.g. 759-chunk fridge PDF) no longer blows OpenAI's
// per-request token cap and get NULL embeddings (was: unfindable by Renard).
// v136 (V3.4.38): fix — embed batching is script-aware. The chars/4 token
// estimate underflowed for Arabic/CJK (a 200-row batch of an Arabic manual still
// hit OpenAI's 300k-token cap); now batch by a conservative char budget +
// split-and-retry on the 400, so any language embeds correctly. (embeddings.js)
// v137 (V3.4.40): archive parity — the frozen archive now hides all interactive
// features that need a backend (likes, comments, newsletter subscription, the
// contact/message form + its mount fetch, crew submit). Forced off via
// ARCHIVE_MODE in useBoatConfig + guards; no change to the live site. Static
// journal/agenda/chapters/map/newsletters unaffected. (useBoatConfig + PublicHomeAlt.)
// v138 (V3.4.41): journal Calendar view — day timeline rails now taper+round at
// each chapter/etape START and END (was a flat band); and stages with no GPS
// trace show a position pin (nearest waypoint) instead of a blank mini-map.
// (JournalCalendarView + calendar.etapePosition + ChapterMiniMap single-point.)
// v139 (V3.4.42): the skipper/family Stats tab becomes a Calendrier tab (Chapitres
// + Calendrier), reusing the public journal views in audience='authed' mode
// (RLS-visible posts incl. drafts, real-time trace, hidden chapters). Compact KPI
// strip on top; full stats page preserved at /insights (Reglages). Journal tab
// stays chronological. (JournalCalendarPage + audience prop + TabBar/NavBar.)
// v140 (V3.4.43): newsletter editor — WYSIWYG stage 1. The free-form photo layout
// editor (move / resize / crop) moves INLINE into the Photos section, replacing the
// old M/L/S + arrows; the Apercu modal is now preview + send only. One place to pick
// AND arrange photos. (Composer PhotoSection + FreeCollageEditor.)
// v141 (V3.4.44): newsletter editor — (1) recenter the scene inside a photo (⤢
// toggle: drag the image to set object-position; web = exact, email PNG snaps to the
// nearest anchor); (2) the map is now DRAG-to-recentre (grab + move like a real map)
// instead of ←↑↓→ arrow taps, + / − zoom kept, one server render on Appliquer.
// v142 (V3.4.45): trace gap-detection (continuity) is now BOAT-WIDE via boat_config
// (migration 083), not per-device localStorage. The skipper sets "cut if silence >
// N h / implied speed > M kn" once and every map (skipper/family/public) uses it.
// MapView + Settings read/write boat_config; debounced write. (needs migration 083.)
const CACHE_NAME = 'wangap-v181';
const IMAGE_CACHE = 'wangap-images-v1';
const TILE_CACHE = 'wangap-tiles-v1';
const EXPECTED_CACHES = new Set([CACHE_NAME, IMAGE_CACHE, TILE_CACHE]);
// Approx upper-bounds per cache. Tile entries are small (10-40 KB raster,
// ~5-20 KB glyph PBF) so 2000 ≈ 50-100 MB. Image entries vary (sm 15 KB,
// md 80 KB, lg 300 KB); 500 covers thousands of variants at most-used
// sizes, ≈ 100-200 MB ceiling on photo storage growth.
const TILE_CACHE_MAX = 2000;
const IMAGE_CACHE_MAX = 500;

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

// V3.0 F3 — cache.put with a FIFO entry cap. `cache.keys()` returns
// requests in insertion order, so deleting the oldest N keeps the cap
// without tracking access timestamps. Good-enough LRU for the dominant
// access pattern (tiles for a recently-panned area + photos for a
// recently-viewed gallery are likely needed again before being pushed
// out by 500-2000 newer entries).
function safePutWithCap(cacheName, request, response, maxEntries) {
  try {
    return caches.open(cacheName)
      .then((cache) =>
        cache.put(request, response).then(() => cache.keys()).then((keys) => {
          if (keys.length > maxEntries) {
            const overflow = keys.length - maxEntries;
            return Promise.all(keys.slice(0, overflow).map((k) => cache.delete(k)));
          }
        })
      )
      .catch(() => undefined);
  } catch (_) {
    return Promise.resolve();
  }
}
// Shell entries always precached.
const PRECACHE_SHELL = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/images/logo.webp',
  '/images/boat.webp',
  '/images/logo.png',
];

// F8.1 — build-time injected list of hash-named JS/CSS chunks under /assets/.
// `scripts/build/inject-precache.mjs` replaces the token below with the
// concrete array on every `npm run build`. In dev (no build step) it stays
// an empty array so the SW still installs.
const PRECACHE_ASSETS = /* @PRECACHE_ASSETS@ */ [];

const PRECACHE_URLS = [...PRECACHE_SHELL, ...PRECACHE_ASSETS];

// Install — precache app shell + build assets. Uses Promise.allSettled +
// per-URL fetch/put so a single missing asset (deploy race, 404) doesn't
// abort the entire precache and leave the user without an offline shell.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          fetch(url, { cache: 'reload' })
            .then((response) => {
              if (response && response.ok) return cache.put(url, response);
            })
            .catch(() => undefined)
        )
      )
    )
  );
  self.skipWaiting();
});

// Activate — purge anything that isn't one of the three expected caches
// (shell+assets, images, tiles). V3.0 F3: previously this kept only
// `CACHE_NAME` so the new image + tile caches must be whitelisted or
// they'd be deleted on every SW update.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => !EXPECTED_CACHES.has(n)).map((n) => caches.delete(n)))
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

  // V3.2.7 (UAT) — VIDEO must bypass the SW entirely. iOS inline <video> uses
  // HTTP Range requests and needs the native 206 Partial Content response. The
  // image-cache handler below would serve a cached full 200 (or a poisoned
  // partial) for the range request → iOS refuses to play → black frame + a
  // struck-through ▶. Videos are also far too large for the FIFO image cache.
  // Returning WITHOUT event.respondWith() lets the browser fetch directly, so
  // Supabase's native range support reaches the player untouched. This covers
  // any-origin video by extension AND any request carrying a Range header.
  if (/\.(mp4|mov|m4v|webm)(\?|$)/i.test(url.pathname) || event.request.headers.has('range')) {
    return;
  }

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

  // V3.0 F3 — Map basemap (CARTO raster + OpenSeaMap raster overlay +
  // demotiles.maplibre.org glyph PBFs) — cache-first into a dedicated
  // FIFO-capped cache. Without this the map is grey squares offline.
  // CARTO subdomain rotates (a./b./c./d.basemaps.cartocdn.com), hence
  // `endsWith`; OpenSeaMap likewise uses t.openseamap.org / tiles.* etc.
  // Cross-origin responses come back opaque (response.ok === false);
  // we cache them anyway since the browser serves opaque responses fine.
  if (
    url.hostname.endsWith('basemaps.cartocdn.com') ||
    url.hostname.endsWith('openseamap.org') ||
    url.hostname === 'demotiles.maplibre.org'
  ) {
    safeRespond(event, () =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response && (response.ok || response.type === 'opaque')) {
              safePutWithCap(TILE_CACHE, event.request, response.clone(), TILE_CACHE_MAX);
            }
            return response;
          })
          .catch(() => new Response('', { status: 404 }));
      }),
    new Response('', { status: 404 }));
    return;
  }

  // Images (Supabase storage, Unsplash) — cache-first into IMAGE_CACHE
  // with a FIFO entry cap (audit §7 — was unbounded; over a 3-year voyage
  // this is the main vector for iOS-evicting the whole origin under
  // storage pressure).
  if (
    (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')) ||
    url.hostname === 'images.unsplash.com'
  ) {
    safeRespond(event, () =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response && (response.ok || response.type === 'opaque')) {
              safePutWithCap(IMAGE_CACHE, event.request, response.clone(), IMAGE_CACHE_MAX);
            }
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
    // V2.2 polish — fallback page now shows TWO possible messages
    // (truly offline vs server momentarily unavailable) so users mid-
    // deploy aren't misled into thinking their connection broke.
    // The body auto-detects via navigator.onLine + retries the
    // navigation once after 2 s so a Vercel cold-start usually
    // self-recovers without the user noticing.
    const offlinePage = new Response('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wang\'ap — Offline</title></head><body style="background:#0B1026;color:#FBF7EF;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center;max-width:320px;padding:0 20px"><h1>⛵ Wang\'ap</h1><p id="msg">Chargement…</p><script>(function(){var on=navigator.onLine;var t=document.getElementById("msg");if(!on){t.textContent="Hors-ligne — reconnectez-vous";return;}var k="wangap:swReloadCount",n=parseInt(sessionStorage.getItem(k)||"0",10);if(n>=3){t.textContent="Service indisponible — réessayez dans quelques minutes";sessionStorage.removeItem(k);return;}sessionStorage.setItem(k,String(n+1));t.textContent="Service momentanément indisponible — nouvelle tentative…";setTimeout(function(){location.reload();},2000);})();</script></div></body></html>', {
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

  // External resources — just fetch, don't cache.
  // (Basemap tiles and glyphs are handled by the F3 TILE_CACHE rule above,
  // not by MapLibre's in-memory cache.)
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
    icon: '/images/logo.webp',
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
