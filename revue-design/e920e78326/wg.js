/* Revue du design (17 oct. 2026) — le socle commun des six démos.
 *
 * Rien ici n'appartient à l'application : ces pages sont statiques, servies
 * telles quelles par Vercel, et ne touchent pas la PWA.
 *
 *   WG.lang / WG.t(fr, en) / WG.setLang(l)   — FR/EN, mémorisé par appareil
 *   WG.img(url, width)                        — la vignette Supabase (render)
 *   WG.date(iso, opts)                        — date localisée
 *   WG.title(p) / WG.excerpt(p) / WG.cap(ph)  — champs bilingues
 *   WG.etape(id) / WG.chapter(id)             — libellés
 *   WG.staticMap(el, opts)                    — tuiles + trace en SVG, sans bibliothèque
 *   WG.openPost(post)                         — le lecteur d'une publication
 *   WG.toast(msg) / WG.inert()                — « lien inactif dans la démo »
 *   WG.DESIGNS                                — les six propositions
 */
(function () {
  const D = window.WG_DATA;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* navigation privée */ } },
  };

  const DESIGNS = [
    { id: 'd1', file: 'd1-petite-planete.html', fr: 'La Petite Planète', en: 'The Little Planet',
      moodFr: 'Un livre d’images à l’aquarelle — tendre, poétique, fait main.', moodEn: 'A watercolour storybook — tender, poetic, handmade.',
      xpFr: 'Le bateau devient une petite planète. Les étapes défilent comme des planètes rondes que l’on fait glisser du doigt ; les photos ont des bords d’aquarelle et des légendes manuscrites. Le renard explique le délai de publication. Menu en bas de l’écran, comme une appli.',
      xpEn: 'The boat becomes a little planet. Stages scroll sideways as round planets; photos get watercolour edges and handwritten captions. The fox explains the publishing delay. Menu at the bottom of the screen, like an app.',
      fonts: 'Fraunces · Literata · Caveat', palette: ['#F6EFDF', '#2E3A4B', '#8FC1D4', '#E9B44C', '#C9534A', '#7A9A5B'], pp: 5 },
    { id: 'd2', file: 'd2-nuit-de-quart.html', fr: 'Nuit de quart', en: 'Night Watch',
      moodFr: 'Sombre et étoilé — le calme d’un quart à 3 h du matin.', moodEn: 'Dark and star-lit — the calm of a 3 a.m. watch.',
      xpFr: 'Un ciel de nuit plein écran. La trace du voyage devient une constellation d’or qui se dessine quand on fait défiler la page ; les publications s’allument une à une. Les photos brillent sur fond sombre. Un bouton jour/nuit donne une version claire pour lire au soleil.',
      xpEn: 'A full-screen night sky. The voyage track becomes a golden constellation that draws itself as you scroll; posts light up one by one. Photos glow on the dark background. A day/night switch gives a light version for reading in the sun.',
      fonts: 'Instrument Serif · DM Sans · DM Mono', palette: ['#0B1530', '#13244A', '#EEE8DA', '#F2C94C', '#4FC1B5', '#E07A6B'], pp: 4 },
    { id: 'd3', file: 'd3-journal-de-bord.html', fr: 'Journal de bord', en: 'Ship’s Logbook',
      moodFr: 'La carte marine et le livre de bord — authentique, marin, avec humour.', moodEn: 'The nautical chart and the logbook — authentic, seamanlike, with humour.',
      xpFr: 'La carte est une carte marine papier, la route tracée en magenta. Chaque publication s’ouvre sur une ligne tapée à la machine (date, heure, position, étape), puis le récit. Les étapes forment un tableau de livre de bord. Onglets comme des intercalaires.',
      xpEn: 'The map is a paper nautical chart with the route in magenta. Each post opens with a typewritten log line (date, time, position, stage), then the story. Stages form a logbook table. Tabs like notebook dividers.',
      fonts: 'Courier Prime · Newsreader · Barlow Condensed', palette: ['#FBF8F0', '#EED9A4', '#B9D7E8', '#B0207E', '#1D2B44', '#F4CC4B'], pp: 2 },
    { id: 'd4', file: 'd4-la-revue.html', fr: 'La Revue', en: 'The Voyage Review',
      moodFr: 'Un magazine de voyage — calme, élégant, les photos parlent.', moodEn: 'A travel magazine — calm, elegant, photos do the talking.',
      xpFr: 'Chaque chapitre est une couverture de magazine : une grande photo, un titre immense. Dessous, les récits en cartes éditoriales numérotées, beaucoup d’air. Le Petit Prince en épigraphe, par les mots plutôt que par les dessins. Menu « sommaire » plein écran.',
      xpEn: 'Each chapter is a magazine cover: one big photo, a huge title. Below, stories as numbered editorial cards with lots of space. The Little Prince as epigraphs, through words rather than drawings. Full-screen “contents” menu.',
      fonts: 'Cormorant Garamond · Manrope', palette: ['#F7F4EE', '#2F2E2B', '#CFC8BD', '#2F5D6E', '#B5654A', '#DBDED5'], pp: 2 },
    { id: 'd5', file: 'd5-album-de-bord.html', fr: 'L’Album de bord', en: 'The Family Scrapbook',
      moodFr: 'L’album de famille — polaroïds, tampons, cartes postales.', moodEn: 'The family album — polaroids, stamps, postcards.',
      xpFr: 'Une pile de polaroïds scotchés en ouverture. Chaque étape est une carte postale avec un tampon de passeport ; on la retourne pour lire. Les mots de la famille deviennent des petits mots épinglés (« apprivoiser »). Carte et calendrier restent nets.',
      xpEn: 'A stack of taped polaroids to open. Each stage is a postcard with a passport stamp; flip it to read. Family notes become pinned notes (“taming”). Map and calendar stay clean.',
      fonts: 'Caveat · Nunito · Special Elite', palette: ['#E8DBC4', '#FFFDF8', '#F6D365', '#3D8FB8', '#EF7C6E', '#2D2A26'], pp: 3 },
    { id: 'd6', file: 'd6-carte-vivante.html', fr: 'Carte vivante', en: 'Living Map',
      moodFr: 'La carte d’abord — on suit le voyage comme une course au large.', moodEn: 'Map first — follow the voyage like an ocean race.',
      xpFr: 'La carte occupe l’écran d’accueil. Dessous, des tuiles de chiffres (milles, jours, étapes, dernier récit). « Raconte-moi » lance un récit guidé : la carte vole d’étape en étape pendant qu’on fait défiler. Les chapitres sont les planètes du Petit Prince.',
      xpEn: 'The map fills the opening screen. Below, number tiles (miles, days, stages, latest story). “Tell me” starts a guided story: the map flies from stage to stage as you scroll. Chapters are the Little Prince’s planets.',
      fonts: 'Bricolage Grotesque · Inter · JetBrains Mono', palette: ['#0E3B52', '#36B3AE', '#F4E8D4', '#F2843A', '#FFFFFF', '#0F1E28'], pp: 3 },
  ];

  let lang = store.get('wg-revue-lang') || ((navigator.language || 'fr').startsWith('fr') ? 'fr' : 'en');
  const t = (fr, en) => (lang === 'fr' ? fr : (en ?? fr));
  const setLang = (l) => { lang = l; store.set('wg-revue-lang', l); document.documentElement.lang = l; window.dispatchEvent(new CustomEvent('wg:lang', { detail: l })); };
  document.documentElement.lang = lang;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const img = (u, w = 600) => {
    if (!u || !u.includes('/storage/v1/object/public/')) return u;
    return `${u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=${w}&quality=74&resize=contain`;
  };
  const date = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => new Date(iso).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', opts);
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const E = byId(D.etapes), C = byId(D.chapters);
  const etape = (id) => (E[id] ? t(E[id].name, E[id].name_en || E[id].name) : '');
  const chapter = (id) => (C[id] ? t(C[id].title, C[id].title_en || C[id].title) : '');
  const title = (p) => t(p.title, p.title_en);
  const excerpt = (p, n) => { const s = t(p.excerpt, p.excerpt_en); return n && s.length > n ? `${s.slice(0, s.lastIndexOf(' ', n))}…` : s; };
  const cap = (ph) => (ph ? t(ph.cap, ph.cap_en || ph.cap) : '') || '';
  const photo = (p, i = 0) => p.photos?.[i]?.url || null;
  const fmtNm = (n) => n.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB');
  const lastPoint = () => D.track[D.track.length - 1];
  const fmtPos = ([lon, lat]) => {
    const f = (v, p, n) => { const a = Math.abs(v); const d = Math.floor(a); const m = ((a - d) * 60).toFixed(1); return `${d}°${m.padStart(4, '0')}'${v >= 0 ? p : n}`; };
    return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
  };

  // Le programme prévu (copie de PHASES, PublicHomeAlt).
  const PHASES = [
    ['🇫🇷', 'La Grande-Motte', 'Mai 2026', 'May 2026', 'Réception du catamaran', 'Taking delivery of the catamaran'],
    ['🇫🇷', 'Méditerranée', 'Juin–Sep 2026', 'Jun–Sep 2026', 'Corse · Sardaigne · Malte · Grèce', 'Corsica · Sardinia · Malta · Greece'],
    ['🇫🇷', 'Saint-Cyr-sur-Mer', '27 Sep 2026', '27 Sep 2026', 'Grand Départ !', 'The big departure!'],
    ['🇪🇸', 'Gibraltar → Canaries', 'Oct–Nov 2026', 'Oct–Nov 2026', 'Sortie de Méditerranée', 'Leaving the Mediterranean'],
    ['🇲🇶', 'Martinique', 'Déc 2026', 'Dec 2026', 'Transatlantique — premier océan !', 'Atlantic crossing — first ocean!'],
    ['🇨🇴', 'Caraïbes & Panama', 'Jan–Mar 2027', 'Jan–Mar 2027', 'Grenadines · San Blas · Canal', 'Grenadines · San Blas · Canal'],
    ['🇪🇨', 'Galápagos', 'Mars 2027', 'Mar 2027', 'Découverte naturaliste', 'A naturalist’s discovery'],
    ['🇵🇫', 'Polynésie française', 'Avr–Sep 2027', 'Apr–Sep 2027', 'Marquises · Tuamotu · Tahiti · Bora Bora', 'Marquesas · Tuamotu · Tahiti · Bora Bora'],
    ['🇳🇿', 'Nouvelle-Zélande', 'Nov 2027–Mar 2028', 'Nov 2027–Mar 2028', 'Hivernage et refit', 'Wintering and refit'],
    ['🇦🇺', 'Mélanésie & Australie', 'Avr–Jul 2028', 'Apr–Jul 2028', 'Nouvelle-Calédonie · Grande Barrière', 'New Caledonia · Great Barrier Reef'],
    ['🇮🇩', 'Indonésie', 'Jul–Août 2028', 'Jul–Aug 2028', 'Raja Ampat · Komodo · Bali', 'Raja Ampat · Komodo · Bali'],
    ['🇲🇺', 'Océan Indien', 'Sep–Nov 2028', 'Sep–Nov 2028', 'Maurice · La Réunion', 'Mauritius · Réunion'],
    ['🇿🇦', 'Afrique du Sud', 'Déc 2028', 'Dec 2028', 'Le Cap', 'Cape Town'],
    ['🇧🇷', 'Atlantique Sud & Brésil', 'Jan–Mar 2029', 'Jan–Mar 2029', 'Sainte-Hélène · Salvador', 'St Helena · Salvador'],
    ['🇵🇹', 'Açores → Retour', 'Été 2029', 'Summer 2029', 'Saint-Cyr — Retour ! 🏠', 'Saint-Cyr — home! 🏠'],
  ].map(([flag, place, pFr, pEn, dFr, dEn]) => ({ flag, place, period: () => t(pFr, pEn), desc: () => t(dFr, dEn) }));
  // La route PRÉVUE, approximative (un point par phase), longitudes « déroulées »
  // vers l'ouest pour qu'un tour du monde reste une ligne continue (−354° au retour).
  // → staticMap(el, { track: WG.ROUTE, split: false, boat: false, line: { dash: '6 6' } })
  const ROUTE = [[4.08, 43.56], [14.5, 35.9], [5.7, 43.17], [-5.35, 36.1], [-15.4, 28.1], [-61.0, 14.6], [-79.9, 9.3], [-90.3, -0.7],
    [-140.1, -8.9], [-149.6, -17.5], [-185.2, -36.8], [-193.6, -22.3], [-210.0, -23.0], [-244.8, -8.7], [-302.5, -20.2], [-341.6, -33.9],
    [-365.7, -15.9], [-398.5, -13.0], [-385.7, 37.7], [-365.0, 36.0], [-354.3, 43.17]];
  PHASES.forEach((ph, i) => { ph.lonlat = [ROUTE[[0, 1, 2, 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 17, 18][i]]][0]; });

  // Les citations déjà présentes sur le site (et quelques autres du livre, en texte seul).
  const QUOTES = {
    rose: { fr: '« C’est le temps que tu as perdu pour ta rose qui rend ta rose si importante. »', en: '“It is the time you have spent on your rose that makes your rose so important.”' },
    tame: { fr: '« Tu deviens responsable pour toujours de ce que tu as apprivoisé. »', en: '“You become responsible, forever, for what you have tamed.”' },
    stars: { fr: '« Quand tu regarderas le ciel, la nuit… ce sera comme si toutes les étoiles riaient. »', en: '“When you look up at the sky at night… it will be as if all the stars were laughing.”' },
    heart: { fr: '« On ne voit bien qu’avec le cœur. L’essentiel est invisible pour les yeux. »', en: '“One sees clearly only with the heart. What is essential is invisible to the eye.”' },
    flower: { fr: '« Les étoiles sont belles, à cause d’une fleur que l’on ne voit pas… »', en: '“The stars are beautiful because of a flower that cannot be seen…”' },
    desert: { fr: '« Ce qui embellit le désert, c’est qu’il cache un puits quelque part. »', en: '“What makes the desert beautiful is that somewhere it hides a well.”' },
  };
  const quote = (k) => t(QUOTES[k].fr, QUOTES[k].en);

  const NAV = () => [
    { id: 'carte', label: t('Carte', 'Map'), icon: '🗺️' },
    { id: 'journal', label: t('Le journal', 'The journal'), icon: '📓' },
    { id: 'galerie', label: t('La galerie', 'The gallery'), icon: '📷' },
    { id: 'genese', label: t('La Genèse', 'Genesis'), icon: '📖' },
    { id: 'programme', label: 'Programme', icon: '⛵' },
    { id: 'equipage', label: t('Équipage', 'Crew'), icon: '👥' },
    { id: 'contact', label: 'Contact', icon: '✉️' },
  ];

  // ───────────────────────── toast + liens inactifs ─────────────────────────
  let toastEl, toastTimer;
  const toast = (msg) => {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'wg-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2600);
  };
  const INERT_MSG = () => t('Démo : ce lien ne mène nulle part ici — la fonction existe et sera conservée.', 'Demo: this link goes nowhere here — the feature exists and will be kept.');
  const inert = () => {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-inert], a[href="#!"]');
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      toast(a.getAttribute('data-inert-msg') || INERT_MSG());
    }, true);
    document.addEventListener('submit', (e) => { e.preventDefault(); toast(t('Démo : rien n’est envoyé — le formulaire réel est conservé.', 'Demo: nothing is sent — the real form is kept.')); }, true);
  };

  // ───────────────────────── carte statique (tuiles + SVG) ─────────────────────────
  // ⚠️ Tuiles Esri (sans clé, comme l'application) — les fonds CARTO exigent
  // désormais une clé et renvoient une image « API key required ».
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
  const esri = (svc) => (z, x, y) => `${ESRI}/${svc}/MapServer/tile/${z}/${y}/${x}`;
  const TILES = {
    'light': esri('Canvas/World_Light_Gray_Base'),   // gris clair, sans noms
    'dark': esri('Canvas/World_Dark_Gray_Base'),     // gris anthracite, sans noms
    'ocean': esri('Ocean/World_Ocean_Base'),         // bathymétrie bleue, presque une carte marine
    'imagery': esri('World_Imagery'),                // satellite
    'topo': esri('World_Topo_Map'),                  // topographique, avec noms
    'natgeo': esri('NatGeo_World_Map'),              // style National Geographic, chaud
    'terrain': esri('World_Terrain_Base'),           // relief doux, sans noms
    'physical': esri('World_Physical_Map'),          // carte physique ancienne (zoom ≤ 8)
    'relief': esri('World_Shaded_Relief'),           // ombrage seul, très clair
    'street': esri('World_Street_Map'),
  };
  const TS = 256;
  const wx = (lon, z) => ((lon + 180) / 360) * TS * 2 ** z;
  const wy = (lat, z) => { const s = Math.sin((lat * Math.PI) / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * 2 ** z; };
  // La trace coupée là où elle saute (> 0,6° entre deux points = un trou de données).
  const segments = (track) => {
    const out = []; let cur = [];
    for (const p of track) {
      const prev = cur[cur.length - 1];
      if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.6) { if (cur.length > 1) out.push(cur); cur = []; }
      cur.push(p);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  /**
   * staticMap(el, {
   *   tiles: 'light' | 'dark' | 'ocean' | 'imagery' | 'topo' | 'natgeo' | 'terrain' | 'physical' | 'relief' | 'street', filter: 'sepia(.3)', bounds: [[w,s],[e,n]] (défaut : la trace),
   *   pad: 24, maxZoom: 9, zoomBias: 0, track: D.track, split: true (couper aux trous),
   *   line: { color, width, dash, glow, opacity, draw: true (dessin animé au premier affichage) },
   *   boat: true | { html } (le dernier point public), dots: [{lon,lat,html,title}]
   * }) → { z, project([lon,lat]) → [x,y], el }
   */
  const staticMap = (el, opts = {}) => {
    const o = { tiles: 'light', pad: 24, maxZoom: 9, zoomBias: 0, track: D.track, line: {}, boat: true, ...opts };
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return null;
      el.querySelectorAll(':scope > .wg-map-layer').forEach((n) => n.remove());
      const pts = o.track;
      const b = o.bounds || [[Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))], [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]];
      let z = o.maxZoom;
      while (z > 0 && (wx(b[1][0], z) - wx(b[0][0], z) > W - 2 * o.pad || wy(b[0][1], z) - wy(b[1][1], z) > H - 2 * o.pad)) z--;
      z = Math.max(0, Math.min(o.maxZoom, z + o.zoomBias));
      const cx = (wx(b[0][0], z) + wx(b[1][0], z)) / 2, cy = (wy(b[0][1], z) + wy(b[1][1], z)) / 2;
      const ox = cx - W / 2, oy = cy - H / 2;
      const project = ([lon, lat]) => [wx(lon, z) - ox, wy(lat, z) - oy];
      const layer = document.createElement('div');
      layer.className = 'wg-map-layer';
      layer.style.cssText = `position:absolute;inset:0;overflow:hidden;${o.filter ? `filter:${o.filter};` : ''}`;
      const n = 2 ** z;
      for (let tx = Math.floor(ox / TS); tx <= Math.floor((ox + W) / TS); tx++) {
        for (let ty = Math.max(0, Math.floor(oy / TS)); ty <= Math.min(n - 1, Math.floor((oy + H) / TS)); ty++) {
          const im = new Image();
          im.alt = ''; im.decoding = 'async'; im.loading = 'lazy'; im.draggable = false;
          im.src = TILES[o.tiles](z, ((tx % n) + n) % n, ty);
          im.style.cssText = `position:absolute;left:${tx * TS - ox}px;top:${ty * TS - oy}px;width:${TS}px;height:${TS}px;`;
          layer.appendChild(im);
        }
      }
      el.prepend(layer);
      const L = { color: '#E94F37', width: 3, opacity: 1, ...o.line };
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'wg-map-layer'); svg.setAttribute('width', W); svg.setAttribute('height', H);
      svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';
      for (const seg of (o.split === false ? [pts] : segments(pts))) {
        const d = seg.map((p, i) => { const [x, y] = project(p); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('');
        if (L.glow) { const g = document.createElementNS(svgNS, 'path'); g.setAttribute('d', d); g.setAttribute('fill', 'none'); g.setAttribute('stroke', L.glow); g.setAttribute('stroke-width', L.width * 3.5); g.setAttribute('stroke-linecap', 'round'); g.setAttribute('stroke-linejoin', 'round'); g.setAttribute('opacity', '0.35'); svg.appendChild(g); }
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', L.color); path.setAttribute('stroke-width', L.width);
        path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('opacity', L.opacity);
        if (L.dash) path.setAttribute('stroke-dasharray', L.dash);
        if (L.draw && !L.dash && !matchMedia('(prefers-reduced-motion: reduce)').matches) { path.setAttribute('pathLength', '1'); path.setAttribute('class', 'wg-draw'); }
        svg.appendChild(path);
      }
      el.appendChild(svg);
      const add = (lonlat, html, cls, titleTxt) => {
        const [x, y] = project(lonlat);
        const m = document.createElement('div');
        m.className = `wg-map-layer ${cls || ''}`; m.innerHTML = html; if (titleTxt) m.title = titleTxt;
        m.style.cssText = `position:absolute;left:${x}px;top:${y}px;transform:translate(-50%,-50%);`;
        el.appendChild(m);
      };
      for (const d of o.dots || []) add([d.lon, d.lat], d.html, 'wg-map-dot', d.title);
      if (o.boat) add(lastPoint(), o.boat.html || '<span class="wg-boat-dot"></span>', 'wg-map-boat', t('Dernière position publique', 'Latest public position'));
      return { z, project };
    };
    let res = draw();
    let rt;
    if ('ResizeObserver' in window) new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { res = draw(); }, 120); }).observe(el);
    return { get z() { return res?.z; }, project: (p) => res?.project(p), redraw: () => { res = draw(); } };
  };

  // ───────────────────────── lecteur d'une publication ─────────────────────────
  const openPost = (p) => {
    const ov = document.createElement('div');
    ov.className = 'wg-reader';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title(p));
    const photos = p.photos.map((ph) => `<figure><img src="${esc(img(ph.url, 900))}" alt="" loading="lazy">${cap(ph) ? `<figcaption>${esc(cap(ph))}</figcaption>` : ''}</figure>`).join('');
    ov.innerHTML = `
      <div class="wg-reader-card">
        <button class="wg-reader-x" aria-label="${t('Fermer', 'Close')}">✕</button>
        ${photos ? `<div class="wg-reader-photos">${photos}</div>` : ''}
        <div class="wg-reader-body">
          <div class="wg-reader-meta">${esc(date(p.date))} · ${esc(p.author)}${p.etape_id ? ` · ${esc(etape(p.etape_id))}` : ''}</div>
          <h2>${esc(title(p))}</h2>
          <p>${esc(excerpt(p))}</p>
          <div class="wg-reader-actions">
            <a href="#!" class="wg-reader-more">${t('Lire la suite', 'Read more')} →</a>
            <a href="#!">❤️ ${t('J’aime', 'Like')}</a><a href="#!">💬 ${t('Laisser un mot', 'Leave a note')}</a><a href="#!">📍 ${t('Voir sur la carte', 'See on the map')}</a>
          </div>
        </div>
      </div>`;
    const close = () => { ov.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.wg-reader-x')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(ov); document.body.style.overflow = 'hidden';
    ov.querySelector('.wg-reader-x').focus();
  };

  // Clic sur [data-post="<id>"] → le lecteur.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-post]');
    if (!el || e.target.closest('[data-inert], a[href="#!"]')) return;
    const p = D.posts.find((x) => x.id === el.getAttribute('data-post'));
    if (p) { e.preventDefault(); openPost(p); }
  });

  // Apparition au défilement : [data-reveal] reçoit .is-in (une fois).
  const reveal = (root = document) => {
    const els = root.querySelectorAll('[data-reveal]:not(.is-in)');
    if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('is-in')); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
  };

  window.WG = {
    D, DESIGNS, PHASES, ROUTE, QUOTES, quote, NAV, store, esc,
    get lang() { return lang; }, t, setLang,
    img, date, etape, chapter, title, excerpt, cap, photo, fmtNm, fmtPos, lastPoint, segments,
    staticMap, openPost, toast, inert, reveal,
  };
})();
