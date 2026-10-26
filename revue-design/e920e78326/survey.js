/* Revue du design — le questionnaire.
 *
 * Chaque démo (<body data-design="d3">) reçoit un onglet « 💬 Mon avis » sur le
 * bord droit ; il ouvre le questionnaire de CE design. La page d'accueil de la
 * revue utilise les mêmes fonctions pour l'état d'avancement et le bilan.
 *
 * Enregistrement : à chaque frappe (après 1,2 s de calme), d'abord sur
 * l'appareil (localStorage), puis chez Flavien via la fonction
 * `design_survey_save` de la 119. Sans réseau — ou avant que la 119 soit
 * appliquée — l'avis reste sur l'appareil et part au prochain passage en ligne.
 */
(function () {
  const { D, DESIGNS, t, esc, store } = window.WG;
  const S = D.supabase;
  const KEY = (rev, d) => `wg-revue:${rev}:${d}`;

  const reviewer = () => store.get('wg-revue-reviewer') || '';
  const setReviewer = (r) => { store.set('wg-revue-reviewer', r.trim()); window.dispatchEvent(new CustomEvent('wg:reviewer')); };
  const read = (d, rev = reviewer()) => { try { return JSON.parse(store.get(KEY(rev.toLowerCase(), d)) || 'null'); } catch { return null; } };
  const write = (d, rec, rev = reviewer()) => store.set(KEY(rev.toLowerCase(), d), JSON.stringify(rec));

  const rpc = async (fn, body) => {
    const r = await fetch(`${S.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: S.anonKey, Authorization: `Bearer ${S.anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${fn} ${r.status}`);
    return r.json();
  };

  // Envoie un avis ; met à jour `synced`. Renvoie true si c'est parti.
  const push = async (d, rev = reviewer()) => {
    const rec = read(d, rev);
    if (!rec || !rev) return false;
    try {
      await rpc('design_survey_save', { p_token: S.token, p_reviewer: rev, p_design: d, p_answers: { ...rec.answers, savedAt: rec.savedAt } });
      write(d, { ...rec, synced: true }, rev);
      return true;
    } catch { write(d, { ...rec, synced: false }, rev); return false; }
  };
  const flush = async () => {
    const rev = reviewer(); if (!rev) return;
    for (const d of [...DESIGNS.map((x) => x.id), 'general']) { const r = read(d, rev); if (r && r.synced === false) await push(d, rev); }
  };
  // Reprendre sur un autre appareil : ce que le serveur a de plus récent gagne.
  const pull = async () => {
    const rev = reviewer(); if (!rev) return;
    try {
      const rows = await rpc('design_survey_load', { p_token: S.token, p_reviewer: rev });
      for (const row of rows || []) {
        const local = read(row.design, rev);
        const serverAt = row.answers?.savedAt || row.updated_at;
        if (!local || (local.synced !== false && (!local.savedAt || serverAt > local.savedAt))) {
          const { savedAt, ...answers } = row.answers || {};
          write(row.design, { answers, savedAt: savedAt || row.updated_at, synced: true }, rev);
        }
      }
    } catch { /* hors ligne, ou la 119 pas encore appliquée */ }
  };
  window.addEventListener('online', flush);

  const status = (d) => {
    const r = read(d);
    if (!r) return 'todo';
    const a = r.answers || {};
    if (a.done) return 'done';
    return Object.values(a).some((v) => (Array.isArray(v) ? v.length : v)) ? 'started' : 'todo';
  };

  // ───────────────────────── le panneau d'un design ─────────────────────────
  const KEEP = () => [
    ['couleurs', t('Les couleurs', 'Colours')], ['typo', t('Les polices', 'Fonts')], ['photos', t('Le traitement des photos', 'Photo treatment')],
    ['pp', t('L’univers Petit Prince', 'The Little Prince world')], ['carte', t('La carte', 'The map')], ['mise', t('La mise en page', 'Layout')],
    ['menu', t('Le menu / la navigation', 'Menu / navigation')], ['anim', t('Les animations', 'Animations')],
  ];
  const STARS = () => [t('Pas pour nous', 'Not for us'), t('Bof', 'Meh'), t('Pourquoi pas', 'Why not'), t('J’aime bien', 'I like it'), t('Coup de cœur', 'Love it')];

  function mountDemo() {
    const d = document.body.getAttribute('data-design');
    const meta = DESIGNS.find((x) => x.id === d);
    if (!meta) return;
    const idx = DESIGNS.indexOf(meta);
    const tab = document.createElement('button');
    tab.className = 'wg-tab'; tab.type = 'button';
    const panel = document.createElement('aside');
    panel.className = 'wg-panel'; panel.setAttribute('aria-hidden', 'true');
    document.body.append(tab, panel);

    let timer;
    const render = () => {
      tab.innerHTML = `<span>💬 ${t('Mon avis', 'My view')}</span>`;
      tab.setAttribute('aria-label', t('Donner mon avis sur ce design', 'Give my view on this design'));
      const rev = reviewer();
      const rec = read(d) || { answers: {} };
      const a = rec.answers || {};
      const prev = DESIGNS[idx - 1], next = DESIGNS[idx + 1];
      panel.innerHTML = `
        <div class="wg-panel-head">
          <div><div class="wg-kicker">${t('Design', 'Design')} ${idx + 1}/6</div><div class="wg-panel-title">${esc(t(meta.fr, meta.en))}</div></div>
          <button class="wg-x" type="button" aria-label="${t('Fermer', 'Close')}">✕</button>
        </div>
        <div class="wg-panel-body">
          ${rev ? '' : whoHtml()}
          <p class="wg-hint">${t('Gardez la page ouverte derrière : vous pouvez fermer ce panneau, regarder encore, puis revenir. Tout s’enregistre tout seul.', 'Keep the page open behind: close this panel, look again, come back. Everything saves by itself.')}</p>
          <fieldset class="wg-q"><legend>${t('Mon impression générale', 'Overall impression')}</legend>
            <div class="wg-stars" role="radiogroup">${STARS().map((l, i) => `<button type="button" role="radio" aria-checked="${a.note === i + 1}" data-note="${i + 1}" title="${esc(l)}">${a.note > i ? '★' : '☆'}</button>`).join('')}
              <span class="wg-star-label">${a.note ? esc(STARS()[a.note - 1]) : ''}</span></div>
          </fieldset>
          <label class="wg-q"><span>👍 ${t('Ce que j’aime', 'What I like')}</span><textarea data-k="like" rows="3" placeholder="${t('Les couleurs, une idée, un détail…', 'The colours, an idea, a detail…')}">${esc(a.like || '')}</textarea></label>
          <label class="wg-q"><span>👎 ${t('Ce que je n’aime pas', 'What I dislike')}</span><textarea data-k="dislike" rows="3" placeholder="${t('Ce qui gêne, ce qui ne nous ressemble pas…', 'What bothers me, what isn’t us…')}">${esc(a.dislike || '')}</textarea></label>
          <label class="wg-q"><span>✏️ ${t('Ce que j’améliorerais ou changerais', 'What I would improve or change')}</span><textarea data-k="change" rows="3" placeholder="${t('Plus de…, moins de…, à la place de…', 'More…, less…, instead of…')}">${esc(a.change || '')}</textarea></label>
          <fieldset class="wg-q"><legend>${t('À garder de ce design, quel que soit le choix final', 'Worth keeping from this design, whatever the final choice')}</legend>
            <div class="wg-chips">${KEEP().map(([k, l]) => `<button type="button" class="wg-chip" aria-pressed="${(a.keep || []).includes(k)}" data-keep="${k}">${esc(l)}</button>`).join('')}</div>
          </fieldset>
          <div class="wg-save" aria-live="polite">${saveText(rec)}</div>
          <div class="wg-panel-foot">
            <button type="button" class="wg-done">${a.done ? '✓ ' + t('Avis donné', 'View given') : t('J’ai fini pour ce design', 'I’m done with this design')}</button>
            <div class="wg-nav">
              ${prev ? `<a href="${prev.file}#avis">← ${esc(t(prev.fr, prev.en))}</a>` : '<span></span>'}
              <a href="index.html">${t('Accueil de la revue', 'Review home')}</a>
              ${next ? `<a href="${next.file}">${esc(t(next.fr, next.en))} →</a>` : `<a href="index.html#bilan">${t('Le bilan', 'Wrap-up')} →</a>`}
            </div>
          </div>
        </div>`;
      bindWho(panel, render);
    };
    const saveText = (rec) => {
      if (!rec?.savedAt) return '';
      const at = new Date(rec.savedAt).toLocaleTimeString(WG.lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
      return rec.synced === false ? `💾 ${t('Enregistré sur cet appareil', 'Saved on this device')} (${at}) — ${t('sera transmis dès que possible', 'will be sent as soon as possible')}`
        : rec.synced ? `✓ ${t('Enregistré et transmis', 'Saved and sent')} (${at})` : `… ${t('Enregistrement', 'Saving')}`;
    };
    const update = (patch) => {
      if (!reviewer()) { panel.querySelector('.wg-who input')?.focus(); WG.toast(t('Dites-nous d’abord qui vous êtes 🙂', 'Tell us who you are first 🙂')); return; }
      const rec = read(d) || { answers: {} };
      const next = { answers: { ...rec.answers, ...patch }, savedAt: new Date().toISOString(), synced: null };
      write(d, next);
      panel.querySelector('.wg-save').innerHTML = saveText(next);
      clearTimeout(timer);
      timer = setTimeout(async () => { await push(d); panel.querySelector('.wg-save').innerHTML = saveText(read(d)); }, 1200);
    };
    panel.addEventListener('input', (e) => { const k = e.target.getAttribute('data-k'); if (k) update({ [k]: e.target.value.slice(0, 4000) }); });
    panel.addEventListener('click', (e) => {
      if (e.target.closest('.wg-x')) return close();
      const s = e.target.closest('[data-note]');
      if (s) { update({ note: Number(s.dataset.note) }); return render(); }
      const c = e.target.closest('[data-keep]');
      if (c) { const keep = new Set(read(d)?.answers?.keep || []); keep.has(c.dataset.keep) ? keep.delete(c.dataset.keep) : keep.add(c.dataset.keep); update({ keep: [...keep] }); return render(); }
      if (e.target.closest('.wg-done')) {
        const done = !read(d)?.answers?.done;
        update({ done });
        render();
        if (done) WG.toast(t('Merci ! Passez au design suivant quand vous voulez.', 'Thank you! Move on to the next design whenever you like.'));
      }
    });
    const open = () => { render(); panel.classList.add('on'); panel.setAttribute('aria-hidden', 'false'); tab.classList.add('off'); panel.querySelector('textarea')?.focus({ preventScroll: true }); };
    const close = () => { clearTimeout(timer); push(d); panel.classList.remove('on'); panel.setAttribute('aria-hidden', 'true'); tab.classList.remove('off'); if (location.hash === '#avis') history.replaceState(null, '', location.pathname); };
    tab.addEventListener('click', open);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel.classList.contains('on')) close(); });
    window.addEventListener('wg:lang', render);
    render();
    if (location.hash === '#avis') setTimeout(open, 400);
    pull().then(flush);
  }

  // « Qui êtes-vous ? » — trois boutons, ou un prénom.
  const whoHtml = () => `
    <div class="wg-who"><div class="wg-who-q">${t('Qui donne son avis ?', 'Who is giving their view?')}</div>
      <div class="wg-who-row"><button type="button" data-who="Catherine">🌹 Catherine</button><button type="button" data-who="Bertrand">🦊 Bertrand</button></div>
      <div class="wg-who-row"><input type="text" maxlength="40" placeholder="${t('ou votre prénom', 'or your first name')}" aria-label="${t('Votre prénom', 'Your first name')}"><button type="button" data-who-input>OK</button></div>
    </div>`;
  const bindWho = (root, after) => {
    root.querySelectorAll('[data-who]').forEach((b) => b.addEventListener('click', () => { setReviewer(b.dataset.who); pull().then(() => { flush(); after(); }); }));
    const inp = root.querySelector('.wg-who input');
    const go = () => { const v = inp.value.trim(); if (v) { setReviewer(v); pull().then(() => { flush(); after(); }); } };
    root.querySelector('[data-who-input]')?.addEventListener('click', go);
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  };

  window.WGS = { reviewer, setReviewer, read, write, push, pull, flush, status, whoHtml, bindWho, STARS, KEEP };
  if (document.body?.hasAttribute('data-design')) mountDemo();
  else document.addEventListener('DOMContentLoaded', () => { if (document.body.hasAttribute('data-design')) mountDemo(); });
})();
